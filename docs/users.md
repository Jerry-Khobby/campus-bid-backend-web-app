# Users

## Overview
The Users module owns the **student** account: registration, login, profile, saved addresses, saved payment methods, and Google OAuth sign-in. A "student" is any account whose `role` is `student` (the default), as opposed to a `vendor` account (see `docs/vendors.md`) or `admin`. Both students and vendors are persisted in separate Mongoose collections (`User` vs `Vendor`) with separate JWT-issuing logic, but share the same `AccessTokenGuard`/`RolesGuard`/`@Roles(...)` authorization pattern and several DTOs (e.g. vendors reuse the Users module's `ChangePasswordDto`, `ForgotPasswordDto`, `ResetPasswordDto`).

Addresses on a user record double as delivery/pickup locations (GeoJSON `Point`), and saved payment methods store only non-sensitive display data (type, provider, last 4 digits) — there is no evidence of real card/PAN storage or a payment-gateway tokenization call in this module.

## Data Model
Collection: `users` (Mongoose model `User`, `{ timestamps: true }` — adds `createdAt`/`updatedAt`).

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `authProvider` | `'local' \| 'google'` | default `'local'` | Set to `'google'` on first Google sign-in |
| `oauth.googleId` | String | default `{}` | Only `googleId` sub-field |
| `email` | String | required, unique, lowercased, trimmed | |
| `password` | String | required only when `authProvider === 'local'` | Absent/null for Google-only accounts |
| `role` | String enum `student\|admin\|vendor` | default `'student'` | Drives `@Roles(...)` checks |
| `profile` | Object | default `{}` | See Profile sub-table |
| `addresses` | Array | default `[]` | See Address sub-table |
| `savedItems` | `ObjectId[]` (ref `Product`) | default `[]` | Not exposed by any endpoint in this module |
| `paymentMethods` | Array | default `[]` | See Payment Method sub-table |
| `refreshToken` | String | default `null` | Stores the argon2 hash of the current refresh token |
| `isVerified` | Boolean | default `false` | Set `true` automatically for Google sign-ups; no email-verification flow exists in this module |
| `isActive` | Boolean | default `true` | Not read/enforced anywhere in this module's code |

**Profile sub-schema**

| Field | Type | Notes |
|---|---|---|
| `firstName` | String | |
| `lastName` | String | |
| `phoneNumber` | String | |
| `studentId` | String | |
| `university` | String | |
| `profileImage` | String | Cloudinary URL |

**Address sub-schema** (subdocuments, each gets an auto `_id`)

| Field | Type | Notes |
|---|---|---|
| `label` | String | |
| `building` | String | optional |
| `room` | String | optional |
| `location.type` | `'Point'` | GeoJSON |
| `location.coordinates` | `[number, number]` | `[longitude, latitude]`; indexed `2dsphere` |
| `instructions` | String | optional |
| `isDefault` | Boolean | default `false` |

**Payment Method sub-schema** (subdocuments, each gets an auto `_id`)

| Field | Type | Notes |
|---|---|---|
| `type` | String | e.g. `'card'`, `'mobile_money'` (free text, not enum-enforced) |
| `provider` | String | |
| `last4` | String | |
| `isDefault` | Boolean | default `false` |
| `metadata` | Object | free-form |

**Indexes:** `addresses.location.coordinates` — `2dsphere` (declared on the nested array field). No other explicit indexes beyond the unique `email`.

## Authentication
Protected routes use `@UseGuards(AccessTokenGuard, RolesGuard)` plus `@Roles("student")`. `AccessTokenGuard` is a thin wrapper around Passport's `jwt` strategy (`AccessTokenStrategy`), which validates the bearer access token against `JWT_SECRET` and attaches the decoded payload (`{ sub, email, role }`) to `req.user`. `RolesGuard` then checks `req.user.role` against the roles declared via `@Roles(...)`; if the user's role isn't in the list it throws a 403 `ForbiddenException`. The refresh endpoint instead uses `RefreshTokenGuard` (Passport strategy `jwt-refresh`, validates against `JWT_REFRESH_SECRET`) with no `@Roles` restriction.

Public (no guard) routes: `register`, `login`, `forgot-password`, `reset-password`, `google`, `google/callback`.

## Endpoints

### Registration & Login

#### `POST /api/users/register`
- **Auth:** public
- **Request:** `multipart/form-data` — `profileImage` (optional file) + `CreateUserDto` fields: `email` (string, required), `password` (string, required, strong-password rules: min 8 chars, upper/lower/number/symbol), `refreshToken` (string, required by the DTO though unused by the handler), `profile` (optional nested object: `firstName`, `lastName`, `phoneNumber`, `studentId`, `university`, `profileImage`), `addresses` (optional array), `savedItems` (optional string array), `paymentMethods` (optional array), `role` (optional string)
- **Response:** `{ success: true, message: "User registered successfully", user: SafeUser, accessToken, refreshToken }` (service returns `{ user, accessToken, refreshToken }`, spread into the controller's envelope)
- **Errors:** 409 `ConflictException` if the email exists in cache or DB; 500 `InternalServerErrorException` if the DB save fails
- Uploads `profileImage` to Cloudinary first (if provided) and stores its `secure_url` on `profile.profileImage`; also caches `{id, email}` under `user:<email>` for 1 hour.

#### `POST /api/users/login`
- **Auth:** public
- **Request:** `LoginDto` — `email` (string, required), `password` (string, required, same strong-password validator as register)
- **Response:** `{ success: true, message: "Login successful", user: SafeUser, accessToken, refreshToken }`
- **Errors:** 404 `NotFoundException("Invalid email or password")` if no user found; 401 `UnauthorizedException` if the account has no password (Google-only account) or the password doesn't match
- Looks up the user via cache first (`user:<email>`), falling back to a DB query.

#### `POST /api/users/refresh`
- **Auth:** authenticated via `RefreshTokenGuard` (valid refresh token in `Authorization: Bearer`), no role restriction
- **Request:** no body — refresh token comes from the `Authorization` header
- **Response:** `{ success: true, message: "Tokens refreshed successfully", tokens: { accessToken, refreshToken } }`
- **Errors:** 403 `ForbiddenException("Access Denied")` if the user has no stored refresh token or the presented token doesn't match the stored (argon2) hash

#### `POST /api/users/logout`
- **Auth:** authenticated (`student`)
- **Request:** none
- **Response:** `{ success: true, message: "Logged out successfully" }`
- Clears `refreshToken` to `null` on the user document.

### Password Management

#### `POST /api/users/change-password`
- **Auth:** authenticated (`student`)
- **Request:** `ChangePasswordDto` — `oldPassword`, `newPassword` (both required, strong-password rules)
- **Response:** `{ success: true, message: "Password updated successfully" }` (returned directly by the service, not wrapped by the controller)
- **Errors:** 404 if user not found; 401 if the account has no password (Google-only) or `oldPassword` doesn't match

#### `POST /api/users/forgot-password`
- **Auth:** public
- **Request:** `ForgotPasswordDto` — `email` (required)
- **Response:** `{ success: true, message: "Password reset link sent to your email", resetToken }`
- **Errors:** 404 if no account matches the email; 500 if the email fails to send
- Generates a random 32-byte hex token, caches it (`reset:<token>` → userId) for 15 minutes, and emails a reset link. **Note:** the response includes the raw `resetToken` in the body (commented `// remove in production` in the source) — this leaks the reset token in the API response rather than only via email.

#### `POST /api/users/reset-password`
- **Auth:** public
- **Request:** `ResetPasswordDto` — `token` (required), `newPassword` (required, strong-password rules)
- **Response:** `{ success: true, message: "Password has been reset successfully" }`
- **Errors:** 401 if the token is invalid/expired (cache miss); 404 if the underlying user no longer exists
- Deletes the cache entry after a successful reset (single-use token).

### Profile

#### `GET /api/users/profile`
- **Auth:** authenticated (`student`)
- **Request:** none
- **Response:** `{ success: true, message: "Profile fetched successfully", user: SafeUser }`
- **Errors:** 404 if user not found

#### `PUT /api/users/profile`
- **Auth:** authenticated (`student`)
- **Request:** `UpdateProfileDto` — `profile` (optional nested object, all fields optional: `firstName`, `lastName`, `phoneNumber`, `studentId`, `university`, `profileImage`)
- **Response:** `{ success: true, message: "Profile updated successfully", user: SafeUser }`
- **Errors:** 404 if user not found
- Merges (`Object.assign`-style spread) the given `profile` fields onto the existing profile rather than replacing it.

#### `POST /api/users/profile/image`
- **Auth:** authenticated (`student`)
- **Request:** `multipart/form-data` field `profileImage` (file)
- **Response:** `{ success: true, message: "Profile image updated successfully", user: SafeUser }`
- **Errors:** 404 if user not found
- Uploads to Cloudinary via `CloudinaryService.uploadImage`, then stores the returned `secure_url` on `profile.profileImage`.

### Addresses

#### `GET /api/users/addresses`
- **Auth:** authenticated (`student`)
- **Response:** `{ success: true, message: "Addresses fetched successfully", addresses: Address[] }`
- **Errors:** 404 if user not found

#### `POST /api/users/addresses`
- **Auth:** authenticated (`student`)
- **Request:** `CreateAddressDto` — `label` (string, required), `building`/`room`/`instructions` (optional strings), `latitude`/`longitude` (numbers, required), `isDefault` (optional boolean)
- **Response:** `{ success: true, message: "Address added successfully", addresses: Address[] }` (the full updated array)
- **Errors:** 404 if user not found
- If `isDefault` is true, first unsets `isDefault` on every existing address (`clearDefaultAddresses`) before pushing the new one.

#### `PUT /api/users/addresses/:id`
- **Auth:** authenticated (`student`)
- **Request:** path `id` (address subdocument id); body `UpdateAddressDto` (all `CreateAddressDto` fields optional, via `PartialType`)
- **Response:** `{ success: true, message: "Address updated successfully", addresses: Address[] }`
- **Errors:** 400 `BadRequestException` if `id` is not a valid ObjectId; 404 if user or the address subdocument isn't found
- If `isDefault` is set true, unsets `isDefault` on all other addresses in memory before saving; latitude/longitude updates are merged into `location.coordinates` (falling back to existing values for whichever of the two isn't supplied).

#### `DELETE /api/users/addresses/:id`
- **Auth:** authenticated (`student`)
- **Response:** `{ success: true, message: "Address deleted successfully", addresses: Address[] }` (remaining addresses)
- **Errors:** 400 if `id` is not a valid ObjectId; 404 if user or address not found

### Payment Methods

#### `GET /api/users/payment-methods`
- **Auth:** authenticated (`student`)
- **Response:** `{ success: true, message: "Payment methods fetched successfully", paymentMethods: PaymentMethod[] }`
- **Errors:** 404 if user not found

#### `POST /api/users/payment-methods`
- **Auth:** authenticated (`student`)
- **Request:** `CreatePaymentMethodDto` — `type` (string, required), `provider` (string, required), `last4` (string, required), `isDefault` (optional boolean), `metadata` (optional object)
- **Response:** `{ success: true, message: "Payment method added successfully", paymentMethods: PaymentMethod[] }`
- **Errors:** 404 if user not found
- If `isDefault` is true, unsets `isDefault` on all existing payment methods first.

#### `DELETE /api/users/payment-methods/:id`
- **Auth:** authenticated (`student`)
- **Response:** `{ success: true, message: "Payment method deleted successfully", paymentMethods: PaymentMethod[] }`
- **Errors:** 400 if `id` is not a valid ObjectId; 404 if user or payment method not found

### Google OAuth

#### `GET /api/users/google`
- **Auth:** public (initiates OAuth; guarded by Passport's `google` strategy which redirects to Google's consent screen)
- **Response:** HTTP 302 redirect to Google; no body (handler is empty, Passport handles it)

#### `GET /api/users/google/callback`
- **Auth:** public entry point, but requires a valid Google OAuth session (`AuthGuard('google')`) — Google redirects here after consent
- **Request:** none (query params/state handled by Passport)
- **Response:** `{ success: true, user: SafeUser, accessToken, refreshToken }` (from `handleGoogleLogin`, returned as-is by the controller — **not** wrapped in the `{success, message, user}` shape used elsewhere in this module; there is no top-level `message` field, and the Swagger example in the code shows only `email`/`role` on `user`, which understates the actual full `SafeUser` payload returned)
- **Errors:** 500 `InternalServerErrorException` if Google doesn't supply an email
- On first login for a given email, creates a new `local`→ no, creates a new user with `authProvider: 'google'`, `role: 'student'`, `isVerified: true`, and no password. If a `local` account with that email already exists and has no `oauth.googleId` yet, it is upgraded in place (`oauth.googleId` set, `authProvider` set to `'google'`) — the existing password (if any) is left untouched, so the account becomes usable via both local login and Google afterward.

## Business Rules & Notes
- **Response shape is inconsistent within this module itself:** most endpoints return `{ success, message, <dataKey> }` (e.g. `user`, `addresses`, `paymentMethods`, `tokens`), but `changePassword`, `forgotPassword`, and `resetPassword` return the service's raw `{ success, message }` object directly (no controller-level wrapping, though the shape happens to coincide), and `googleCallback` returns `{ success, user, accessToken, refreshToken }` with no `message` key at all.
- **Password exclusion:** `excludePassword` strips only the `password` field before returning a user — `refreshToken` (the argon2 hash) is *not* stripped and is present on the `SafeUser` objects returned from most endpoints (e.g. profile, login, register).
- **Forgot-password token leakage:** the plaintext `resetToken` is included in the `forgot-password` HTTP response body in addition to being emailed — a marked `// remove in production` comment in the source confirms this is a known placeholder, not intentional design.
- **Cross-module dependency:** `CloudinaryService` (from the `uploads` module) is used for both registration-time and on-demand profile image uploads.
- **Cross-module dependency:** `MailService` (from `utils`) sends the password-reset email; a send failure is converted to a 500 rather than silently ignored.
- **Caching:** user lookups by email are cached (`user:<email>`, 1 hour TTL) on register/login and refreshed on profile-affecting writes is *not* done for the Users module (unlike Vendors, which refreshes its cache entry after several profile-related updates) — the Users module never invalidates or refreshes `user:<email>` after the initial write, so cached lookups can go stale relative to DB state until the TTL expires.
- **`savedItems`** exists on the schema (references to `Product`) but has no corresponding endpoint in this module to read or mutate it.
- **`isActive`** is stored but never checked by any guard or service method in this module (an inactive user can still log in and use the API).
- **CreateUserDto.refreshToken** is declared as a required string on the registration DTO but is never read by `createUser` — a client must supply some string value to pass validation even though it's discarded.
