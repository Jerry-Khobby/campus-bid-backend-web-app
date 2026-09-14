# Authentication & Authorization

## Overview

There are two independent account types — **student** (customer) and **vendor** — each with their own registration/login/refresh/logout endpoints (`/users/...` and `/vendors/...`), but both issue the same shape of JWT and are checked by the same shared guards. There is no unified `/auth` module; each account type's controller owns its own auth endpoints.

## Tokens

- **Access token** — JWT, signed with `JWT_SECRET`, 15 minute expiry, sent in every request as `Authorization: Bearer <token>`.
- **Refresh token** — JWT, signed with `JWT_REFRESH_SECRET`, 7 day expiry, also sent as a Bearer token to `POST /users/refresh` or `POST /vendors/refresh` (not via an HTTP-only cookie, despite what older planning documents for this project assumed).

Note: `vendors.module.ts` also registers a module-default `JwtModule` using `JWT_ACCESS_SECRET`, but `vendors.service.ts`'s actual token-signing calls explicitly pass `secret: JWT_SECRET` / `secret: JWT_REFRESH_SECRET` at call time, overriding that default. In practice `JWT_ACCESS_SECRET` doesn't affect vendor token verification today — set it to something non-empty anyway since nothing currently guards against it being unset.
- Both tokens carry the same payload shape: `{ sub: <user id>, email, role }`. `role` is one of `student`, `vendor`, `admin`.

### Refresh token rotation & revocation

The refresh token is never stored in plaintext: on login/register, `updateRefreshToken()` hashes it with `argon2` and stores the hash on the user/vendor document (`refreshToken` field). `POST /users/refresh` (guarded by `RefreshTokenGuard`) verifies the presented refresh token against that stored hash with `argon2.verify`, and if it matches, issues a brand new access+refresh pair and overwrites the stored hash — so refresh tokens are single-use/rotating. `POST /users/logout` (and the vendor equivalent) sets the stored hash back to `null`, which immediately invalidates any outstanding refresh token for that account (the access token, being stateless, remains valid until its own 15 minute expiry regardless of logout).

## Guards & decorators (`src/common/guards/`, `src/common/decorators/`)

| Piece | What it does |
|---|---|
| `AccessTokenGuard` (`jwt-access.guard.ts`) | Extends Passport's `AuthGuard('jwt')`; validates the access token via `AccessTokenStrategy`, which reads `JWT_SECRET` and extracts the Bearer token from the `Authorization` header. |
| `RefreshTokenGuard` (`jwt-refresh.guard.ts`) | `AuthGuard('jwt-refresh')`; validates a token against `JWT_REFRESH_SECRET` via `RefreshTokenStrategy`, and additionally attaches the raw refresh token string itself (not just the decoded payload) onto `req.user.refreshToken` so the controller can pass it along for verification. |
| `RolesGuard` (`roles.guard.ts`) | Reads metadata set by `@Roles(...)`; if the route has no `@Roles` decorator it allows any authenticated request through; otherwise it throws `ForbiddenException` unless `req.user.role` is in the allowed list. |
| `@Roles(...role: string[])` (`roles.decorator.ts`) | `SetMetadata` wrapper — usage: `@Roles("vendor")` or `@Roles("student", "vendor")`. |

**Standard pattern** for a protected, role-restricted route:

```ts
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles("vendor")
@Post("some-action")
async someAction(@Request() req, @Body() dto: SomeDto) {
  const actorId = req.user.sub; // never a @CurrentUser() decorator — this codebase doesn't have one
  ...
}
```

A route with only `@UseGuards(AccessTokenGuard)` (no `RolesGuard`/`@Roles`) means "any authenticated account, regardless of role" — used, for example, by `GET /orders/:id` and `GET /orders/:id/track`, which do their own finer-grained ownership check inside the service instead of a role check.

Public routes simply omit both guards.

## Google OAuth

Both students and vendors support "Login / Register with Google" as an alternative to password auth, implemented per account type (`src/modules/users/oauth/google.strategy.ts` and `src/modules/vendors/oauth/google.strategy.ts`):

- `GET /users/google` / `GET /vendors/google` — redirects to Google's consent screen (`@UseGuards(AuthGuard('google'))`, no handler body — Passport does the redirect).
- `GET /users/google/callback` / `GET /vendors/google/callback` — Google redirects back here; the strategy's `validate()` extracts `{googleId, email, firstName, lastName, profileImage}` from the Google profile, and the controller calls `handleGoogleLogin(req.user)`, which finds-or-creates the account (`authProvider: 'google'`, no `password` required — the schema's `password` field is only `required` when `authProvider === 'local'`) and returns the same `{accessToken, refreshToken, user}` shape as normal login.
- Both strategies throw a startup error (`'Missing required Google OAuth configuration'`) if `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL(_VENDOR)` aren't set — see [environment-variables.md](./environment-variables.md).

## Password handling

- Student/vendor passwords are hashed with `bcrypt` (`BCRYPT_SALT_ROUNDS` env var, default 12 if unset) — not `argon2` (argon2 is used specifically for refresh-token hashing, a separate concern).
- `forgot-password` / `reset-password` flows exist per account type and send email via `MailService` (`src/utils/mail.service.ts`, Gmail SMTP via `nodemailer`, configured from `EMAIL_USER`/`EMAIL_PASS`).

## Notes for future work

- JWT secrets and strategies are re-registered independently in almost every feature module (see [architecture.md](./architecture.md#known-structural-quirks-worth-knowing-about)) rather than shared from one place — functionally fine since all are marked `global: true`, but worth knowing if you're tracing where a secret is read from.
- There's no token blacklist/deny-list for access tokens — revocation only affects the refresh token. A stolen access token remains usable until it naturally expires (≤15 minutes).
