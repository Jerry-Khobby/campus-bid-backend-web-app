# Testing

## Running tests

```bash
npm test            # run the full unit test suite once
npm run test:watch  # watch mode
npm run test:cov    # with coverage report (output/coverage)
npm run test:e2e    # end-to-end tests (separate config: test/jest-e2e.json)
```

## Configuration (`package.json`'s `jest` block)

- `rootDir: "src"` — any `*.spec.ts` file anywhere under `src/` is picked up automatically; there's no separate `test/` directory for unit specs (that's reserved for e2e).
- `transformIgnorePatterns: ["node_modules/(?!(uuid)/)"]` — required because the `uuid` dependency ships ESM-only starting from the major version pinned here; without this, any spec that transitively imports `order.schema.ts` (which generates order numbers with `uuid`) fails at import time.
- `moduleNameMapper: { "^src/(.*)$": "<rootDir>/$1" }` — mirrors the `src/*` path alias declared in `tsconfig.json`'s `paths`, so specs that import via that alias (e.g. `import { AccessTokenStrategy } from "src/common/guards/..."`) resolve correctly under ts-jest.

## Conventions used in existing specs

- Service-level specs (`<name>.service.spec.ts`), not controller-level — controllers in this codebase are thin (parse request → call service → wrap response), so the service is where the actual logic and edge cases live.
- Mongoose models are mocked via `getModelToken('ModelName')` from `@nestjs/mongoose`, with a plain object of `jest.fn()`s standing in for `find`/`findById`/`create`/`save`/etc. — no real database connection is used in unit tests.
- `CACHE_MANAGER`, `ConfigService`, and any injected cross-module service (`NotificationsService`, `PaymentsService`, `CategoriesService`, etc.) are likewise provided as mock objects via Nest's `Test.createTestingModule({ providers: [...] }).compile()`.
- External HTTP calls (Paystack) are tested by mocking `axios` (`jest.mock('axios')`) rather than hitting the network.
- Coverage target per test: the happy path plus the 2–3 error branches that actually exist in the method (not-found, forbidden, invalid-state) — not an exhaustive combinatorial sweep.

## Current state

As of the last full pass, `npm test` runs 14 suites / 167 tests, all passing, covering every module added or modified in the endpoint-completion effort (categories, reviews, search, uploads, payments, payouts, orders, notifications, chat, flash-sales, products, users, vendors). Older, untouched code (e.g. the root `AppController`) only has its original Nest CLI boilerplate spec — there is no repo-wide 100% coverage guarantee, only thorough coverage of what's been actively worked on.
