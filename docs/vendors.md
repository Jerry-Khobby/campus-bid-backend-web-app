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
| `accountNumber` | String | optional — doubles as the mobile money phone number when `momoProvider` is set |
| `bankName` | String | optional, legacy free text — no longer used for payouts (kept for backward compatibility with existing records) |
| `momoProvider` | enum `mtn` \| `vod` \| `atl` | optional — the actual payout destination for admin-approved transfers, same provider codes already used for customer mobile money charges (`docs/payments.md`); an admin cannot approve a payout until a vendor has set `accountName`, `accountNumber`, **and** `momoProvider` |
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
- **Auth:** public, rate-limited
- **Request:** `multipart/form-data` — `logo` (optional file, validated by `IMAGE_UPLOAD_OPTIONS`: jpeg/png/webp only, 5MB max — see `docs/architecture.md`) + `CreateVendorDto`: `email` (required), `password` (required, strong-password rules), `profile` (required nested object: `businessName` required, `phoneNumber` required, `ownerName`/`description`/`logo`/`banner` optional), `categories` (optional string array)
- **Response:** `{ success: true, message: "Vendor registered successfully. An admin must approve the account before you can sign in.", vendor: SafeVendor }` — **no longer returns `accessToken`/`refreshToken`.** A newly-registered vendor starts `isActive: false` and can't actually sign in yet (see `docs/architecture.md`'s live account-status check), so issuing tokens at registration time was misleading; the vendor must wait for admin approval and then log in normally.
- **Errors:** 409 `ConflictException` if email already registered; 500 if the save fails
- `role` is forced to `"vendor"` server-side (ignores any client-supplied value, since `CreateVendorDto` doesn't even expose `role`). If a `logo` file is uploaded it takes precedence over `profile.logo` from the body.

#### `POST /api/vendors/login`
- **Auth:** public, rate-limited (`SENSITIVE_THROTTLE` — see `docs/architecture.md`)
- **Request:** `VendorLoginDto` — `email`, `password` (both required, strong-password rules)
- **Response:** `{ success: true, message: "Login successful", vendor: SafeVendor, accessToken, refreshToken }`
- **Errors:** `401 UnauthorizedException("Invalid email or password")` for **all** of: unknown email, a Google-only account (no password), or a wrong password — these used to return different statuses/messages (404 vs 401 vs 401), which let a caller enumerate which vendor emails exist; now `isPasswordCorrect` always runs a `bcrypt.compare` against either the real hash or a cached dummy hash of the same cost, so the response takes the same time either way. A vendor with `isActive: false` (pending approval, or suspended) gets `403 ForbiddenException` with an explicit message distinguishing the two cases, after the password check succeeds.

#### `POST /api/vendors/refresh`
- **Auth:** `RefreshTokenGuard` + `@Roles("vendor")`
- **Response:** `{ success: true, message: "Tokens refreshed successfully", tokens: { accessToken, refreshToken } }`
- **Errors:** 403 `ForbiddenException("Access Denied")` if no stored refresh token or hash mismatch

#### `POST /api/vendors/logout`
- **Auth:** authenticated (`vendor`)
- **Response:** `{ success: true, message: "Logged out successfully" }` (note: the service's internal message is `"User logged out successfully"`, but the controller overrides it with a hardcoded `"Logged out successfully"` string rather than returning the service result directly)

### Password Management

#### `POST /api/vendors/change-password`
- **Auth:** authenticated (`vendor`), rate-limited
- **Request:** `ChangePasswordDto` (reused from the Users module) — `oldPassword`, `newPassword`
- **Response:** `{ success: true, message: "Password changed successfully" }`
- **Errors:** 404 if vendor not found; 401 if OAuth-only account or old password mismatch
- Also clears the stored `refreshToken` hash, ending every existing session on this account — including a session an attacker who had the old password might already hold.

#### `POST /api/vendors/forgot-password`
- **Auth:** public, rate-limited
- **Request:** `ForgotPasswordDto` — `email`
- **Response:** `{ success: true, message: "If a vendor account exists for this email, a password reset link has been sent" }` — **always** this response, whether or not the email matches a vendor, so this endpoint can't be used to enumerate vendor accounts. The raw `resetToken` is no longer returned in the body (see Business Rules) — it only ever reaches the vendor via the emailed link. Email sending happens without blocking the response (fire-and-forget), so a known email isn't measurably slower to respond to than an unknown one.
- Reset link points at `${VENDOR_APP_URL}/vendor/reset-password?token=...`.

#### `POST /api/vendors/reset-password`
- **Auth:** public, rate-limited
- **Request:** `ResetPasswordDto` — `token`, `newPassword`
- **Response:** `{ success: true, message: "Password reset successfully" }`
- **Errors:** 401 if token invalid/expired; 404 if vendor no longer exists
- Also clears the stored `refreshToken` hash (same reasoning as change-password).

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
- **Request:** `UpdateBankDetailsDto` — all optional: `accountName`, `accountNumber` (validated as a Ghanaian phone number, `/^0\d{9}$/`, when present), `bankName` (legacy, unused by payouts), `momoProvider` (`mtn`\|`vod`\|`atl`), `isVerified`
- **Response:** `{ success: true, message: "Bank details updated successfully", bankDetails: BankDetails }`
- **Errors:** 404 if not found
- **Note:** a vendor can set `isVerified: true` on their own bank details via this endpoint — there is no separate admin-only verification gate in this module's code. Setting `momoProvider`/`accountName`/`accountNumber` is what makes the vendor eligible for an admin to actually approve their next payout (see `docs/payments.md`).

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
- **Response:** **HTTP 302 redirect**, not a JSON body — the browser is mid-redirect from Google and can't read a JSON response here. On success: `${VENDOR_APP_URL}/auth/google/callback?accessToken=...&refreshToken=...`. On failure: `${VENDOR_APP_URL}/auth/google/callback?error=<message>` — with `&email=<email>` appended **only** when the failure was specifically "no vendor account exists for this email" (`NotFoundException`), so the frontend can offer to pre-fill a sign-up form; a pending or suspended vendor's error redirects without the email param and stays on the sign-in page instead.
- **Vendors do not auto-create on Google login.** `handleGoogleLogin` throws `NotFoundException` for an email with no existing vendor record — a vendor must already exist (via `POST /vendors/register`) before Google sign-in will work for it. If a `local` vendor with that email exists without `oauth.googleId` yet, it's upgraded in place (`oauth.googleId` set, `authProvider: 'google'`), same as the Users module; the vendor's `isActive` status is checked the same way as local login (see `POST /api/vendors/login` above) before tokens are issued.

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
- **Response shape is consistent** within this module — essentially every endpoint returns `{ success, message, <dataKey> }` (`vendor`, `data`, `location`, `businessHours`, `bankDetails`, `tokens`), unlike the Users module which has a few unwrapped/inconsistent returns.
- **Live account-status check, not just a login-time gate:** an existing access token for a suspended/deactivated vendor stops working within 30 seconds of the admin flipping `isActive`, not just at the token's natural 15-minute expiry — see `docs/architecture.md`. Admin approve/suspend now also explicitly evicts that cache entry (`cacheManager.del`) rather than waiting out the TTL.
- **Session revocation on password change:** `change-password` and `reset-password` both clear the stored `refreshToken` hash, so any refresh token issued before the change (including one an attacker might hold) stops working immediately; the vendor must log in again.
- **No account enumeration via auth routes:** login and forgot-password both give identical responses regardless of whether the email exists — see the endpoint descriptions above.
- **Unused DTO:** `VendorResponseDto` (`dto/vendor-response.dto.ts`, a `class-transformer` `@Exclude`/`@Expose` DTO) is not referenced anywhere in the controller or service — the actual serialization is done ad hoc via `VendorService.excludePassword`, which strips `password` and `refreshToken` (unlike the Users module's `excludePassword`, which strips only `password` and leaves `refreshToken` in the payload).
- **`stats` is dead data:** `Vendor.stats` (`totalOrders`, `completedOrders`, `totalRevenue`) is defined on the schema and exposed in `toPublicVendor`, but nothing in this module ever writes to it — dashboard/analytics figures are computed live from the `orders` collection instead, so `stats` will always read as its zero defaults unless some other module updates it (not found in this codebase's Vendors/Products/Orders code searched).
- **Cache refresh is inconsistent:** `updateProfile`, `updateLocation`, `updateBusinessHours`, and `updateBankDetails` all call `refreshVendorCache` after saving, but `updateLogo` and `updateBanner` do not — a minor inconsistency versus the rest of the profile-mutation endpoints.
- **Text index unused:** a compound text index exists on `profile.businessName`/`profile.description`, but no query in this module performs a `$text` search — discovery (`GET /vendors`) only supports category filter, geo-distance, and simple field sorts.
- **`isOpen` computation is server-time-based**, not vendor-timezone-aware (see `GET /api/vendors/:id`).
- **Bank verification has no admin gate:** `PUT /api/vendors/bank-details` lets the vendor set `bankDetails.isVerified` themselves; there's no separate privileged endpoint in this module to control that flag.
- **Cross-module dependencies:** `CloudinaryService` (logo/banner uploads), `MailService` (password reset emails), `ProductsService` (vendor's/public product listings), `FlashSaleService` (vendor flash sales, dashboard active count), `OrdersService` (vendor orders, dashboard/analytics source data alongside direct `Order` model aggregation), `PayoutsService` (balances, payout requests, held payments).
- **JWT secret configuration duplication:** `VendorModule` registers its own `JwtModule` with `JWT_ACCESS_SECRET` as the default signing secret, but `VendorService.getTokens` explicitly passes `JWT_SECRET`/`JWT_REFRESH_SECRET` on every `signAsync` call, so the module-level default is effectively unused for vendor tokens — worth noting as an unused/confusing config value rather than an active bug.
