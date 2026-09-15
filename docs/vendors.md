# Vendors

## Overview
The Vendors module owns the **vendor** account: a merchant/seller entity distinct from a student `User` (see `docs/users.md`), stored in its own `vendors` collection with its own auth flow, JWT issuance, and profile shape (business name, location, business hours, bank details, ratings/stats). Vendors both manage their own storefront (profile, logo/banner, location, hours, bank details, payouts) and are discoverable publicly (search/browse, public profile, public product listing).

This module is the most cross-cutting of the two: beyond its own schema, its controller/service directly call into `ProductsService`, `FlashSaleService`, `OrdersService`, and `PayoutsService` to assemble the vendor's product list, flash sales, orders, payouts, and dashboard/analytics data — none of that data is owned by the Vendor schema itself.

## Data Model
Collection: `vendors` (Mongoose model `Vendor`, `{ timestamps: true }`).

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `email` | String | required, unique | Not lowercased/trimmed at the schema level (normalization happens in service code before queries) |
| `password` | String | required only when `authProvider === 'local'` | Absent/null for Google-only vendors |
| `authProvider` | `'local' \| 'google'` | default `'local'` | |
| `oauth.googleId` | String | default `{}` | Sub-schema `OAuth` |
| `role` | String | default `'vendor'` | Not declared as an enum (unlike `User.role`) |
| `profile` | `Profile` (required) | — | See sub-table |
| `location` | `Location` | default `{ type: 'Point', coordinates: [0,0] }` | GeoJSON |
| `businessHours` | `BusinessHour[]` | default `[]` | See sub-table |
| `categories` | `string[]` | default `[]` | Used for discovery filtering |
| `rating` | `Rating` | default `{}` | See sub-table |
| `stats` | `Stats` | default `{}` | See sub-table; **not** kept in sync by any code in this module (no writes to `stats.*` found in the service) |
| `bankDetails` | `BankDetails` | default `{}` | See sub-table |
| `refreshToken` | String | default `null` | argon2 hash of current refresh token |
| `isVerified` | Boolean | default `false` | Set `true` automatically for Google sign-ups |
| `isActive` | Boolean | default `false` | A new self-registration starts pending; an admin must call `PATCH /vendors/:id/approve` before the vendor appears in public discovery/profile lookups |

**Profile sub-schema** (`_id: false`)

| Field | Type | Notes |
|---|---|---|
| `businessName` | String | required |
| `ownerName` | String | optional |
| `phoneNumber` | String | required |
| `description` | String | optional |
| `logo` | String | optional, Cloudinary URL |
| `banner` | String | optional, Cloudinary URL |

**Location sub-schema** (`_id: false`, GeoJSON)

| Field | Type | Notes |
|---|---|---|
| `address` | String | optional |
| `building` | String | optional |
| `type` | `'Point'` | default `'Point'` |
| `coordinates` | `number[]` | required, default `[0,0]`; `[longitude, latitude]` |

**BusinessHour sub-schema** (`_id: false`, array element)

| Field | Type | Notes |
|---|---|---|
| `day` | String | required, e.g. `"Monday"` |
| `openTime` | String | optional, e.g. `"08:00"` |
| `closeTime` | String | optional |
| `isClosed` | Boolean | default `false` |

**Rating sub-schema** (`_id: false`)

| Field | Type | Default |
|---|---|---|
| `average` | Number | 0 |
| `count` | Number | 0 |

**Stats sub-schema** (`_id: false`)

| Field | Type | Default |
|---|---|---|
| `totalOrders` | Number | 0 |
| `completedOrders` | Number | 0 |
| `totalRevenue` | Number | 0 |

**BankDetails sub-schema** (`_id: false`)

| Field | Type | Notes |
|---|---|---|
| `accountName` | String | optional |
| `accountNumber` | String | optional |
| `bankName` | String | optional |
| `isVerified` | Boolean | default `false` |

**Indexes:**
- `location.coordinates` — `2dsphere` (geo discovery/`$geoNear` queries)
- `profile.businessName`, `profile.description` — compound `text` index (declared but no endpoint in this module issues a `$text` search; discovery search only filters by `category`, geo distance, or sorts)

