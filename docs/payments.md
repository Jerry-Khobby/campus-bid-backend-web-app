# Payments & Payouts

## Overview

CampusBid uses an escrow model for order payments. When a student pays for an order, the money is not handed to the vendor immediately — it is charged via Paystack and the resulting `Payment` record is held (`status: 'held'`) until the student confirms delivery (which releases it) or a dispute/cancellation causes it to be refunded. This hold-then-release/refund pattern protects both sides: the vendor has proof of payment before shipping, and the student can get their money back if the order never arrives.

Paystack is used only for the **customer-charge leg** of this flow — initializing a transaction, receiving the webhook, and independently verifying the transaction server-side. There is no call to Paystack's Transfers API anywhere in the codebase. Instead, vendor payout is an internal ledger: `PayoutsService` computes a vendor's pending/available balances directly from `Payment` documents (`status: 'held'` vs `status: 'released'`), and a payout "request" simply creates a `Payout` document that snapshots the vendor's bank details (`bankSnapshot`) and tags the contributing payments with a `payoutId`. The `Payout.status` enum (`requested` / `processing` / `completed` / `failed`) is consistent with a manual, back-office payout process: a finance team presumably marks a payout `processing`/`completed` (e.g. after doing the actual bank transfer manually or through a separate system) — but nothing in the current codebase ever transitions a `Payout` out of `requested`. This confirms the payout system is a ledger/record-keeping mechanism, not a live disbursement integration.

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
| `status` | String enum: `requested`, `processing`, `completed`, `failed` | default `'requested'`, indexed | Only `'requested'` is ever set by current code (on creation) — no code path transitions a payout to any other status. Presumed to be updated manually/out-of-band once the vendor is actually paid. |
| `requestedAt` | Date | default `Date.now` | |
| `completedAt` | Date | optional | Never set by current code. |
| `bankSnapshot` | Object | optional | Copy of `vendor.bankDetails` at request time. |
| `adminNote` | String | optional | Never set by current code. |
| `failureReason` | String | optional | Never set by current code. |

Additional index: `{ vendorId: 1, createdAt: -1 }`.

## Authentication

