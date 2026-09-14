# Environment Variables

Copy these into a `.env` file at the project root (not committed — see `.gitignore`). Every variable below is actually read via `process.env.*` or `ConfigService.get(...)` somewhere in `src/`; nothing here is aspirational.

| Variable | Used for | Required to boot? |
|---|---|---|
| `PORT` | HTTP port (`src/main.ts`) | No — defaults to `3000` |
| `MONGODB_URI` | Mongoose connection (`src/app.module.ts`) | **Yes** — app retries forever and never finishes starting without a reachable instance |
| `REDIS_HOST`, `REDIS_PORT` | Cache manager (`src/config/redis-config.ts`) | Effectively yes — several services (`ProductsService`, `OrdersService`, `NotificationsService`) call `CACHE_MANAGER` on the request path |
| `JWT_SECRET` | Access token signing/verification (used directly by almost every module) | Yes, for any authenticated route |
| `JWT_REFRESH_SECRET` | Refresh token signing/verification | Yes, for `/refresh` endpoints |
| `JWT_ACCESS_SECRET` | Registered as `vendors.module.ts`'s default JWT secret (see [authentication.md](./authentication.md)) | Set it, but it's not actually load-bearing today |
| `BCRYPT_SALT_ROUNDS` | Password hashing rounds (`vendors.service.ts`, `user.service.ts`) | No — defaults to `12` |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail SMTP creds for `MailService` (password reset emails) | Only for forgot/reset-password flows |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Student Google OAuth | Only if `GoogleStrategy` (users) is instantiated — throws at startup if any are missing |
| `GOOGLE_CALLBACK_URL_VENDOR` | Vendor Google OAuth callback (shares `GOOGLE_CLIENT_ID`/`SECRET`) | Same as above, vendor side |
| `CLD_CLOUD_NAME`, `CLD_API_KEY`, `CLD_API_SECRET` | Cloudinary config (`cloudinary.provider.ts`) | Only for any endpoint that uploads an image |
| `PAYSTACK_SECRET_KEY` | Paystack API auth + webhook HMAC verification (`paystack.service.ts`) | Only for `/payments/initialize` and the webhook |
| `PAYSTACK_PUBLIC_KEY` | Not currently read server-side, but expected by any frontend integrating Paystack's client-side checkout | No (frontend-only today) |
| `APP_URL` | Builds the Paystack callback URL (`payment.service.ts`) | No — falls back to `http://localhost:3000/api/payments/callback` if unset |

## Notes

- `ConfigModule.forRoot({ isGlobal: true })` loads `.env` automatically — no per-module `ConfigModule.forRoot` calls needed.
- The global `ValidationPipe` and Mongo/Redis connections mean a missing `MONGODB_URI` or unreachable Mongo/Redis instance will not crash the process outright — Mongoose retries the connection indefinitely and logs `MongooseServerSelectionError` every ~30s, and the HTTP server never finishes starting (no port is bound) until a connection succeeds.
- A `Payment.paymentMethod` of `mobile_money` is modeled in the schema, but Paystack's Ghana mobile money channel doesn't require any additional env var beyond `PAYSTACK_SECRET_KEY` — channel selection happens on Paystack's hosted checkout page, not in this backend's code.