## Authentication
Same pattern as Users: `@UseGuards(AccessTokenGuard, RolesGuard)` with `@Roles("vendor")` on vendor-only routes. `AccessTokenGuard` validates the bearer token via the shared Passport `jwt` strategy against `JWT_SECRET` (note: `VendorModule`'s own `JwtModule.registerAsync` configures a *different* default secret, `JWT_ACCESS_SECRET`, but this is moot because `VendorService.getTokens` explicitly signs with `JWT_SECRET`/`JWT_REFRESH_SECRET`, matching what the shared strategies verify against). `RefreshTokenGuard` + `@Roles("vendor")` protects the refresh endpoint (unlike the Users module, which puts no `@Roles` on its refresh route). Three routes instead use `@Roles("admin")` — see **Admin** below; the `admin` role lives on the `User` schema (`docs/users.md`), not on `Vendor`, since admins authenticate through `POST /users/login` like any other user.

Public routes: `register`, `login`, `GET /vendors` (search/browse), `GET /vendors/:id/products`, `forgot-password`, `reset-password`, `google`, `google/callback`, `GET /vendors/:id` (public profile).

**Routing-order note:** `GET /vendors/:id` is declared last in the controller, after every other `GET`/literal route (including `:id/products`, `admin`, and the `PATCH :id/approve|suspend` admin routes), specifically so the catch-all `:id` param route doesn't shadow more specific routes like `/vendors/profile` or `/vendors/dashboard`. This is intentional and called out in the source with a comment.

## Endpoints

### Registration & Login

#### `POST /api/vendors/register`
- **Auth:** public
- **Request:** `multipart/form-data` — `logo` (optional file) + `CreateVendorDto`: `email` (required), `password` (required, strong-password rules), `profile` (required nested object: `businessName` required, `phoneNumber` required, `ownerName`/`description`/`logo`/`banner` optional), `categories` (optional string array)
- **Response:** `{ success: true, message: "Vendor registered successfully", vendor: SafeVendor, accessToken, refreshToken }`
- **Errors:** 409 `ConflictException` if email already registered; 500 if the save fails
- `role` is forced to `"vendor"` server-side (ignores any client-supplied value, since `CreateVendorDto` doesn't even expose `role`). If a `logo` file is uploaded it takes precedence over `profile.logo` from the body.

#### `POST /api/vendors/login`
- **Auth:** public
- **Request:** `VendorLoginDto` — `email`, `password` (both required, strong-password rules)
- **Response:** `{ success: true, message: "Login successful", vendor: SafeVendor, accessToken, refreshToken }`
- **Errors:** 404 `NotFoundException` if no vendor with that email; 401 if the account has no password (OAuth-only) or password mismatch

#### `POST /api/vendors/refresh`
- **Auth:** `RefreshTokenGuard` + `@Roles("vendor")`
- **Response:** `{ success: true, message: "Tokens refreshed successfully", tokens: { accessToken, refreshToken } }`
- **Errors:** 403 `ForbiddenException("Access Denied")` if no stored refresh token or hash mismatch

#### `POST /api/vendors/logout`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Logged out successfully" }` (note: the service's internal message is `"User logged out successfully"`, but the controller overrides it with a hardcoded `"Logged out successfully"` string rather than returning the service result directly)

### Password Management

#### `POST /api/vendors/change-password`
- **Auth:** authenticated (`vendor`)
- **Request:** `ChangePasswordDto` (reused from the Users module) — `oldPassword`, `newPassword`
- **Response:** `{ success: true, message: "Password changed successfully" }`
- **Errors:** 404 if vendor not found; 401 if OAuth-only account or old password mismatch

#### `POST /api/vendors/forgot-password`
- **Auth:** public
- **Request:** `ForgotPasswordDto` — `email`
- **Response:** `{ success: true, message: "Password reset link sent", resetToken }`
- **Errors:** 404 if no vendor matches; 500 if email send fails
- Same pattern as Users: raw `resetToken` (32-byte hex) is returned in the response body in addition to being emailed, cached for 15 minutes under `vendor-reset:<token>`.

#### `POST /api/vendors/reset-password`
- **Auth:** public
- **Request:** `ResetPasswordDto` — `token`, `newPassword`
- **Response:** `{ success: true, message: "Password reset successfully" }`
- **Errors:** 401 if token invalid/expired; 404 if vendor no longer exists

### Profile

#### `GET /api/vendors/profile`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Profile fetched", vendor: SafeVendor }`
- **Errors:** 404 if not found

#### `PUT /api/vendors/profile`
- **Auth:** authenticated (`vendor`)
- **Request:** `UpdateProfileDto` — all optional: `businessName`, `ownerName`, `phoneNumber`, `description`, `logo`, `banner`
- **Response:** `{ success: true, message: "Profile updated successfully", vendor: SafeVendor }`
- **Errors:** 404 if not found
- Merges fields onto existing `profile`; also refreshes the `vendor:<email>` cache entry.

#### `POST /api/vendors/profile/logo`
- **Auth:** authenticated (`vendor`)
- **Request:** `multipart/form-data` field `logo`
- **Response:** `{ success: true, message: "Logo updated successfully", data: { logo: string } }`
- **Errors:** 404 if not found
- **Note:** unlike `updateProfile`/`updateLocation`/`updateBusinessHours`/`updateBankDetails`, this does **not** call `refreshVendorCache` after saving.

#### `POST /api/vendors/profile/banner`
- **Auth:** authenticated (`vendor`)
- **Request:** `multipart/form-data` field `banner`
- **Response:** `{ success: true, message: "Banner updated successfully", data: { banner: string } }`
- **Errors:** 404 if not found
- Also does not refresh the cache (same as logo update).

#### `POST /api/vendors/update-location`
- **Auth:** authenticated (`vendor`)
- **Request:** `UpdateLocationDto` — `address`/`building` optional, `coordinates` required (`[number, number]`, exactly 2 elements)
- **Response:** `{ success: true, message: "Location updated successfully", location: Location }`
- **Errors:** 404 if not found

#### `POST /api/vendors/update-business-hours`
- **Auth:** authenticated (`vendor`)
- **Request:** `UpdateBusinessHoursDto` — `businessHours: BusinessHourDto[]` (required array; each item: `day` required, `openTime`/`closeTime`/`isClosed` optional)
- **Response:** `{ success: true, message: "Business hours updated successfully", businessHours: BusinessHour[] }`
- **Errors:** 404 if not found
- Fully replaces the `businessHours` array (not a merge).

#### `PUT /api/vendors/bank-details`
- **Auth:** authenticated (`vendor`)
- **Request:** `UpdateBankDetailsDto` — all optional: `accountName`, `accountNumber`, `bankName`, `isVerified`
- **Response:** `{ success: true, message: "Bank details updated successfully", bankDetails: BankDetails }`
- **Errors:** 404 if not found
- **Note:** a vendor can set `isVerified: true` on their own bank details via this endpoint — there is no separate admin-only verification gate in this module's code.

### Public Discovery

#### `GET /api/vendors`
- **Auth:** public
- **Request:** `VendorQueryDto` (query) — `category` (optional string), `latitude`/`longitude`/`maxDistance` (optional numbers), `sortBy` (optional enum `distance|rating|name`), `page` (default 1), `limit` (default 10)
- **Response:** `{ success: true, message: "Vendors fetched successfully", data: { items: PublicVendor[], total, page, limit } }`
- If both `latitude` and `longitude` are given, uses a `$geoNear` aggregation (optionally bounded by `maxDistance`); otherwise sorts by `rating.average` desc, `profile.businessName` asc, or `createdAt` desc (default). Only `isActive: true` vendors are included, optionally filtered by `categories`.
- Each item is reduced to a public shape: `_id`, `profile.businessName`/`profile.logo`, `categories`, `rating`, `stats.totalOrders`, `location`, `businessHours`, `isVerified` — no email, bank details, or full stats are exposed.

#### `GET /api/vendors/:id/products`
- **Auth:** public
- **Request:** path `id` (vendor id); query `FilterProductDto` (defined in the Products module)
- **Response:** `{ success: true, message: "Products fetched successfully", data }` — delegates entirely to `ProductsService.listProducts({ ...query, vendorId: id })`
- No explicit check that the vendor exists or is active before listing its products.

#### `GET /api/vendors/:id`
- **Auth:** public
- **Response:** `{ success: true, message: "Vendor fetched successfully", vendor: { ...PublicVendor, isOpen: boolean } }`
- **Errors:** 404 if no vendor with that id has `isActive: true`
- `isOpen` is computed from `businessHours` against the current UTC-relative server time (`Date.toLocaleDateString`/`toTimeString`) for "today" — no timezone field is stored per vendor, so this is server-local time, not the vendor's local time.

### Vendor Self-Service (products, flash sales, orders, payouts, dashboard, analytics)

#### `GET /api/vendors/products`
- **Auth:** authenticated (`vendor`)
- **Request:** query `FilterProductDto`
- **Response:** `{ success: true, message: "Products fetched successfully", data }`
- Delegates to `ProductsService.listProducts`, forcing `vendorId` to the authenticated vendor (ignores any `vendorId` in the query).

#### `GET /api/vendors/flash-sales`
- **Auth:** authenticated (`vendor`)
- **Request:** query `VendorFlashSaleQueryDto` (Flash Sales module)
- **Response:** `{ success: true, message: "Flash sales fetched successfully", data }`
- Delegates to `FlashSaleService.getVendorFlashSales`.

#### `GET /api/vendors/orders`
- **Auth:** authenticated (`vendor`)
- **Request:** query `OrderQueryDto` (Orders module)
- **Response:** `{ success: true, message: "Orders fetched successfully", data }`
- Delegates to `OrdersService.getOrders(vendorId, "vendor", query)`.

#### `GET /api/vendors/orders/:id`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Order fetched successfully", data }`
- Delegates to `OrdersService.getOrderById(id, vendorId, "vendor")` — access scoping to "this vendor's own order" is enforced inside `OrdersService`, not in this module.

#### `GET /api/vendors/payouts`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Payouts fetched successfully", data }`
- Delegates to `PayoutsService.listPayouts`.

#### `POST /api/vendors/payouts/request`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Payout requested successfully", data }`
- Delegates to `PayoutsService.requestPayout` — all balance/eligibility logic lives in the Payments module, not here.

#### `GET /api/vendors/payouts/held-payments`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Held payments fetched successfully", data }`
- Delegates to `PayoutsService.getHeldPayments`.

#### `GET /api/vendors/dashboard`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Dashboard fetched successfully", data }` where `data` = `{ stats: { today, thisWeek, thisMonth, allTime }, pendingOrders, pendingBalance, availableBalance, activeListings, activeFlashSales, recentOrders }`
- Aggregates order counts/revenue directly from the `orders` collection (via injected `Order` model) for today/7d/30d/all-time; `pendingOrders` counts today's orders with `status: "pending"`; balances come from `PayoutsService.getVendorBalances`; `activeListings` counts the vendor's `isAvailable: true` products; `activeFlashSales` comes from `FlashSaleService.getVendorFlashSales(..., { status: ACTIVE })`; `recentOrders` is the 5 most recent orders with the customer populated (email, first/last name).

#### `GET /api/vendors/analytics/sales`
- **Auth:** authenticated (`vendor`)
- **Request:** query `VendorSalesAnalyticsQueryDto` — `period` (optional enum `today|week|month|year|custom`), `startDate`/`endDate` (optional ISO date strings, required together with `period=custom` to set a custom range)
- **Response:** `{ success: true, message: "Sales analytics fetched successfully", data }` where `data` = `{ totalOrders, completedOrders, cancelledOrders, totalRevenue, averageOrderValue, dailyBreakdown, topProducts }`
- Computed directly via Mongo aggregation on the `orders` collection scoped to the vendor and date range; `topProducts` is the top 5 by revenue within the range, joined against `products`.

#### `GET /api/vendors/analytics/products`
- **Auth:** authenticated (`vendor`)
- **Request:** query `VendorProductAnalyticsQueryDto` — `page` (default 1), `limit` (default 10)
- **Response:** `{ success: true, message: "Product analytics fetched successfully", data }` where `data` = `{ items, total, page, limit }`; each item is `{ name, views, soldCount, rating }` projected from the vendor's products, sorted by `soldCount` desc.

### Google OAuth

#### `GET /api/vendors/google`
- **Auth:** public (Passport `google` strategy redirect)
- **Response:** HTTP 302 to Google's consent screen

#### `GET /api/vendors/google/callback`
- **Auth:** public entry point guarded by `AuthGuard('google')`
- **Response:** **none/undefined.** `VendorService.handleGoogleLogin` finds-or-creates the vendor record but has no `return` statement — the controller method returns whatever the service resolves to, which is `undefined`. This means the vendor google callback currently sends an empty response body and **never issues JWTs**, unlike the equivalent Users module flow which does. This is a functional gap, not a documentation nuance — the Swagger example on this route (in the source) shows a `{ success, user, accessToken, refreshToken }` shape that the code does not actually produce.
- **Errors:** 500 `InternalServerErrorException` if Google doesn't supply an email.
- On first login it creates a vendor with `authProvider: 'google'`, `role: 'vendor'`, `isVerified: true`, `profile.businessName` set to `"<firstName> <lastName>"`, `profile.logo` from the Google photo (or `null`), and `profile.phoneNumber` set to `""` (the schema requires `phoneNumber`, so this satisfies validation with an empty string). If a `local` vendor with that email already exists without `oauth.googleId`, it is upgraded in place the same way as the Users module. Like local registration, this never sets `isActive` explicitly, so a Google-created vendor also starts pending admin approval.

### Admin
Vendors always self-register (there is no admin-create-vendor endpoint); these three routes let an admin review and gate that self-service pipeline. All three require `@Roles("admin")` — a `User` document (not `Vendor`) with `role: "admin"`, obtained by logging in via `POST /users/login`. See `docs/users.md` for how an account gets promoted to admin (there is no public way to self-register as one).

#### `GET /api/vendors/admin`
- **Auth:** authenticated (`admin`)
- **Request:** `AdminVendorQueryDto` (query) — `search` (optional, matches `profile.businessName` or `email`, case-insensitive), `page` (default 1), `limit` (default 20)
- **Response:** `{ success: true, message: "Vendors fetched successfully", data: { items: SafeVendor[], total, page, limit } }`
- Unlike `GET /vendors`, this does **not** filter by `isActive` — it returns pending, active, and suspended vendors alike, with the full `SafeVendor` shape (email, `isActive`, `isVerified`, bank details, etc.) rather than the trimmed public shape.

#### `PATCH /api/vendors/:id/approve`
- **Auth:** authenticated (`admin`)
- **Response:** `{ success: true, message: "Vendor approved successfully", vendor: SafeVendor }`
- **Errors:** 404 if no vendor exists with that id
- Sets `isActive: true`, making the vendor visible in public discovery/profile lookups.

#### `PATCH /api/vendors/:id/suspend`
- **Auth:** authenticated (`admin`)
- **Response:** `{ success: true, message: "Vendor suspended successfully", vendor: SafeVendor }`
- **Errors:** 404 if no vendor exists with that id
- Sets `isActive: false`, the same flag a brand-new pending vendor has — a suspended vendor and a not-yet-approved vendor are indistinguishable by this field alone; both simply don't appear publicly until approved again.

## Business Rules & Notes
- **Google OAuth callback is broken (functional gap):** as detailed above, `POST/GET /api/vendors/google/callback` never returns tokens or a body — a vendor cannot actually complete sign-in through this route today, even though the Swagger annotation implies it works exactly like the Users module's version.
- **Response shape is consistent** within this module — essentially every endpoint returns `{ success, message, <dataKey> }` (`vendor`, `data`, `location`, `businessHours`, `bankDetails`, `tokens`), unlike the Users module which has a few unwrapped/inconsistent returns.
- **Unused DTO:** `VendorResponseDto` (`dto/vendor-response.dto.ts`, a `class-transformer` `@Exclude`/`@Expose` DTO) is not referenced anywhere in the controller or service — the actual serialization is done ad hoc via `VendorService.excludePassword`, which strips `password` and `refreshToken` (unlike the Users module's `excludePassword`, which strips only `password` and leaves `refreshToken` in the payload).
- **`stats` is dead data:** `Vendor.stats` (`totalOrders`, `completedOrders`, `totalRevenue`) is defined on the schema and exposed in `toPublicVendor`, but nothing in this module ever writes to it — dashboard/analytics figures are computed live from the `orders` collection instead, so `stats` will always read as its zero defaults unless some other module updates it (not found in this codebase's Vendors/Products/Orders code searched).
- **Cache refresh is inconsistent:** `updateProfile`, `updateLocation`, `updateBusinessHours`, and `updateBankDetails` all call `refreshVendorCache` after saving, but `updateLogo` and `updateBanner` do not — a minor inconsistency versus the rest of the profile-mutation endpoints.
- **Text index unused:** a compound text index exists on `profile.businessName`/`profile.description`, but no query in this module performs a `$text` search — discovery (`GET /vendors`) only supports category filter, geo-distance, and simple field sorts.
- **`isOpen` computation is server-time-based**, not vendor-timezone-aware (see `GET /api/vendors/:id`).
- **Bank verification has no admin gate:** `PUT /api/vendors/bank-details` lets the vendor set `bankDetails.isVerified` themselves; there's no separate privileged endpoint in this module to control that flag.
- **Cross-module dependencies:** `CloudinaryService` (logo/banner uploads), `MailService` (password reset emails), `ProductsService` (vendor's/public product listings), `FlashSaleService` (vendor flash sales, dashboard active count), `OrdersService` (vendor orders, dashboard/analytics source data alongside direct `Order` model aggregation), `PayoutsService` (balances, payout requests, held payments).
- **JWT secret configuration duplication:** `VendorModule` registers its own `JwtModule` with `JWT_ACCESS_SECRET` as the default signing secret, but `VendorService.getTokens` explicitly passes `JWT_SECRET`/`JWT_REFRESH_SECRET` on every `signAsync` call, so the module-level default is effectively unused for vendor tokens — worth noting as an unused/confusing config value rather than an active bug.
