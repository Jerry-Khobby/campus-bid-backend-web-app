# Orders

## Overview
The orders module owns the full lifecycle of a customer's purchase from a vendor: creation from a cart-like `items[]` payload, vendor acceptance/rejection, preparation and delivery status progression, customer confirmation of delivery, cancellation, rating, and live tracking. An order snapshots product name/image/price at creation time (rather than referencing live product data), carries a computed `pricing` breakdown, a GeoJSON `deliveryAddress.location`, and a `statusHistory[]` audit trail that every status-changing operation appends to.

The module coordinates with two other services rather than owning them: **Payments** (releasing or refunding the order's associated `Payment` document) and **Notifications** (best-effort push/real-time alerts to the customer or vendor). It does not manage payment capture itself — it only reacts to an existing `paymentId` on the order.

## Data Model
`Order` schema (`src/modules/orders/schema/order.schema.ts`), `{ timestamps: true, versionKey: false }`:

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `orderNumber` | String | required, unique | see generation note below |
| `customerId` | ObjectId (ref `User`) | required, indexed | |
| `vendorId` | ObjectId (ref `Vendor`) | required, indexed | |
| `items[]` | subdocument array (`_id: false`) | required | `productId` (ref `Product`, required), `productName` (required), `productImage` (optional), `quantity` (required, min 1), `price` (required, min 0), `isFlashSale` (default `false`), `flashSaleId` (ref `FlashSale`, optional) |
| `pricing` | subdocument (`_id: false`) | required | `subtotal`, `deliveryFee`, `serviceFee`, `total` — all required numbers ≥0 |
| `deliveryAddress` | subdocument (`_id: false`) | required | `label`, `building`, `room`, `instructions` (all optional strings); `location` is GeoJSON `{ type: 'Point', coordinates: [number, number] }`, default `[0, 0]` |
| `status` | String enum | default `pending`, indexed | see enum below |
| `statusHistory[]` | subdocument array (`_id: false`) | default `[]` | `status` (string), `timestamp` (default now), `note` (optional) — full audit trail |
| `paymentId` | ObjectId (ref `Payment`) | optional | controls whether payment release/refund logic runs |
| `estimatedDeliveryTime` | Date | optional | set on accept |
| `actualDeliveryTime` | Date | optional | set on mark-delivered |
| `vendorNotes` | String | optional | |
| `customerNotes` | String | optional | |
| `cancellationReason` | String | optional | set on cancel/reject |
| `rating` | subdocument (`_id: false`) | optional | `score` (1–5), `review`, `createdAt` (default now) |
| `createdAt` / `updatedAt` | Date | auto (`timestamps: true`) | |

**`status` enum values** (defined inline on the schema, and mirrored by `OrderStatus` in `dto/order-status.enum.ts`, which is what the service/DTOs actually import): `pending`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `completed`, `cancelled`, `refunded`.

**Indexes:** `deliveryAddress.location` (2dsphere, for geo queries), `{ customerId: 1, createdAt: -1 }`, `{ vendorId: 1, createdAt: -1 }`, `{ status: 1 }`, plus the per-field indexes on `customerId`, `vendorId`, and `status` declared via `@Prop({ index: true })`/enum prop, and the unique index on `orderNumber`.

**`orderNumber` generation quirk:** the schema has a `pre('save')` hook that generates `ORD-<YYYYMMDD>-<uuid-segment>` only `if (!this.orderNumber)`. However, `OrdersService.createOrder` already sets `orderNumber = ORD-<Date.now()>-<random 0-999>` before calling `.save()`, so the hook's format never actually applies in practice — only the service's format is used. `preparing`/`ready`/`refunded` status values exist in the enum but no method in `OrdersService` transitions an order into them.

## Authentication
Guards: `AccessTokenGuard` (JWT bearer, populates `req.user.sub`/`req.user.role`) and `RolesGuard` (`@Roles(...)`; mismatched role throws `ForbiddenException`).

| Route | Auth |
|---|---|
| `POST /api/orders/create` | `student` |
| `GET /api/orders` | any authenticated user (role-scoped results, no `@Roles`) |
| `GET /api/orders/:id` | any authenticated user (ownership enforced in service) |
| `PATCH /api/orders/:id/update` | `vendor` (no ownership check — see Business Rules) |
| `PATCH /api/orders/:id/status` | `vendor` (no ownership or transition check — see Business Rules) |
| `POST /api/orders/:id/cancel` | `student`, must own the order |
| `POST /api/orders/:id/rate` | `student`, must own the order |
| `PATCH /api/orders/:id/accept` | `vendor`, must own the order |
| `PATCH /api/orders/:id/reject` | `vendor`, must own the order |
| `PATCH /api/orders/:id/mark-delivered` | `vendor`, must own the order |
| `POST /api/orders/:id/confirm-delivery` | `student`, must own the order |
| `GET /api/orders/:id/track` | any authenticated user (ownership enforced in service) |
| `POST /api/orders/auto-complete` | `admin` |

## Endpoints

### Customer Actions

#### `POST /api/orders/create`
- **Auth:** `student`
- **Request:** body = `CreateOrderDto`: `vendorId` (Mongo ID, required), `items[]` (`OrderItemDto[]`, required — each with `productId`, `productName`, `productImage?`, `quantity` ≥1, `price` ≥0, `isFlashSale?` default `false`, `flashSaleId?`), `pricing` (`PricingDto`, required: `subtotal`/`deliveryFee`/`serviceFee`/`total`, all ≥0), `deliveryAddress` (`DeliveryAddressDto`, required, nested `location: LocationDto`), `customerNotes?`
- **Response:** `{ success: true, message: 'Order created successfully', data: <OrderDocument> }`
- **Errors:** all internal errors (including the deliberately-thrown `ForbiddenException`/`BadRequestException` below) are caught by a wrapping try/catch and re-thrown as a generic `InternalServerErrorException('Failed to create order')` — see Business Rules
- Validates the customer exists, the vendor exists and has `role === 'vendor'`, every item's product exists, and every product actually belongs to the given vendor, before creating the order with `status: PENDING` and an initial `statusHistory` entry.

#### `POST /api/orders/:id/cancel`
- **Auth:** `student`, must own the order (`customerId` match)
- **Request:** `id` (path); body = `CancelOrderDto`: `cancellationReason` (string, required)
- **Response:** `{ success: true, message: 'Order cancelled successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning customer; `ConflictException` ("Cannot cancel this order") if `status` is already `completed`, `cancelled`, or `refunded`
- Sets `status = CANCELLED`, records `cancellationReason`, appends to `statusHistory`; if the order has a `paymentId`, triggers a refund (see Cross-Module Integration).

#### `POST /api/orders/:id/rate`
- **Auth:** `student`, must own the order
- **Request:** `id` (path); body = `RateOrderDto`: `score` (number 1–5, required), `review?` (string)
- **Response:** `{ success: true, message: 'Order rated successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning customer; `BadRequestException` ("You can only rate completed orders") if `status !== completed`

#### `POST /api/orders/:id/confirm-delivery`
- **Auth:** `student`, must own the order
- **Request:** `id` (path); body = `ConfirmDeliveryDto`: `rating?` (number 1–5), `review?` (string)
- **Response:** `{ success: true, message: 'Delivery confirmed successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning customer; `ConflictException` ("Order must be in 'delivered' status") if the order isn't currently `delivered`
- Optionally records a rating inline, sets `status = COMPLETED`, appends to `statusHistory`, and — if `paymentId` is set — calls `PaymentsService.releasePayment` **without** a try/catch, so a payment-release failure propagates and fails the whole request (order is not saved as completed). See Cross-Module Integration.

### Vendor Actions

#### `PATCH /api/orders/:id/accept`
- **Auth:** `vendor`, must own the order
- **Request:** `id` (path); body = `AcceptOrderDto`: `estimatedPreparationTime` (number ≥1, minutes, required)
- **Response:** `{ success: true, message: 'Order accepted successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning vendor; `ConflictException` ("Order must be in 'pending' status") if not currently `pending`
- Sets `status = ACCEPTED`, computes `estimatedDeliveryTime = now + estimatedPreparationTime minutes`, appends to `statusHistory`, notifies the customer.

#### `PATCH /api/orders/:id/reject`
- **Auth:** `vendor`, must own the order
- **Request:** `id` (path); body = `RejectOrderDto`: `reason` (string, required)
- **Response:** `{ success: true, message: 'Order rejected successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning vendor; `ConflictException` ("Order must be in 'pending' status") if not currently `pending`
- Sets `status = CANCELLED` (not a separate `rejected` status), stores `cancellationReason = reason`, appends to `statusHistory`; if `paymentId` is set, triggers a refund; notifies the customer.

#### `PATCH /api/orders/:id/mark-delivered`
- **Auth:** `vendor`, must own the order
- **Request:** `id` (path), no body
- **Response:** `{ success: true, message: 'Order marked as delivered', data: <OrderDocument> }`
- **Errors:** `NotFoundException`; `ForbiddenException` if not the owning vendor; `ConflictException` ("Order must be in 'out_for_delivery' status") if not currently `out_for_delivery`
- Sets `status = DELIVERED`, `actualDeliveryTime = now`, appends to `statusHistory`, notifies the customer. (Nothing in the service ever transitions an order into `out_for_delivery` — see Business Rules.)

#### `PATCH /api/orders/:id/update`
- **Auth:** `vendor` (no ownership check)
- **Request:** `id` (path); body = `UpdateOrderDto` — all optional: `items[]`, `pricing`, `deliveryAddress`, `vendorNotes`, `customerNotes`, `status`, `paymentId`, `estimatedDeliveryTime`, `actualDeliveryTime`
- **Response:** `{ success: true, message: 'Order updated successfully', data: <OrderDocument> }`
- **Errors:** `NotFoundException` if the order doesn't exist
- `Object.assign(order, dto)` then saves — bypasses all ownership and status-transition guards used by the dedicated accept/reject/deliver endpoints, including direct `status` and `paymentId` overwrite.

#### `PATCH /api/orders/:id/status`
- **Auth:** `vendor` (no ownership check)
- **Request:** `id` (path); body = `UpdateOrderStatusDto`: `status` (`OrderStatus`, required), `note?` (accepted by the DTO but not read by the service)
- **Response:** `{ success: true, message: "Order status updated to <status>", data: <OrderDocument> }`
- **Errors:** `NotFoundException` if the order doesn't exist
- Sets `status` to whatever value is given and appends a generic `statusHistory` entry — **no transition validation at all** (any status to any status, including skipping steps or going backward); this is the only generic/unrestricted status-change route in the module.

### Tracking / Shared

#### `GET /api/orders`
- **Auth:** any authenticated user
- **Request:** query = `OrderQueryDto`: `status?`, `customerId?`, `vendorId?` (declared but not applied as filters by the service beyond role-scoping — see Business Rules), `startDate?`/`endDate?` (declared but unused by the service)
- **Response:** `{ success: true, message: 'Orders fetched successfully', data: <OrderDocument[]> }`, populated with `customerId vendorId items.productId` (password excluded), sorted by `createdAt` descending
- Role-scoped: `role === 'student'` filters to `customerId = caller`, `role === 'vendor'` filters to `vendorId = caller`; any other role (e.g. `admin`) gets an unfiltered list. Results cached under `orders:<role>:<userId>:<JSON.stringify(query)>` for 300s.

#### `GET /api/orders/:id`
- **Auth:** any authenticated user
- **Request:** `id` (path)
- **Response:** `{ success: true, message: 'Order fetched successfully', data: <OrderDocument> }`
- **Errors:** `BadRequestException` ("Invalid order ID") if not a valid Mongo ID; `NotFoundException`; `ForbiddenException` ("Unauthorized access") if a `student` isn't the customer or a `vendor` isn't the assigned vendor on the order (any other role bypasses this check)
- Cache-first (`order:<id>`, 300s TTL); populates `customerId vendorId items.productId`.

#### `GET /api/orders/:id/track`
- **Auth:** any authenticated user
- **Request:** `id` (path)
- **Response:** `{ success: true, message: 'Order tracking info fetched successfully', data: { orderId, currentStatus, statusHistory, estimatedDeliveryTime, vendor: { businessName, phoneNumber } } }`
- **Errors:** same as `GET /api/orders/:id` (`BadRequestException` for invalid ID, `NotFoundException`, `ForbiddenException` for role/ownership mismatch)
- Not cached; populates only `vendorId` with `profile.businessName profile.phoneNumber`.

#### `POST /api/orders/auto-complete`
- **Auth:** `admin`
- **Request:** none
- **Response:** `{ success: true, message: '<count> orders auto-completed' }` (no `data` key — inconsistent with every other endpoint in this module)
- Finds every order with `status === delivered`, sets each to `completed` with a `statusHistory` note "Auto-completed by system". This is a manually-triggered admin endpoint, not an automatic cron job.

## State Machines
`OrderStatus` enum: `pending`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `completed`, `cancelled`, `refunded`.

Transitions actually enforced by dedicated service methods (each via `assertOrderStatus`, which throws `ConflictException` if the order isn't in the expected starting state):

| From | To | Endpoint | Extra guard |
|---|---|---|---|
| `pending` | `accepted` | `acceptOrder` | caller is owning vendor |
| `pending` | `cancelled` | `rejectOrder` | caller is owning vendor; refunds payment if present |
| `out_for_delivery` | `delivered` | `markDelivered` | caller is owning vendor |
| `delivered` | `completed` | `confirmDelivery` | caller is owning customer; releases payment if present |
| `delivered` | `completed` | `autoCompleteDeliveredOrders` (admin-triggered, bulk) | none |
| any of `pending/accepted/preparing/ready/out_for_delivery` | `cancelled` | `cancelOrder` | caller is owning customer; refunds payment if present |

Two routes bypass this state machine entirely:
- `updateOrderStatus` (`PATCH /:id/status`) sets `status` to any value with no prior-state check.
- `updateOrder` (`PATCH /:id/update`) can set `status` directly via `Object.assign`.

**Gaps:** no method transitions an order into `preparing`, `ready`, `out_for_delivery`, or `refunded` — those four enum values are only reachable through the two unguarded generic-update routes above, not through any purpose-built endpoint.

## Cross-Module Integration
- **`PaymentsService.releasePayment(paymentId, actorId)`** — called only from `confirmDelivery`, only when `order.paymentId` is set, with the confirming customer as `actorId`. This call is **not** wrapped in try/catch: if it throws, the exception propagates out of `confirmDelivery` and the order update is not persisted (the `order.save()` that would set `status = COMPLETED` happens afterward, so a payment-release failure prevents completion).
- **`PaymentsService.refundPayment(paymentId, { reason }, actorId)`** — called from two places, both wrapped in try/catch so a refund failure only logs a warning and does not fail the request:
  - `cancelOrder`: `actorId` is the cancelling customer, reason is `"Order cancelled by customer: <cancellationReason>"`.
  - `rejectOrder`: `actorId` is the rejecting vendor, reason is `"Order rejected by vendor: <reason>"`.
  - In both cases the refund is only attempted if `order.paymentId` is present.
- **`NotificationsService.notify(userId, userType, type, title, message, data)`** — every call uses `type: 'order_status_changed'` and is wrapped in try/catch (failures logged as warnings, never surfaced to the caller):
  - `acceptOrder` → notifies the **customer**: "Order Accepted".
  - `rejectOrder` → notifies the **customer**: "Order Rejected: `<reason>`".
  - `markDelivered` → notifies the **customer**: "Order Delivered".
  - `confirmDelivery` → notifies the **vendor**: "Delivery Confirmed" ("Delivery confirmed, payment released").
  - `cancelOrder`, `rateOrder`, `updateOrder`, `updateOrderStatus`, and `autoCompleteDeliveredOrders` send **no** notifications.

## Business Rules & Notes
- **`createOrder` swallows all error types into a 500:** the entire validation block — including the deliberately-thrown `ForbiddenException('Invalid customer account')`, `BadRequestException('Vendor ID is required'/'Invalid vendor ID provided'/'One or more products do not exist')`, and `ForbiddenException('Product ... does not belong to the selected vendor')` — sits inside a try/catch whose catch clause always throws a generic `InternalServerErrorException('Failed to create order')`. Callers can never distinguish a bad request from a genuine server error on this endpoint; the specific message is only visible in the server log (`this.logger.error(...)`).
- **No ownership check on `updateOrder`/`updateOrderStatus`:** unlike `acceptOrder`/`rejectOrder`/`markDelivered`, these two routes only require the `vendor` role — any vendor account can modify or force-transition any order in the system.
- **`OrderQueryDto.customerId`/`vendorId`/`startDate`/`endDate` are accepted but unused:** `getOrders` only ever applies `status`, plus the caller's own `customerId`/`vendorId` derived from their JWT role — the query DTO's `customerId`, `vendorId`, `startDate`, and `endDate` fields pass validation but are never read into the Mongo filter.
- **Caching:** `CACHE_MANAGER` (in-memory, `CacheModule.register()`, no external store configured) keys: `order:<id>` (300s on fresh read/cancel/rate/confirm-delivery/accept/reject/mark-delivered, 600s on create/update/status-update/auto-complete), `orders:<role>:<userId>:<JSON.stringify(query)>` (300s). Being process-local, cached data can diverge across multiple app instances.
- **Geo data:** `deliveryAddress.location` defaults to `[0, 0]` if not supplied, and there is a `2dsphere` index on it, but no endpoint in this module currently performs a geo query against it.
- **`rejectOrder` reuses the `cancelled` status** rather than a distinct `rejected` value — a rejected order and a customer-cancelled order are indistinguishable by `status` alone; only `statusHistory`/`cancellationReason` text differs.
