# Flash Sales

## Overview
The flash sales module lets a vendor put a product up for a time-boxed **auction**, not a flat-discount promotion. A sale is created with a `startingBid` and a `minimumBidIncrement`; students then compete by calling the bid endpoint, and each accepted bid overwrites `currentBid`/`currentBidder` on the document and appends an entry to the `bids[]` array (full bid history). When the vendor closes the sale, they explicitly declare a `winner` and a `finalBid`, which are stored as `winner`/`currentBid` on the record. There is no automatic "highest bidder wins" resolution in `completeFlashSale` — the vendor (or a caller) supplies the winner explicitly.

The module owns the `FlashSale` collection, all bid placement/validation logic, per-sale locking to avoid concurrent-bid races, short-lived read caching, and best-effort real-time notifications to outbid bidders and the eventual winner. A `getVendorFlashSales` method is exported and consumed by the **Vendors** module (`GET /api/vendors/flash-sales`) to list a vendor's own sales; it has no route inside this module's own controller.

## Data Model
`FlashSale` schema (`src/modules/flash-sales/schema/flash-sale.schema.ts`), `{ timestamps: true }`:

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `vendorId` | ObjectId (ref `Vendor`) | required | owning vendor |
| `productId` | ObjectId (ref `Product`) | required | product on sale |
| `originalPrice` | Number | required | pre-auction price |
| `startingBid` | Number | required | floor for the first bid |
| `currentBid` | Number | optional | highest bid so far; also set to `finalBid` on completion |
| `currentBidder` | ObjectId (ref `User`) | optional | user who placed `currentBid` |
| `minimumBidIncrement` | Number | default `1` | minimum amount a new bid must exceed the current bid/starting bid by |
| `quantity` | Number | default `1` | units available |
| `startTime` | Date | required | auction start |
| `endTime` | Date | required | auction end |
| `status` | String enum `FlashSaleStatus` | default `upcoming` | see enum below |
| `bids` | Array of `{ userId: ObjectId(User), amount: Number, timestamp: Date }` | default `[]` | full bid history, newest appended last |
| `winner` | ObjectId (ref `User`) | optional | set by `completeFlashSale` |
| `reason` | String enum `FlashSaleReason` | optional | why the sale ended/was cancelled |
| `createdAt` / `updatedAt` | Date | auto (`timestamps: true`) | |

**`FlashSaleStatus` enum:** `upcoming`, `active`, `completed`, `cancelled`.
**`FlashSaleReason` enum:** `closing_time`, `expiring_stock`.

These two enums are duplicated verbatim in both `schema/flash-sale.schema.ts` and `dto/enums.ts` (the DTO copy is what the controller/service/DTO layer actually imports).

There is also an in-code-only `BidStatus` type (`'active' | 'won' | 'lost'`, in `dto/my-bids-query.dto.ts`) used solely to classify a student's bids in `getMyBids` — it is **not** a schema field.

**Indexes:** none are explicitly declared on this schema (no `.index()` calls); only the default `_id` index applies. Queries by `status`, `vendorId`, `productId`, `startTime`, `endTime`, and `currentBid` (see `getFlashSales` filter) are unindexed.

## Authentication
Guards used: `AccessTokenGuard` (JWT bearer) and `RolesGuard` (reads `@Roles(...)` metadata; a request without the required role gets a `ForbiddenException`).

| Route | Auth |
|---|---|
| `POST /api/flash-sales/create` | `vendor` |
| `GET /api/flash-sales` | public |
| `GET /api/flash-sales/my-bids` | `student` |
| `GET /api/flash-sales/:id` | public |
| `PATCH /api/flash-sales/:id/update` | `vendor` (no ownership check — see Business Rules) |
| `POST /api/flash-sales/:id/bid` | `student` |
| `PUT /api/flash-sales/:id/cancel` | `vendor` (must own the sale) |
| `POST /api/flash-sales/complete` | `vendor` (must own the sale) |

## Endpoints

### `POST /api/flash-sales/create`
- **Auth:** `vendor`
- **Request:** body = `CreateFlashSaleDto` (extends `BaseFlashSaleDto`): `productId` (Mongo ID, required), `originalPrice` (number ≥0, required), `startingBid` (number ≥0, required), `currentBid`/`currentBidder` (optional), `minimumBidIncrement` (number ≥1, optional), `quantity` (number ≥1, optional), `startTime`/`endTime` (ISO date strings, required), `status`/`reason` (optional enums), plus optional `bids[]` and `winner` (accepted by the DTO but normally left unset on creation)
- **Response:** `{ success: true, message: 'Flash sale created successfully', data: <FlashSaleDocument> }`
- **Errors:** any save failure is caught and rethrown as `InternalServerErrorException('Failed to create flash sale')`
- Vendor ID is taken from the JWT (`req.user.sub`), not the body; new sales always start as `FlashSaleStatus.UPCOMING` regardless of any `status` sent in the body.

