# Architecture

## Stack

- **Framework:** NestJS 11 (Express adapter)
- **Database:** MongoDB via Mongoose (`@nestjs/mongoose`)
- **Cache:** Redis via `@nestjs/cache-manager` + `cache-manager-redis-store`
- **Realtime:** Socket.IO via `@nestjs/websockets` / `@nestjs/platform-socket.io`
- **Auth:** JWT (access + refresh tokens) via `@nestjs/jwt` + `passport-jwt`, plus Google OAuth via `passport-google-oauth20`
- **File storage:** Cloudinary
- **Payments:** Paystack (REST API, called directly via `axios` — no SDK); both the customer-charge and vendor-payout (Transfer API) legs — see `docs/payments.md`
- **Rate limiting:** `@nestjs/throttler`, registered globally
- **Security headers:** `helmet`
- **Docs:** Swagger/OpenAPI, served at `/api-docs` (disabled in production)

## Global request pipeline

Configured in `src/main.ts`:

- Global prefix: every route in this document is written with the `/api` prefix already applied (e.g. a controller decorated `@Controller("products")` with a method `@Get(":id")` is reachable at `GET /api/products/:id`).
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — unknown body/query fields are rejected with a 400, and payloads are transformed into their DTO classes (so `@Type(() => Number)` on query DTOs actually coerces strings to numbers).
- `NestFactory.create(AppModule, { rawBody: true })` — the raw request body is preserved on `req.rawBody`, required by the Paystack webhook handler to verify the HMAC signature (see [payments.md](./payments.md)).
- `helmet({ contentSecurityPolicy: isProduction })` — the strict CSP is only enforced in production, where Swagger (which needs inline scripts) is disabled anyway.
- **Rate limiting:** a global `APP_GUARD` (`HttpThrottlerGuard` in `src/common/throttle/throttle.config.ts`) applies a default limit (300 req/min per client) to every HTTP route; sensitive auth routes (login, register, change/forgot/reset-password, token refresh — see each module's docs) additionally carry `@Throttle(SENSITIVE_THROTTLE)` (10 attempts per 15 minutes). The tracker key is **IP + the targeted email from the request body** when present, not IP alone — campus networks put many students behind one NAT address, so keying on IP alone would let one person's failed logins lock out everyone else on the same network. `app.set('trust proxy', ...)` is only enabled when `TRUST_PROXY_HOPS` is explicitly set to a positive number, so a client can't spoof `X-Forwarded-For` to dodge the limit when no proxy is actually in front of the app.
- **Global exception filter:** `MongooseExceptionFilter` (`src/common/filters/http-exception.filter.ts`) catches `Mongoose.Error.CastError`/`ValidationError` and converts them to `400 BadRequestException` with a readable message, instead of leaking as raw `500`s.
- `bootstrap()`'s promise is explicitly `.catch()`-handled — a startup failure is logged and exits the process (`process.exit(1)`) rather than failing silently.
- Swagger UI at `/api-docs` (non-production only), generated from the `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` decorators already present on every controller — treat it as the live, always-in-sync source of exact request/response schemas; this document focuses on structure, flow, and the "why" instead of duplicating every field (duplicating that in prose is exactly what let the previous version of this documentation drift out of sync with the real API).

## Module map

Each feature lives under `src/modules/<name>/`, generally shaped as:

```
modules/<name>/
  <name>.module.ts
  <name>.controller.ts
  <name>.service.ts
  <name>.service.spec.ts
  schema/<name>.schema.ts
  dto/*.dto.ts
```

Modules registered in `src/app.module.ts`:

| Module | Owns |
|---|---|
| `UserModule` | Student/customer accounts, profile, addresses, payment methods |
| `VendorModule` | Vendor accounts, public vendor discovery, vendor dashboard/analytics, vendor payout routes |
| `ProductsModule` | Product catalog, stock/availability, nearby-products search |
| `CategoriesModule` | Product category taxonomy |
| `FlashSaleModule` | Bidding-style flash sales |
| `OrdersModule` | Order lifecycle, delivery confirmation |
| `PaymentsModule` | Paystack payment lifecycle, vendor payout request/admin-approval/disbursement (`PayoutsService`) |
| `ChatModule` | Buyer↔vendor conversations (REST + WebSocket) |
| `NotificationsModule` | Cross-cutting notification delivery (REST + WebSocket) |
| `ReviewsModule` | Per-product/vendor reviews tied to completed orders |
| `SearchModule` | Cross-collection text search |
| `CloudinaryModule` (uploads) | Generic image upload endpoints + the underlying Cloudinary client used by other modules |

See `docs/<module>.md` for each module's detail.

## Conventions used throughout the codebase

These are established patterns — new code should follow them rather than introduce new ones.

**Auth guards.** Protected routes use `@UseGuards(AccessTokenGuard, RolesGuard)` plus `@Roles("student" | "vendor" | "admin")` (from `src/common/guards/` and `src/common/decorators/roles.decorator.ts`). The authenticated actor's id/role is read from `req.user.sub` / `req.user.role` — there is no `@CurrentUser()` decorator in this codebase. See [authentication.md](./authentication.md).

**Live account-status enforcement.** `AccessTokenStrategy.validate()` no longer just trusts the JWT payload — it also checks the account's current `isActive` status on every request (`src/common/guards/account-status.ts` resolves the right model, `User` or `Vendor`, from the token's `role`), cached per account for 30 seconds (`@nestjs/cache-manager`) so this doesn't mean a DB read on every single request. An admin suspending a user/vendor also explicitly evicts that cache entry, so the suspension takes effect immediately rather than waiting out the 30-second window. A still-valid, unexpired access token for a now-suspended account is rejected with `401 UnauthorizedException("This account is not active")` — previously, suspension only took effect the next time the account tried to log in or refresh.

