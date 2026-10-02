# Payments & Payouts

## Overview

CampusBid uses an escrow model for order payments. When a student pays for an order, the money is not handed to the vendor immediately — it is charged via Paystack and the resulting `Payment` record is held (`status: 'held'`) until the student confirms delivery (which releases it) or a dispute/cancellation causes it to be refunded. This hold-then-release/refund pattern protects both sides: the vendor has proof of payment before shipping, and the student can get their money back if the order never arrives.

Paystack is used for **both** legs of this flow. The customer-charge leg (initializing a transaction, receiving the webhook, independently verifying the transaction server-side) works as before. Vendor payout is **no longer just an internal ledger** — `PayoutsService` still computes a vendor's pending/available balances directly from `Payment` documents (`status: 'held'` vs `status: 'released'`), and a payout "request" still creates a `Payout` document that snapshots the vendor's bank details (`bankSnapshot`) and tags the contributing payments with a `payoutId`, but an admin approving that request now actually calls Paystack's **Transfer API** to send the money, via a real mobile-money payout destination on the vendor's `bankDetails` (see `docs/vendors.md`). The `Payout.status` enum (`requested` / `processing` / `completed` / `failed`) now reflects a real state machine driven by that Transfer call and its webhook/reconciliation — see **Admin Payout Approval** below.

The commission split (10% platform / 90% vendor, see `ADMIN_COMMISSION_RATE` in `payment.service.ts`) is computed at release time and stored on the `Payment` document itself (`adminCommission`, `vendorPayout`), so payout balance calculations never need to recompute the split later.

## Data Model

### Payment schema
(`src/modules/payments/schema/payment.schema.ts`, `{ timestamps: true, versionKey: false }`)

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `orderId` | ObjectId (ref `Order`) | required, indexed | The order this payment is for. |
| `customerId` | ObjectId (ref `User`) | required, indexed | The paying student. |
| `vendorId` | ObjectId (ref `Vendor`) | required, indexed | The vendor being paid. |
| `amount` | Number | required, min 0 | Full order amount in cedis (GHS), as charged. |
| `currency` | String | default `'GHS'` | Not otherwise validated/used against Paystack calls. |
| `paymentMethod` | String enum: `card`, `mobile_money` | required | Set from `InitializePaymentDto.paymentMethod`. |
| `status` | String enum: `pending`, `held`, `released`, `refunded`, `failed` | schema default `'held'`, indexed | See status meanings below. **Note:** the schema-level default is `'held'`, but `PaymentsService.createPendingPayment` always explicitly sets `'pending'` on creation, so in practice this default is never relied upon. |
| `transactionId` | String | unique | Set to the generated Paystack reference (see "Business Rules"). |
| `payoutId` | ObjectId (ref `Payout`) | optional, indexed | Set once a `released` payment has been claimed into a payout batch; used to prevent double-counting (see Vendor Payouts). |
| `adminCommission` | Number | default 0 | Platform's cut, computed and stored on release. |
| `vendorPayout` | Number | default 0 | Vendor's cut, computed and stored on release. |
| `gatewayReference` | String | optional | Set to the same reference as `transactionId` at creation. |
| `gatewayResponse` | Object | optional | Raw Paystack verify/webhook response, stored for audit. |
| `holdStartTime` | Date | optional | Set when the charge is confirmed successful. |
| `releaseTime` | Date | optional | Set when the payment is released. |
| `refundTime` | Date | optional | Set when the payment is refunded. |
| `metadata` | Object | optional | Free-form; used to record `releasedBy`/`releasedAt`/commission breakdown on release and `refundReason` on refund. |

`status` meanings:
- `pending` — Payment initialized with Paystack; awaiting the webhook to confirm the charge actually succeeded. Exists specifically to cover the async window between `initialize` and the webhook call.
- `held` — Charge verified as successful; funds are considered in escrow, counted toward the vendor's *pending* balance.
- `released` — Student (or, per the code, any registered payment party — see Payment Lifecycle §3) confirmed delivery; commission split computed and stored; contributes to the vendor's *available* balance until claimed by a payout.
- `refunded` — A held payment was refunded (dispute, order cancellation, or vendor rejection).
- `failed` — The Paystack charge failed (webhook `charge.failed`), or the payment was otherwise marked failed by an admin.

