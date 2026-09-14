# Notifications

## Overview

The Notifications module is the shared mechanism other modules use to alert a customer or vendor about something that happened elsewhere in the system (an order status change, an outbid flash-sale alert, a flash-sale win, etc.). Notifications are persisted to a `Notification` collection, counted for an unread badge (cached per user), and pushed to the recipient in real time over a Socket.IO gateway namespaced at `/notifications`. Unlike the Chat gateway, this gateway *does* authenticate incoming socket connections with the user's JWT and joins each socket to a personal room keyed by user ID, so `NotificationsService.notify()` can push directly to "whoever's socket belongs to this user ID" without the caller needing to know if/how they're connected.

`NotificationsService.notify(userId, userType, type, title, message, data?)` is the single integration point: any other module that wants to alert a user calls this one method, which both persists the notification (with validation that the target user/vendor exists) and emits it live via the gateway.

## Data Model

### Notification (`src/modules/notifications/schema/notifications.schema.ts`)

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | required; the recipient (customer or vendor id) |
| `userType` | enum `customer` \| `vendor` | required |
| `type` | enum: `order_update`, `new_message`, `flash_sale`, `payment`, `order_status_changed`, `flash_sale_alert`, `flash_sale_won` | required |
| `title` | String | required |
| `message` | String | required |
| `data` | Object | optional, default `{}` — arbitrary payload (e.g. `orderId`, `flashSaleId`) |
| `isRead` | Boolean | default `false` |
| `readAt` | Date | optional |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

Indexes: `{ userId: 1, createdAt: -1 }`, `{ userType: 1 }`.

## Authentication

