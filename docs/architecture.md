# Architecture

## Stack

- **Framework:** NestJS 11 (Express adapter)
- **Database:** MongoDB via Mongoose (`@nestjs/mongoose`)
- **Cache:** Redis via `@nestjs/cache-manager` + `cache-manager-redis-store`
- **Realtime:** Socket.IO via `@nestjs/websockets` / `@nestjs/platform-socket.io`
- **Auth:** JWT (access + refresh tokens) via `@nestjs/jwt` + `passport-jwt`, plus Google OAuth via `passport-google-oauth20`
- **File storage:** Cloudinary
- **Payments:** Paystack (REST API, called directly via `axios` — no SDK)
- **Docs:** Swagger/OpenAPI, served at `/api-docs`

## Global request pipeline

Configured in `src/main.ts`:

- Global prefix: every route in this document is written with the `/api` prefix already applied (e.g. a controller decorated `@Controller("products")` with a method `@Get(":id")` is reachable at `GET /api/products/:id`).
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — unknown body/query fields are rejected with a 400, and payloads are transformed into their DTO classes (so `@Type(() => Number)` on query DTOs actually coerces strings to numbers).
- `NestFactory.create(AppModule, { rawBody: true })` — the raw request body is preserved on `req.rawBody`, required by the Paystack webhook handler to verify the HMAC signature (see [payments.md](./payments.md)).
- Swagger UI at `/api-docs`, generated from the `@ApiTags`/`@ApiOperation`/`@ApiResponse`/`@ApiBearerAuth` decorators already present on every controller — treat it as the live, always-in-sync source of exact request/response schemas; this document focuses on structure, flow, and the "why" instead of duplicating every field (duplicating that in prose is exactly what let the previous version of this documentation drift out of sync with the real API).

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
| `PaymentsModule` | Paystack payment lifecycle, vendor payout ledger (`PayoutsService`) |
| `ChatModule` | Buyer↔vendor conversations (REST + WebSocket) |
| `NotificationsModule` | Cross-cutting notification delivery (REST + WebSocket) |
| `ReviewsModule` | Per-product/vendor reviews tied to completed orders |
| `SearchModule` | Cross-collection text search |
| `CloudinaryModule` (uploads) | Generic image upload endpoints + the underlying Cloudinary client used by other modules |

See `docs/<module>.md` for each module's detail.

## Conventions used throughout the codebase

These are established patterns — new code should follow them rather than introduce new ones.

**Auth guards.** Protected routes use `@UseGuards(AccessTokenGuard, RolesGuard)` plus `@Roles("student" | "vendor" | "admin")` (from `src/common/guards/` and `src/common/decorators/roles.decorator.ts`). The authenticated actor's id/role is read from `req.user.sub` / `req.user.role` — there is no `@CurrentUser()` decorator in this codebase. See [authentication.md](./authentication.md).

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
- `src/common/filters/http-exception.filter.ts` exists in the repo but is empty and not wired up anywhere (no `APP_FILTER` provider, no `@UseFilters`) — exception formatting is whatever Nest's default exception filter produces, not a custom one.