Additional indexes: `{ customerId: 1, createdAt: -1 }`, `{ vendorId: 1, createdAt: -1 }`.

### Payout schema
(`src/modules/payments/schema/payout.schema.ts`, `{ timestamps: true }`)

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `vendorId` | ObjectId (ref `Vendor`) | required, indexed | Vendor requesting the payout. |
| `amount` | Number | required | Sum of `vendorPayout` across the claimed payments. |
| `paymentIds` | ObjectId[] (ref `Payment`) | required | The `released`, unclaimed payments swept into this payout. |
| `status` | String enum: `requested`, `processing`, `completed`, `failed` | default `'requested'`, indexed | See **Admin Payout Approval** for the full state machine — `processing`/`completed`/`failed` are now real, reachable states. |
| `requestedAt` | Date | default `Date.now` | |
| `completedAt` | Date | optional | Set when a transfer is confirmed successful (either immediately on approval or via reconciliation). |
| `bankSnapshot` | Object | optional | Copy of `vendor.bankDetails` at request time. |
| `adminNote` | String | optional | Never set by current code. |
| `failureReason` | String | optional | Set whenever a transfer attempt fails or is rejected — see below. |
| `transferReference` | String | optional, **unique, sparse** | Generated once on first approval attempt (`` `payout_${payoutId}_${Date.now()}` ``) and reused on every retry of the same payout. Passed to Paystack as the transfer's idempotency key. |
| `recipientCode` | String | optional | Paystack's id for the transfer recipient created from the vendor's `bankDetails`, recreated fresh on every approval attempt (not cached/reused across payouts, so a vendor changing their mobile money number between payouts can't accidentally send to a stale destination). |
| `transferCode` | String | optional | Paystack's id for the transfer itself. |
| `gatewayResponse` | Object | optional | Raw response from the last `initiateTransfer`/`verifyTransfer` call, stored for audit — same pattern as `Payment.gatewayResponse`. |
| `approvedBy` | ObjectId (ref `User`) | optional | The admin who approved or rejected the payout. |

Additional indexes:

- `{ vendorId: 1, createdAt: -1 }`
- `{ vendorId: 1, status: 1 }`, **unique**, partial (`status: 'requested'`) — at most one payout per vendor may be awaiting approval at a time; a second concurrent `requestPayout` call fails at the database level with a duplicate-key error rather than relying solely on an application-level check (see **Vendor Payouts**).

## Authentication

| Controller | Guard pattern | Notes |
|---|---|---|
| `PaymentsController` (`payments`) | Class-level `@UseGuards(AccessTokenGuard, RolesGuard)`, with `@Roles(...)` per route | Requires a valid access token on every route; most routes are further role-restricted. `GET /payments/history` has no `@Roles` decorator, so it is reachable by any authenticated role (student, vendor, or admin) — the service filters results by the caller's role. |
| `PaymentWebhookController` (`payments/webhook`) | **None** — no `@UseGuards`, and `@ApiExcludeController()` hides it from Swagger | This route is called directly by Paystack's servers, not by an authenticated app user, so a JWT guard is meaningless here. Authenticity is instead established cryptographically: the handler recomputes an HMAC-SHA512 signature over the raw request body and compares it to the `x-paystack-signature` header. |
| `VendorController` payout routes (`vendors/payouts...`) | `@UseGuards(AccessTokenGuard, RolesGuard)` + `@Roles('vendor')` | Only the authenticated vendor can see/act on their own payouts; the vendor ID is always taken from `req.user.sub`, never from a request parameter. |
| `PaymentsController` admin payout routes (`payments/payouts...`) | `@UseGuards(AccessTokenGuard, RolesGuard)` + `@Roles('admin')` | List/approve/reject — see **Admin Payout Approval**. |

## Payment Lifecycle

### 1. `POST /payments/initialize` (student)
- Loads the order (`orderModel.findById`) and verifies `order.customerId` matches the caller — otherwise `403 ForbiddenException`. Missing order → `404 NotFoundException`.
- Verifies the order has no existing "active" payment: any `Payment` for that `orderId` whose `status` is **not** `'failed'` blocks a new attempt (`409 ConflictException`, "This order already has an active payment"). This means a `refunded` order also cannot be re-paid — see Business Rules.
- Computes the charge amount **server-side** from `order.pricing.total` (never trusts a client-supplied amount) and converts it to the smallest currency unit via `PESEWAS_PER_CEDI = 100` (cedis × 100 = pesewas, rounded).
- Generates a reference: `` `ord_${orderId}_${Date.now()}` ``.
- Resolves the Paystack callback URL from `APP_URL` config (`${APP_URL}/payments/callback`), falling back to `DEFAULT_PAYSTACK_CALLBACK_URL = 'http://localhost:3000/api/payments/callback'`.
- Calls `PaystackService.initializeTransaction(email, amountInPesewas, reference, callbackUrl)`, which `POST`s to `https://api.paystack.co/transaction/initialize`.
- Creates a `Payment` document with `status: 'pending'`, `transactionId`/`gatewayReference` set to the generated reference.
- Returns `{ paymentId, authorizationUrl, accessCode, reference }` from the Paystack response.

### 2. `POST /payments/webhook/paystack` (public, signature-verified)
- Signature check: `PaystackService.verifyWebhookSignature` computes `HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)` and compares it to the `x-paystack-signature` request header using a **timing-safe** comparison (`crypto.timingSafeEqual`, length-checked first since that function throws on mismatched buffer lengths) rather than `===` on the hex strings. Mismatch (or a missing secret/signature) → `401 UnauthorizedException`. This depends on the raw request body being available, which is why `src/main.ts` creates the Nest app with `NestFactory.create(AppModule, { rawBody: true })`.
- Event filtering: `event.event` values in `HANDLED_TRANSFER_EVENTS = ['transfer.success', 'transfer.failed', 'transfer.reversed']` are routed to `PayoutsService.reconcilePayoutByReference(event.data.reference)` and returned immediately — see **Admin Payout Approval**. Otherwise, only `HANDLED_CHARGE_EVENTS = ['charge.success', 'charge.failed']` are processed further; anything else short-circuits with `{ received: true }`.
- Looks up the `Payment` by `transactionId: event.data.reference`. If not found, logs a warning and returns `{ received: true }` (no error surfaced to Paystack).
- **Idempotency guard:** if the payment's current `status !== 'pending'`, the handler returns immediately without reprocessing — a webhook can safely be delivered more than once.
- For `charge.success`: calls `confirmSuccessfulCharge`, which independently re-verifies the transaction by calling `PaystackService.verifyTransaction(reference)` (`GET https://api.paystack.co/transaction/verify/:reference`) rather than trusting the webhook payload directly. It only marks the payment `held` (setting `holdStartTime` and storing the raw verify response in `gatewayResponse`) if the verify response's `status === 'success'` **and** its `amount` (rounded) equals the expected amount in pesewas. If that check fails, a warning is logged and the payment is left as-is (still `pending`).
- For `charge.failed`: `markPaymentFailed` sets `status: 'failed'` and stores the webhook's event data in `gatewayResponse`.
- Always returns `{ received: true }`.

### 3. `PATCH /payments/:id/release` (student only, at the HTTP layer)
- Role-gated to `student` in `PaymentsController`. The service additionally checks that `payment.customerId` equals the caller (`actorId`) — anyone else gets `403 ForbiddenException`.
- Requires `payment.status === 'held'`, otherwise `409 ConflictException`.
- Commission split uses `ADMIN_COMMISSION_RATE = 0.1` (10%): `adminCommission = amount * 0.1`, `vendorPayout = amount - adminCommission` (i.e. vendor nets 90%).
- Sets `status: 'released'`, `releaseTime`, `adminCommission`, `vendorPayout`, and records `releasedBy`/`releasedAt`/the split into `metadata`.
- **Cross-module trigger:** `OrdersService.confirmDelivery` (or equivalent) calls `paymentsService.releasePayment(order.paymentId, customerId)` directly when the student confirms delivery, i.e. this same code path is reached both via the HTTP route and internally from order confirmation.

### 4. `PUT /payments/:id/refund`
- **HTTP layer:** `@Roles('student')` on `PaymentsController.refund` — only a student-role JWT can call this endpoint directly. The controller calls `refundPaymentForCancelledOrder`, **not** the lower-level `refundPayment`.
- **`refundPaymentForCancelledOrder(paymentId, dto, actorId)`** — the public route's service method. Checks `isPaymentParty` (actor must be the payment's customer or vendor), then **additionally requires the order itself already be `cancelled`** (`assertOrderAllowsRefund`, `409 ConflictException` "Cancel the order to get a refund" otherwise) before refunding. This exists so a student can retry a refund that failed partway through cancellation, without reopening a way to refund a `held` payment on an order that was never actually cancelled.
- **`refundPayment(paymentId, dto, actorId)`** — the lower-level method, with no order-status requirement. Not reachable via any HTTP route; called directly by `OrdersService` in two places: order cancellation by the customer, and order rejection by the **vendor** (passing `vendorId` as the actor). Both methods share the same `isPaymentParty` check (`actorId` matches either `payment.customerId` or `payment.vendorId`) and the same `refundHeldPayment` core (below).
- **`refundHeldPayment`** (shared by both): requires `payment.status === 'held'`, otherwise `409 ConflictException`; reverses the charge with Paystack (`PaystackService.refundTransaction`) before touching local state — if that call throws, the payment stays `held`; sets `status: 'refunded'`, `refundTime`, and stores `refundReason` (from `RefundPaymentDto.reason`) in `metadata`; notifies all admins (best-effort, failures only logged). The DTO also accepts an optional `amount` field, but it is **not read anywhere** here — refunds are always full, not partial.