### `GET /api/flash-sales`
- **Auth:** public
- **Request:** query = `FlashSaleQueryDto` — `status`, `vendorId`, `productId` (exact match), `startAfter` (→ `startTime $gte`), `endBefore` (→ `endTime $lte`), `minBid`/`maxBid` (→ `currentBid $gte`/`$lte`), all optional
- **Response:** `{ success: true, message: 'Flash sales fetched successfully', data: <FlashSaleDocument[]> }`, populated with `vendorId productId currentBidder winner` (password field excluded)
- Results are cached under `flash-sales:<JSON.stringify(query)>` for 300s.

### `GET /api/flash-sales/my-bids`
- **Auth:** `student`
- **Request:** query = `MyBidsQueryDto`: optional `status` in `'active' | 'won' | 'lost'`
- **Response:** `{ success: true, message: 'Bids fetched successfully', data: <array> }` — each item is the flash sale document plus a computed `bidStatus` field, optionally filtered to the requested status
- Finds every sale where `bids.userId` contains the caller, sorted by `createdAt` descending; not cached.

### `GET /api/flash-sales/:id`
- **Auth:** public
- **Request:** `id` (path, Mongo ID)
- **Response:** `{ success: true, message: 'Flash sale fetched successfully', data: <FlashSaleDocument> }`
- **Errors:** `NotFoundException` if no sale matches
- Cache-first read: returns a cached copy (`flash-sale:<id>`, 300s TTL) if present, otherwise reads from Mongo and repopulates the cache.

### `PATCH /api/flash-sales/:id/update`
- **Auth:** `vendor`
- **Request:** `id` (path); body = `UpdateFlashSaleDto` — all fields optional (`originalPrice`, `startingBid`, `currentBid`, `currentBidder`, `minimumBidIncrement`, `quantity`, `startTime`, `endTime`, `status`, `reason`, `winner`)
- **Response:** `{ success: true, message: 'Flash sale updated successfully', data: <FlashSaleDocument> }`
- **Errors:** `NotFoundException` if the sale does not exist
- The service does `Object.assign(sale, dto)` and saves — it does **not** verify the caller is the owning vendor, so any authenticated vendor can edit any sale's fields (including `status`/`winner`) via this route.

### `POST /api/flash-sales/:id/bid`
- **Auth:** `student`
- **Request:** `id` (path); body = `PlaceBidDto`: `amount` (number ≥0, required)
- **Response:** `{ success: true, message: 'Bid placed successfully', data: <FlashSaleDocument> }`
- **Errors:** `ForbiddenException` ("Bid is being processed, try again shortly") if another bid on the same sale is mid-flight; `NotFoundException` if the sale doesn't exist; `BadRequestException` if the sale isn't `active`, or if `amount` is below `max(currentBid, startingBid) + minimumBidIncrement`
- Uses a short-lived cache-based lock (`lock:flash-sale:<id>`, 5s TTL) so only one bid is processed at a time per sale; the previous highest bidder (if different from the new bidder) is notified as outbid — see Cross-Module Integration.

### `PUT /api/flash-sales/:id/cancel`
- **Auth:** `vendor`, must own the sale
- **Request:** `id` (path); body = `CancelFlashSaleDto`: `reason` (string, required — validated as a plain string, though its type is declared as `FlashSaleReason`)
- **Response:** `{ success: true, message: 'Flash sale cancelled successfully', data: <FlashSaleDocument> }`
- **Errors:** `NotFoundException` if missing; `ForbiddenException` if the caller isn't the owning vendor; `ConflictException` ("Cannot cancel a completed flash sale") if `status === COMPLETED`
- Sets `status = CANCELLED` and stores the given `reason`; a sale in any non-`COMPLETED` state (including `ACTIVE` or already `CANCELLED`) can be cancelled again.

### `POST /api/flash-sales/complete`
- **Auth:** `vendor`, must own the sale
- **Request:** body = `CompleteFlashSaleDto`: `flashSaleId` (Mongo ID, required — note the sale ID is in the body here, not the path), `winner` (Mongo ID, required), `finalBid` (number ≥0, required)
- **Response:** `{ success: true, message: 'Flash sale completed successfully', data: <FlashSaleDocument> }`
- **Errors:** `NotFoundException` if missing; `ForbiddenException` if the caller isn't the owning vendor; `ConflictException` ("Flash sale already completed") if `status === COMPLETED`
- Sets `status = COMPLETED`, `winner = dto.winner`, `currentBid = dto.finalBid`, `reason = CLOSING_TIME` (hardcoded — a vendor cannot mark a manual completion as `EXPIRING_STOCK` through this endpoint), then notifies the winner.