| Controller | Guard pattern | Notes |
|---|---|---|
| `PaymentsController` (`payments`) | Class-level `@UseGuards(AccessTokenGuard, RolesGuard)`, with `@Roles(...)` per route | Requires a valid access token on every route; most routes are further role-restricted. `GET /payments/history` has no `@Roles` decorator, so it is reachable by any authenticated role (student, vendor, or admin) — the service filters results by the caller's role. |
| `PaymentWebhookController` (`payments/webhook`) | **None** — no `@UseGuards`, and `@ApiExcludeController()` hides it from Swagger | This route is called directly by Paystack's servers, not by an authenticated app user, so a JWT guard is meaningless here. Authenticity is instead established cryptographically: the handler recomputes an HMAC-SHA512 signature over the raw request body and compares it to the `x-paystack-signature` header. |
| `VendorController` payout routes (`vendors/payouts...`) | `@UseGuards(AccessTokenGuard, RolesGuard)` + `@Roles('vendor')` | Only the authenticated vendor can see/act on their own payouts; the vendor ID is always taken from `req.user.sub`, never from a request parameter. |

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
- Signature check: `PaystackService.verifyWebhookSignature` computes `HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)` (hex digest) and compares it to the `x-paystack-signature` request header. Mismatch → `401 UnauthorizedException`. This depends on the raw request body being available, which is why `src/main.ts` creates the Nest app with `NestFactory.create(AppModule, { rawBody: true })`.
- Event filtering: only `event.event` values in `HANDLED_WEBHOOK_EVENTS = ['charge.success', 'charge.failed']` are processed; anything else short-circuits with `{ received: true }`.
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
- **HTTP layer:** `@Roles('student')` on `PaymentsController.refund` — only a student-role JWT can call this endpoint directly.
- **Service layer (`PaymentsService.refundPayment`):** the authorization check is `isPaymentParty(payment, actorId)`, which returns true if `actorId` matches **either** `payment.customerId` **or** `payment.vendorId`. So the service itself does not restrict refunds to the customer only.
- In practice, this dual-party check is exercised because `OrdersService` calls `paymentsService.refundPayment(...)` directly (bypassing the controller's role guard) in at least two places: order cancellation by the customer, and order rejection by the **vendor** (passing `vendorId` as the actor). So as currently implemented, a vendor rejecting an order is a legitimate path to a vendor-initiated refund, while the public HTTP endpoint remains student-only. This is the current, verified behavior — there is no separate/duplicate `isPaymentParty`-style bug at the HTTP layer today.
- Requires `payment.status === 'held'`, otherwise `409 ConflictException`.
- Sets `status: 'refunded'`, `refundTime`, and stores `refundReason` (from `RefundPaymentDto.reason`) in `metadata`. The DTO also accepts an optional `amount` field, but it is **not read anywhere** in `refundPayment` — refunds are always full, not partial.

### 5. `GET /payments/history`
- Any authenticated role may call it; filtering is role-based:
  - `student` → `{ customerId: userId }`
  - `vendor` → `{ vendorId: userId }`
  - anything else (i.e. `admin`) → `{}` (no filter — all payments)
- Sorted by `createdAt` descending.

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
- **`requestPayout(vendorId)`**:
  1. Finds all `released` payments with `payoutId: null` for the vendor. If none, `400 BadRequestException` ("No available balance to pay out").
  2. Loads the vendor (`404 NotFoundException` if missing) to snapshot `vendor.bankDetails` into `bankSnapshot`.
  3. Sums `vendorPayout` across the found payments to get the payout `amount`, and collects their `_id`s.
  4. Creates a `Payout` document (`status` defaults to `'requested'`).
  5. **`payoutId` tagging:** calls `claimPaymentsForPayout`, which runs `updateMany({ _id: { $in: paymentIds }, payoutId: null }, { payoutId })` — re-checking `payoutId: null` at update time (not just at the earlier read) guards against a race where two concurrent payout requests both read the same unclaimed payments; only one update can actually claim each payment, and once claimed a payment's `payoutId` is set so it can never be swept into a second payout's `availableBalance` calculation or a second `requestPayout` call.
- **`listPayouts(vendorId)`** returns all `Payout` documents for the vendor, newest first.

**Important — where the HTTP routes actually live:** `PaymentsModule`'s `controllers` array is `[PaymentsController, PaymentWebhookController]` only — there is no payouts controller in this module. The vendor-facing payout routes (`GET /vendors/payouts`, `POST /vendors/payouts/request`, `GET /vendors/payouts/held-payments`) are instead implemented in `VendorController` (`src/modules/vendors/vendors.controller.ts`), which injects `PayoutsService` directly (exported from `PaymentsModule` for exactly this purpose, per the comment on `payment.module.ts`'s `exports` array). This is confirmed by the current code: `VendorController` also has a catch-all `GET /vendors/:id` route explicitly commented `"must stay last: catches any single-segment /vendors/:id path"`, and the three payout routes are declared earlier in the same file (before that catch-all). Keeping the payout routes inside `VendorController` — rather than a second controller also mounted at the `/vendors` path — lets their registration order relative to the single-segment catch-all be controlled directly in one file, avoiding a collision where a request like `GET /vendors/payouts` could otherwise be matched by `GET /vendors/:id` (with `id="payouts"`) if the catch-all were registered first.

## Endpoints Reference