### 5. `GET /payments/:id` — actor-scoped read
- **`getPaymentForActor(paymentId, actor)`** — unlike the other endpoints above, this route is reachable by `student`/`vendor`/`admin` alike, so authorization happens entirely inside the service: a non-admin caller must be the payment's customer **or** vendor (`isPaymentParty`), otherwise `403 ForbiddenException`. An admin can view any payment.
- Self-heals a `pending` payment the same way `findById` does (see below), but surfaces the outcome: the returned object always includes a `reconciliationPending: boolean` field, `true` only when the payment was `pending` and the reconciliation attempt itself threw (logged as an `error`, not just a warning) — the client can use this to show "still confirming" rather than silently serving a possibly-stale `pending` status with no explanation.
- **Field hiding:** non-admin callers never see `gatewayResponse` or `metadata.refund` on the returned payment (`toPaymentView` strips them) — raw Paystack payloads and refund internals are admin-only. `GET /payments/history` applies the same hiding via a Mongoose `.select(NON_ADMIN_HIDDEN_FIELDS)` projection instead of post-processing.

### 6. `GET /payments/history`
- Any authenticated role may call it; filtering is role-based:
  - `student` → `{ customerId: userId }`
  - `vendor` → `{ vendorId: userId }`
  - `admin` → `{}` (no filter — all payments)
  - anything else → `403 ForbiddenException`