- **REST**: The entire `NotificationsController` is guarded with `@UseGuards(AccessTokenGuard)` (JWT via Passport `jwt` strategy). No role restriction is applied — any authenticated user can call any endpoint, but ownership is enforced in the service layer where relevant (e.g. deleting a notification checks it belongs to `req.user.sub`).
- **WebSocket**: `NotificationsGateway` (`src/modules/notifications/notifications.gateway.ts`) is registered at namespace **`/notifications`** with `cors: true`. It implements `OnGatewayConnection.handleConnection`:
  1. `extractToken(client)` reads the JWT from either `client.handshake.auth.token` or the `Authorization` header (`client.handshake.headers.authorization`, stripping a leading `"Bearer "`).
  2. The token is verified with `JwtService.verifyAsync(token)` (Nest's `@nestjs/jwt`, configured with `JWT_SECRET` from `ConfigService` in `NotificationsModule`).
  3. On success, the socket is joined to a room named after `payload.sub` (`client.join(payload.sub)`) — i.e. a personal room keyed by the user's own ID, which is how `sendToUser(userId, ...)` later targets that specific user.
  4. On failure (missing/invalid/expired token — any thrown error), the client is disconnected (`client.disconnect()`); no error event is emitted back.

## REST Endpoints

Global prefix `/api` + controller prefix `notifications`.

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/api/notifications` | JWT | body `CreateNotificationDto`: `userId` (string, not empty), `userType` (`customer`\|`vendor`), `type` (one of the 7 enum values), `title` (string), `message` (string), `data?` (object) | `{ success: true, message: "Notification created", data: Notification }` | `404 NotFoundException` if `userType: 'customer'` and no matching `User` exists, or `userType: 'vendor'` and no matching `Vendor` exists |
| GET | `/api/notifications` | JWT | — (`req.user.sub`) | `{ success: true, message: "Notifications retrieved", data: Notification[] }` — last 50, sorted `createdAt: -1`, cached 300s per user | none |
| GET | `/api/notifications/unread-count` | JWT | — (`req.user.sub`) | `{ success: true, message: "Unread count retrieved", data: number }` — from cache (`notifications:unread:{userId}`), defaults to `0` | none |
| PATCH | `/api/notifications/read-all` | JWT | — (`req.user.sub`) | `{ success: true, message: "All notifications marked as read", data: { message: "All notifications marked as read" } }` | none |
| PATCH | `/api/notifications/:id/read` | JWT | path `id` | `{ success: true, message: "Notification marked as read", data: Notification }` | `404 NotFoundException` ("Notification not found") if `id` doesn't exist |
| DELETE | `/api/notifications/:id` | JWT | path `id` | `{ success: true, message: "Notification deleted", data: { message: "Notification deleted" } }` | `404 NotFoundException` if not found; `403 ForbiddenException` ("You cannot delete this notification") if the notification's `userId` doesn't match `req.user.sub` |

## WebSocket Events

Namespace: **`/notifications`**

### Client → Server

None. `NotificationsGateway` declares no `@SubscribeMessage` handlers — the client only connects (to trigger `handleConnection` authentication/room-join) and listens.

### Server → Client (emitted events)

| Event | Payload | Trigger |
|---|---|---|
| `new_notification` | The created `Notification` document | Emitted by `NotificationsGateway.sendToUser(userId, notification)` — `this.server.to(userId).emit('new_notification', notification)` — called from `NotificationsService.notify()` every time it successfully creates a notification |

**Cross-module triggers of `NotificationsService.notify()`** (confirmed by grepping `.notify(` across `src/`):

| Caller | Method | `userType` | `type` | `title` | `message` |
|---|---|---|---|---|---|
| `OrdersService.acceptOrder` → `notifyCustomer` | order accepted by vendor | `customer` | `order_status_changed` | `Order Accepted` | `Your order has been accepted and is being prepared` |
| `OrdersService.rejectOrder` → `notifyCustomer` | order rejected by vendor | `customer` | `order_status_changed` | `Order Rejected` | `` Your order was rejected: ${dto.reason} `` |
| `OrdersService.markDelivered` → `notifyCustomer` | vendor marks order delivered | `customer` | `order_status_changed` | `Order Delivered` | `Your order has been delivered` |
| `OrdersService.confirmDelivery` → `notifyVendor` | customer confirms delivery / payment released | `vendor` | `order_status_changed` | `Delivery Confirmed` | `Delivery confirmed, payment released` |
| `FlashSaleService.notifyOutbidUser` (called from the bid-placing flow when a previous bidder is displaced) | `customer` | `flash_sale_alert` | `Outbid!` | `` You've been outbid on ${productName} `` |
| `FlashSaleService.notifyWinner` (called from `completeFlashSale`) | `customer` | `flash_sale_won` | `You won!` | `Congratulations! You won the flash sale` |

Both `notifyCustomer`/`notifyVendor` in `OrdersService` also pass `data: { orderId, status: order.status }`; `notifyOutbidUser` passes `data: { flashSaleId, currentBid, yourBid }`; `notifyWinner` passes `data: { flashSaleId, winningBid }`. All of these call sites wrap the `notify()` call in `try/catch` and log a warning/error on failure rather than letting a notification failure break the underlying order/bid operation.

No caller in the codebase was found emitting the `order_update`, `new_message`, `flash_sale`, or `payment` `type` enum values via `.notify(...)` — they exist in the schema/DTO enum (and could be used through the raw `POST /api/notifications` endpoint) but are not currently produced by any module's business logic.

## Business Rules & Notes

- `notify(userId, userType, type, title, message, data?)` on `NotificationsService` is the single integration point other modules use to both persist and push a notification; internally it just calls `this.create(...)` (which validates the recipient exists and increments the cached unread counter) and then `this.gateway.sendToUser(userId, notification)`.
- `type` enum values defined in both the schema and `CreateNotificationDto`: `order_update`, `new_message`, `flash_sale`, `payment`, `order_status_changed`, `flash_sale_alert`, `flash_sale_won`. Of these, only `order_status_changed` (from Orders), `flash_sale_alert`, and `flash_sale_won` (both from Flash Sales) are actually emitted anywhere in the current codebase.
- Unread count is cache-based (`notifications:unread:{userId}`, 1-hour TTL), incremented on `create()` and decremented on `markAsRead()`; it is not derived from a live count of unread documents, so if the cache entry expires or is evicted, the count effectively resets to what a fresh `getUnreadCount` cache-miss yields (`0`) until the next create/read event resynchronizes it.
- Deleting a notification is restricted to its owner (`notif.userId === req.user.sub`); reading/marking-all-as-read/unread-count are scoped to `req.user.sub` implicitly, but `markAsRead(:id)` and the raw `POST /` create endpoint have no ownership check tying them to the caller.