All paths are relative to the global prefix `/api` (set in `src/main.ts`).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/initialize` | JWT, role `student` | Initialize a Paystack transaction for an order; creates a `pending` payment. |
| GET | `/api/payments` | JWT, role `admin` | List all payments, filterable by `status`, `paymentMethod`, `customerId`, `vendorId`, `transactionId`. |
| GET | `/api/payments/history` | JWT, any role | List payments scoped to the caller (student → own purchases, vendor → own sales, admin → all). |
| GET | `/api/payments/:id` | JWT, roles `admin`, `student`, `vendor` | Fetch a single payment by ID. |
| PATCH | `/api/payments/:id` | JWT, role `admin` | Update arbitrary fields of a payment record. |
| PATCH | `/api/payments/:id/release` | JWT, role `student` | Release a `held` payment (customer confirms delivery); computes commission split. |
| PUT | `/api/payments/:id/refund` | JWT, role `student` (see note above: service also permits the payment's vendor when called internally by `OrdersService`) | Refund a `held` payment. |
| PATCH | `/api/payments/:id/status` | JWT, role `admin` | Force-set a payment's `status` directly. |
| POST | `/api/payments/webhook/paystack` | None (HMAC-SHA512 signature verification) | Paystack webhook receiver for `charge.success` / `charge.failed`. |
| GET | `/api/vendors/payouts` | JWT, role `vendor` | List the authenticated vendor's payout requests. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |
| POST | `/api/vendors/payouts/request` | JWT, role `vendor` | Request a payout of the vendor's current available balance. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |
| GET | `/api/vendors/payouts/held-payments` | JWT, role `vendor` | List the vendor's `held` payments contributing to their pending balance. *(Route lives in `VendorController`; logic in `PayoutsService`.)* |

## Business Rules & Notes

- **Amount unit conversion:** charges are sent to Paystack in the smallest currency unit (pesewas for GHS) via `PESEWAS_PER_CEDI = 100` in `payment.service.ts` (`amountInPesewas = Math.round(amountInCedis * 100)`); the same constant is used when re-checking the webhook-verified amount against the expected amount.
- **`pending` status window:** exists specifically to bridge the time between `POST /payments/initialize` returning to the client and Paystack's asynchronous webhook call confirming (or failing) the charge. A payment can be stuck in `pending` indefinitely if the webhook is never delivered or if the amount/status re-verification in `confirmSuccessfulCharge` fails silently (only a `logger.warn`, no retry or alerting mechanism in code).
- **Commission constant:** `ADMIN_COMMISSION_RATE = 0.1` in `payment.service.ts` — a flat 10% platform commission on every released payment, with no per-vendor or per-order override in the current code.
- **Re-payment after refund/failure is inconsistent:** `assertOrderHasNoActivePayment` blocks a new `initialize` call for an order whenever an existing payment's `status !== 'failed'`. This means an order whose payment was `refunded` can never be paid for again through this endpoint (only `failed` payments are treated as retriable) — worth confirming this is intended behavior.
- **No live Paystack Transfers integration:** vendor "payout" is purely an internal `Payout` record plus a `bankSnapshot`; nothing in the codebase calls Paystack (or any other provider) to actually move money to a vendor's bank account. Actual disbursement is presumably a manual/off-platform process.
- **No partial refunds:** `RefundPaymentDto.amount` is accepted by validation but never read in `PayoutsService`/`PaymentsService.refundPayment` — every refund is treated as full.
- **`Payout.status` progression is unimplemented:** the schema defines `processing`/`completed`/`failed` payout statuses, but no code path in the current module (or elsewhere, per search) ever sets a payout to anything other than its `requested` default.
- **Paystack service error handling:** both `initializeTransaction` and `verifyTransaction` in `paystack.service.ts` catch any `axios` error, log it via `Logger.error`, and rethrow as a generic `InternalServerErrorException('Payment gateway error')` — the original Paystack error detail is logged server-side but not exposed to the API caller.
- **Double-counting prevention:** the `payoutId` field on `Payment` combined with the `payoutId: null` filter (checked both when selecting payments and again inside the claiming `updateMany`) ensures a `released` payment can be swept into exactly one payout batch.