- Sorted by `createdAt` descending. Non-admin results have `gatewayResponse`/`metadata.refund` excluded at the query level (see above).

## Vendor Payouts

`PayoutsService` (`src/modules/payments/payouts.service.ts`) computes balances directly from `Payment` documents — there is no separate ledger/balance collection.

- **Pending balance** — sum of `amount` across all `Payment`s for the vendor with `status: 'held'`:
  ```js
  paymentModel.aggregate([
    { $match: { vendorId, status: 'held' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  ```
- **Available balance** — sum of `vendorPayout` across all `Payment`s for the vendor with `status: 'released'` **and** `payoutId: null` (i.e. released but not yet claimed by any payout batch):
  ```js
  paymentModel.aggregate([
    { $match: { vendorId, status: 'released', payoutId: null } },
    { $group: { _id: null, total: { $sum: '$vendorPayout' } } },
  ])
  ```
  Both aggregations default to `0` if no documents match.
- **`getHeldPayments(vendorId)`** returns the itemized list of `held` payments plus their summed total — this is the breakdown behind the pending balance figure.
- **`requestPayout(vendorId)`** — rewritten to close a double-request race, in four steps:
  1. **`assertNoOpenPayout`**: rejects (`409 ConflictException`, "You already have a payout request in progress") if the vendor already has a `Payout` in `requested` **or** `processing` status. `processing` is included deliberately: a transfer that failed reverts its payout back to `requested` (see **Admin Payout Approval**), and that reverted payout must still block a second, independent request.
  2. **`createEmptyPayout`**: creates a `Payout` with `amount: 0`, `paymentIds: []`, snapshotting `vendor.bankDetails` into `bankSnapshot`. This is the **atomic claim**: the partial unique index on `{ vendorId, status: 'requested' }` means that if two requests somehow race past the pre-check above, only one `create()` can succeed — the loser gets a MongoDB duplicate-key error (code `11000`), which is caught and re-thrown as the same `409 ConflictException`.
  3. **`fundPayoutFromClaimedPayments`**: claims this vendor's `released`/unclaimed payments by `payoutId` (`updateMany({ vendorId, status: 'released', payoutId: null }, { payoutId })`), then reads back only the payments that actually have *this* `payoutId` and sums their `vendorPayout` into `payout.amount`. Claiming before summing means the amount can never include a payment some other process claims in between.
  4. If no payments were claimed, throws `400 BadRequestException` ("No available balance to pay out") — and the empty payout created in step 2 is deleted (`discardPayout`, which also releases any payments it did manage to claim back to `payoutId: null`) so a genuinely-empty request doesn't leave a dangling `Payout` blocking the next real one via the unique index.