## State Machines

`FlashSaleStatus`: `upcoming → active → completed`, with `cancelled` reachable from any non-`completed` state via the cancel endpoint.

| Transition | Trigger | Guard |
|---|---|---|
| `upcoming → active` | `autoStartFlashSales()` (intended as a cron job, but the `@Cron(...)` decorators are commented out in the service — **not currently scheduled to run automatically**) | `startTime <= now` |
| `active → completed` | `completeFlashSale` (vendor-initiated) | caller owns sale; sale not already `completed` |
| `active → completed` | `autoEndExpiredSales()` (same unscheduled-cron caveat as above) | `endTime <= now`; sets `reason = CLOSING_TIME` but does **not** set a `winner` |
| any non-`completed` → `cancelled` | `cancelFlashSale` | caller owns sale; sale not `completed` |
| any → any field, including `status` | `updateFlashSale` | none — bypasses the above guards entirely (see Business Rules) |

`placeBid` does not change `status`; it only requires the sale already be `active`, and updates `currentBid`/`currentBidder`/`bids[]`.

## Cross-Module Integration
- **Notifications (`NotificationsService.notify`)** — this is the only external service the module calls:
  - `placeBid`: when a new bid supersedes a different previous bidder, notifies that previous bidder (`userType: 'customer'`, `type: 'flash_sale_alert'`, title `"Outbid!"`) with `{ flashSaleId, currentBid, yourBid }`. Wrapped in try/catch (`notifyOutbidUser`); a notification failure only logs an error and does not fail the bid.
  - `completeFlashSale`: notifies the declared `winner` (`userType: 'customer'`, `type: 'flash_sale_won'`, title `"You won!"`) with `{ flashSaleId, winningBid }`. Also wrapped in try/catch (`notifyWinner`); failure is logged, not surfaced.
- **Vendors module (reverse direction):** `FlashSaleModule` exports `FlashSaleService`; `VendorsController`'s `GET /api/vendors/flash-sales` (vendor-only) calls `flashSaleService.getVendorFlashSales(vendorId, query)` directly to paginate a vendor's own sales (`VendorFlashSaleQueryDto`: `status`, `page` default 1, `limit` default 10). This module does not call into Orders or Payments itself.

## Business Rules & Notes
- **Caching:** `CACHE_MANAGER` (in-memory `CacheModule.register()`, no Redis/store configured) is used for: single-sale reads (`flash-sale:<id>`, 300s after a fresh read, 600s after create/update, 300s after cancel/complete/auto-transitions), filtered list reads (`flash-sales:<JSON.stringify(query)>`, 300s), and a per-sale bid lock (`lock:flash-sale:<id>`, 5s). Because the store is process-local (not distributed), the bid lock and caches only protect a single server instance — they will not prevent race conditions across multiple app instances/pods.
- **No ownership check on update:** `updateFlashSale` (`PATCH /:id/update`) does not verify the caller owns the sale, unlike `cancelFlashSale` and `completeFlashSale` which do. Any user with the `vendor` role can modify any vendor's flash sale through this route.
- **Cron jobs disabled:** `autoStartFlashSales` and `autoEndExpiredSales` exist as callable service methods but their `@Cron(...)` triggers are commented out (see the "cron job will come later" comment block at the top of `flash-sale.service.ts`), so `upcoming` sales will not auto-activate and expired `active` sales will not auto-complete unless something else invokes these methods.
- **Auto-end doesn't set a winner:** `autoEndExpiredSales` marks expired sales `completed` with `reason = CLOSING_TIME` but never sets `winner` or reconciles `currentBid`/`currentBidder` into a winner — a vendor must still call `POST /api/flash-sales/complete` to record who won.
- **Duplicate enum definitions:** `FlashSaleStatus`/`FlashSaleReason` are defined identically in both `schema/flash-sale.schema.ts` and `dto/enums.ts`; the DTO/service/controller layer imports from `dto/enums.ts` (via the `dto/index.ts` barrel), while the schema file's copy is used only for the `@Prop` enum validators.
- **`getMyBids` is not paginated** and loads every sale the student has ever bid on before filtering by computed `bidStatus` in application code.