**Cross-module data access.** Two patterns coexist, by design:
1. A module injects another module's **Mongoose model directly** for read-only cross-references (e.g. `OrdersService` reads `User`/`Product`/`Vendor` models directly rather than calling their services). This is the majority pattern for queries and aggregations.
2. A module injects another module's **service** when it needs to trigger a side effect or reuse real business logic rather than just read data — e.g. any module that needs to send a notification injects `NotificationsService` and calls its one public entry point:
   ```ts
   notify(userId: string, userType: 'customer' | 'vendor', type: string, title: string, message: string, data?: Record<string, any>)
   ```
   `NotificationsModule` never imports anything back from its callers, keeping the dependency direction one-way. `OrdersService` and `FlashSaleService` both call into `PaymentsService`/`NotificationsService` this way — see [orders.md](./orders.md), [flash-sales.md](./flash-sales.md), [notifications.md](./notifications.md).

**Response shape.** There is **no single global response wrapper** — this predates the recent work and hasn't been normalized project-wide. Most controllers return `{ success: true, message: string, data: <payload> }`, but a few older modules (parts of `products`, `users`, `vendors`) spread fields directly (e.g. `{ success, message, user }` or `{ success, message, ...result }`). Each module doc states the actual shape that module uses — don't assume it's uniform.

**Pagination.** List endpoints generally accept `page` (default 1) and `limit` (default 10) query params, clamp them to a minimum of 1, compute `skip = (page-1)*limit`, run the query and a `countDocuments` in parallel, and return `{ items, total, page, limit }` (sometimes nested under `data`).

**Validation.** DTOs use `class-validator` decorators paired 1:1 with `@ApiProperty`/`@ApiPropertyOptional` for Swagger. Mongo id path/body params are validated with `@IsMongoId()` or a manual `Types.ObjectId.isValid()` check that throws `BadRequestException`.

**Error vocabulary.** `BadRequestException` (invalid input/id), `NotFoundException`, `ForbiddenException` (ownership/role violations), `ConflictException` (invalid state transition, duplicate resource), `InternalServerErrorException` (wraps unexpected `.save()`/gateway failures, always logged first via `Logger`).

**Caching.** Redis-backed cache-aside is used selectively (not globally) — currently `ProductsService`, `OrdersService`, and `NotificationsService` cache individual reads and list queries with short TTLs (5–10 minutes), invalidating by key or key-prefix on writes. Don't assume every read is cached; check the specific module doc.

## Known structural quirks worth knowing about

- Several feature modules (`products`, `orders`, `vendors`, `categories`, `reviews`, `uploads`, `flash-sales`, `notifications`) each independently register their own `JwtModule.registerAsync(...)` and JWT strategies rather than sharing one central `AuthModule`. This is pre-existing and intentional-enough to leave alone — every module registers the strategy as `global: true`, so it's redundant but not broken.
- **WebSocket gateways now share one auth service.** `SocketAuthService` (`src/modules/notifications/socket-auth/`) verifies the JWT during the socket.io handshake (via namespace middleware, `afterInit`) and restricts allowed origins; both `NotificationsGateway` and `ChatGateway` use it. This replaced two independent, inconsistent implementations — the Notifications gateway previously verified a token only inside `handleConnection` with no origin restriction, and the Chat gateway previously had **no authentication at all** (open CORS, any socket could connect and claim to be any user). See `docs/chat.md` and `docs/notifications.md`.
- `PESEWAS_PER_CEDI` (the pesewas-per-cedi conversion constant) is independently defined in both `payment.service.ts` and `payouts.service.ts` rather than shared from one place, specifically to avoid a circular import — `PaymentsService` injects `PayoutsService` (to route Paystack transfer webhooks), so `PayoutsService` must not import anything back from `PaymentsService`.