- **`listPayouts(vendorId)`** returns all `Payout` documents for the vendor, newest first.

## Admin Payout Approval

`PayoutsService` + `PaystackService` now support actually disbursing a requested payout, with idempotency guaranteed at three layers: an atomic status-guarded claim in MongoDB, a stable transfer reference reused across retries, and Paystack's own rejection of a duplicate reference.

- **`listAllPayouts(status?)`** (admin) — lists all payouts, optionally filtered by `status`, populated with the vendor's email/business name/bank details. Before returning, it self-heals any payout still `processing` by calling `reconcilePayout` on it (see below) — the same "reconcile on read" pattern `PaymentsService` uses for pending payments, so a missed webhook doesn't leave a payout stuck forever just because nobody happened to look at it again.
- **`approvePayout(payoutId, adminId)`** (admin):
  1. **`claimPayoutForProcessing`**: atomically flips the payout from `requested` to `processing` via `findOneAndUpdate({ _id: payoutId, status: 'requested' })` — a `null` result (already claimed, by a duplicate click or a concurrent admin) throws `409 ConflictException`. On this same update, a `transferReference` is generated if the payout doesn't already have one from a prior failed attempt; if it does, that exact reference is reused.
  2. **`assertPayoutDestinationReady`**: throws `400 BadRequestException` ("Vendor has not set up mobile money payout details") unless the vendor's `bankDetails` has `accountName`, `accountNumber`, and `momoProvider` all set (see `docs/vendors.md`).
  3. Calls `PaystackService.createTransferRecipient(accountName, accountNumber, momoProvider)` — **always creates a fresh recipient**, never reuses one from a prior payout, so a vendor who updates their mobile money number between payout requests can't accidentally have funds sent to the old number.
  4. Calls `PaystackService.initiateTransfer(recipientCode, amountInPesewas, transferReference, reason)`.
  5. Stores `recipientCode`, `transferCode`, `gatewayResponse`, `approvedBy`. If Paystack's response already says `status: 'success'` (can happen in test mode, occasionally in live mode), sets `status: 'completed'` and `completedAt` immediately; otherwise the payout stays `processing` until a webhook or the next admin list-read reconciles it.
  6. **On any failure** in steps 2–5 (validation error, or Paystack rejecting the recipient/transfer), the `catch` block reverts `status` back to `'requested'` and records the thrown error's message in `failureReason` — the stable `transferReference` from step 1 is left untouched, so retrying reuses it. This is also why `assertPayoutDestinationReady` failures are visible to the admin as a normal `failureReason` on the payout, not just a 400 that's gone the moment the request ends.
