# CampusBid Backend

A NestJS + MongoDB backend for CampusBid, a campus e-commerce marketplace: students browse and order from campus vendors, bid on time-boxed flash sales, chat with vendors, and pay through an escrow-style flow backed by Paystack.

## Tech stack

NestJS 11 · MongoDB/Mongoose · Redis (`@nestjs/cache-manager`) · Socket.IO · JWT + Google OAuth · Cloudinary · Paystack · Jest

## Getting started

```bash
npm install
cp .env.example .env   # fill in real values — see docs/environment-variables.md
npm run start:dev      # http://localhost:3000/api, Swagger at /api-docs
```

The app needs a reachable MongoDB and Redis instance to finish starting — see [docs/environment-variables.md](./docs/environment-variables.md) for every variable it reads and which ones are load-bearing.

```bash
npm test          # unit tests (167 tests / 14 suites at last count)
npm run build     # production build (nest build)
npm run test:e2e  # end-to-end tests
```

## Where to look

This `README` is the front door. Everything else lives in [`docs/`](./docs), one file per concern, each verified directly against the current source rather than written from a plan or spec — a good habit for a codebase whose original planning document drifted far enough from reality that most of it had to be re-audited and rebuilt.

### Cross-cutting

- [Architecture](./docs/architecture.md) — stack, module map, conventions (auth guards, response shapes, pagination, caching, error vocabulary), and known structural quirks
- [Authentication & Authorization](./docs/authentication.md) — JWT access/refresh lifecycle, roles, Google OAuth
- [Environment Variables](./docs/environment-variables.md) — every variable actually read by the code
- [Testing](./docs/testing.md) — how to run tests, Jest config gotchas, conventions

### Modules

| Doc | Covers |
| --- | --- |
| [users.md](./docs/users.md) | Student accounts: registration/login, profile, addresses, payment methods |
| [vendors.md](./docs/vendors.md) | Vendor accounts, public vendor discovery, vendor dashboard/analytics, payout routes |
| [products.md](./docs/products.md) | Product catalog, stock/availability, nearby-products geosearch |
| [categories.md](./docs/categories.md) | Product category taxonomy |
| [flash-sales.md](./docs/flash-sales.md) | Bidding-style flash sales |
| [orders.md](./docs/orders.md) | Order lifecycle: create → accept/reject → deliver → confirm/cancel |
| [payments.md](./docs/payments.md) | Paystack integration, escrow hold/release/refund, vendor payout ledger |
| [reviews.md](./docs/reviews.md) | Per-product/vendor reviews tied to completed orders |
| [search.md](./docs/search.md) | Cross-collection text search |
| [uploads.md](./docs/uploads.md) | Generic image upload (Cloudinary-backed) |
| [chat.md](./docs/chat.md) | Buyer↔vendor messaging, REST + WebSocket |
| [notifications.md](./docs/notifications.md) | Cross-cutting notification delivery, REST + WebSocket |

### A note on API schemas

This documentation deliberately does not restate every request/response field for every endpoint — Swagger (`/api-docs`), generated straight from the DTOs, is the source of truth for exact shapes and literally cannot drift out of sync with the code the way a hand-written spec can. The `docs/` files focus on what Swagger can't show: request/response shape conventions per module, cross-module side effects, state machines, WebSocket events, and the "why" behind non-obvious decisions.

## Known issues surfaced while writing this documentation

Writing docs by reading the actual code (rather than trusting prior assumptions) turned up a few real bugs, listed here so they don't get lost:

- **Vendor Google OAuth is broken.** `VendorService.handleGoogleLogin` finds-or-creates the vendor but never returns a value, so `GET /vendors/google/callback` responds with an empty body instead of tokens. See [vendors.md](./docs/vendors.md).
- **The chat WebSocket gateway has no authentication.** Unlike the notifications gateway (which verifies a JWT on connect), any socket can connect to the `/chat` namespace and join any conversation room just by supplying a `conversationId`. See [chat.md](./docs/chat.md).
- **A refunded order can never be repaid.** `PaymentsService`'s "no active payment" guard only excludes `failed`-status payments, not `refunded` ones, so `POST /payments/initialize` will reject a second attempt on an order whose first payment was refunded. See [payments.md](./docs/payments.md).
- Several other smaller gaps (unscheduled cron jobs, endpoints missing ownership checks, unused DTO fields, inconsistent response shapes) are called out inline in the relevant module doc rather than repeated here.

None of these were fixed as part of this documentation pass — flagging them accurately was the goal; fixing them is separate work.