- **`rejectPayout(payoutId, adminId, reason)`** (admin) — atomically flips `requested → failed` (`409 ConflictException` if not currently `requested`), then releases the claimed payments back to `payoutId: null` via `releasePaymentsFromPayout` so the vendor can request a payout again (e.g. after fixing their bank details).
- **`reconcilePayout(payout)`** (private, self-healing) — only acts on payouts still `processing` with a `transferReference`; calls `PaystackService.verifyTransfer(transferReference)` and applies whatever Paystack actually reports: `status: 'success'` → `completed`; `status: 'failed'` or `'reversed'` → `failed` **and** releases the claimed payments back to `payoutId: null` (same as a rejection, so the vendor isn't left permanently unable to re-request). Any other status (still pending/queued on Paystack's side) is left as `processing`.
- **`reconcilePayoutByReference(reference)`** — looked up by `PaymentsService.handleWebhook` for `transfer.success` / `transfer.failed` / `transfer.reversed` events (see **Webhook** below); finds the payout by `transferReference` and calls `reconcilePayout` on it. An unknown reference just logs a warning and returns — the webhook always responds `{ received: true }`.

### Paystack Transfer API (`PaystackService`)

Three methods, alongside the existing charge/verify/refund ones:

- **`createTransferRecipient(name, accountNumber, momoProvider)`** — `POST /transferrecipient` with `type: 'mobile_money'`. **The `bank_code` sent is `momoProvider.toUpperCase()`** (`MTN` / `VOD` / `ATL`), confirmed against Paystack's live `/bank?country=ghana&type=mobile_money` endpoint — this is a different, uppercase code from the lowercase `mtn`/`vod`/`atl` used for mobile money **charges** elsewhere in this file. Sending the lowercase charge-API code here fails with Paystack's `invalid_bank_code` validation error; this was caught by live testing, not by inspection, and is covered by a regression test in `paystack.service.spec.ts`.
- **`initiateTransfer(recipientCode, amountPesewas, reference, reason)`** — `POST /transfer`, `source: 'balance'`. Paystack itself rejects a reused `reference` with a duplicate-transfer error, which is the third idempotency layer described above.
- **`verifyTransfer(reference)`** — `GET /transfer/:reference`, used by reconciliation.
- **Error surfacing:** unlike the older charge/refund methods (which always throw a generic `InternalServerErrorException('Payment gateway error')`), these two throw `BadRequestException` with **Paystack's own `response.data.message`** when available (`extractGatewayErrorMessage`), falling back to the generic message only for non-gateway errors (e.g. a network failure). This is deliberate: transfer failures are usually something an admin needs to act on (a bad bank code, an account-tier restriction like "You cannot initiate third party payouts as a starter business") rather than an opaque 500.

**Where the HTTP routes live:** the **vendor-facing** payout routes (`GET /vendors/payouts`, `POST /vendors/payouts/request`, `GET /vendors/payouts/held-payments`) are implemented in `VendorController` (`src/modules/vendors/vendors.controller.ts`), which injects `PayoutsService` directly (exported from `PaymentsModule` for exactly this purpose). `VendorController` also has a catch-all `GET /vendors/:id` route explicitly commented `"must stay last: catches any single-segment /vendors/:id path"`, and the three payout routes are declared earlier in the same file (before that catch-all) to avoid a collision where `GET /vendors/payouts` could otherwise be matched by `GET /vendors/:id` (with `id="payouts"`).

The **admin-facing** payout routes (`GET/PATCH /payments/payouts...`) live in `PaymentsController` itself, declared before its own `GET /payments/:id`/`PATCH /payments/:id` catch-alls for the same reason — `/payments/payouts` would otherwise be matched by `GET /payments/:id` (with `id="payouts"`) if the catch-all were registered first.

## Endpoints Reference

All paths are relative to the global prefix `/api` (set in `src/main.ts`).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/initialize` | JWT, role `student` | Initialize a Paystack transaction for an order; creates a `pending` payment. |
| GET | `/api/payments` | JWT, role `admin` | List all payments, filterable by `status`, `paymentMethod`, `customerId`, `vendorId`, `transactionId`. |
| GET | `/api/payments/history` | JWT, any role | List payments scoped to the caller (student → own purchases, vendor → own sales, admin → all); non-admin results have gateway/refund internals stripped. |
| GET | `/api/payments/payouts` | JWT, role `admin` | List vendor payout requests, optionally filtered by `?status=`. |
| PATCH | `/api/payments/payouts/:id/approve` | JWT, role `admin` | Approve a payout and send the real Paystack transfer. |
| PATCH | `/api/payments/payouts/:id/reject` | JWT, role `admin` | Reject a payout (body: `{ reason }`); releases its claimed payments for retry. |
| GET | `/api/payments/:id` | JWT, roles `admin`, `student`, `vendor` | Fetch a single payment by ID — actor-scoped (must be the payment's customer/vendor, or admin); gateway/refund internals hidden from non-admins. |
| PATCH | `/api/payments/:id` | JWT, role `admin` | Update arbitrary fields of a payment record. |
| PATCH | `/api/payments/:id/release` | JWT, role `student` | Release a `held` payment (customer confirms delivery); computes commission split. |
| PUT | `/api/payments/:id/refund` | JWT, role `student` | Refund a `held` payment, but only once its order is already `cancelled` (see note above). The vendor-initiated path (order rejection) goes through `OrdersService`, not this route. |
| PATCH | `/api/payments/:id/status` | JWT, role `admin` | Force-set a payment's `status` directly. |
| POST | `/api/payments/webhook/paystack` | None (HMAC-SHA512 signature verification, timing-safe) | Paystack webhook receiver for `charge.success` / `charge.failed` / `transfer.success` / `transfer.failed` / `transfer.reversed`. |
| GET | `/api/vendors/payouts` | JWT, role `vendor` | List the authenticated vendor's payout requests. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |
| POST | `/api/vendors/payouts/request` | JWT, role `vendor` | Request a payout of the vendor's current available balance; `409` if one is already `requested`/`processing`. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |
| GET | `/api/vendors/payouts/held-payments` | JWT, role `vendor` | List the vendor's `held` payments contributing to their pending balance. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |

## Business Rules & Notes

- **Amount unit conversion:** charges and transfers are sent to Paystack in the smallest currency unit (pesewas for GHS) via `PESEWAS_PER_CEDI = 100`, independently defined as a local constant in both `payment.service.ts` and `payouts.service.ts` (`amountInPesewas = Math.round(amountInCedis * 100)`) rather than shared, to avoid a circular import between the two services (`PaymentsService` injects `PayoutsService` for webhook routing; `PayoutsService` has no reason to import anything back from `PaymentsService`).
- **`pending` status window:** exists specifically to bridge the time between `POST /payments/initialize` returning to the client and Paystack's asynchronous webhook call confirming (or failing) the charge. A payment stuck `pending` self-heals on its next read (`getPaymentForActor`/`findById`) rather than only via the webhook — see `reconciliationPending` above.
- **Commission constant:** `ADMIN_COMMISSION_RATE = 0.1` in `payment.service.ts` — a flat 10% platform commission on every released payment, with no per-vendor or per-order override in the current code.
- **Re-payment after refund/failure is inconsistent:** `assertOrderHasNoActivePayment` blocks a new `initialize` call for an order whenever an existing payment's `status !== 'failed'`. This means an order whose payment was `refunded` can never be paid for again through this endpoint (only `failed` payments are treated as retriable) — worth confirming this is intended behavior.
- **Live Paystack Transfers integration:** vendor payout now actually moves money — see **Admin Payout Approval**. The vendor's payout destination is mobile money (`vendor.bankDetails.momoProvider` + `accountNumber`), not a traditional bank account; see `docs/vendors.md`.
- **No partial refunds:** `RefundPaymentDto.amount` is accepted by validation but never read — every refund is treated as full.
- **Paystack service error handling is split by call:** `initializeTransaction`, `chargeMobileMoney`, `submitOtp`, `verifyTransaction`, `refundTransaction`, and `verifyTransfer` all still catch any `axios` error, log it, and rethrow a generic `InternalServerErrorException('Payment gateway error')`. `createTransferRecipient` and `initiateTransfer` instead throw `BadRequestException` with Paystack's own error message when available — see **Paystack Transfer API**.
- **Double-counting prevention:** the `payoutId` field on `Payment`, combined with the `payoutId: null` filter re-checked at claim time, ensures a `released` payment can be swept into exactly one payout batch. Payout-level idempotency (one open payout per vendor, one transfer per approval) is enforced separately — see **Admin Payout Approval**.
