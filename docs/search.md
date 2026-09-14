# Search

## Overview
The Search module provides a single public endpoint that performs free-text search across `Product` and `Vendor` documents using MongoDB's `$text` operator. It owns no schema or database collection of its own — `SearchService` injects the `Product` and `Vendor` Mongoose models directly (registered independently in `SearchModule` via `MongooseModule.forFeature`, reusing the schemas defined in the Products and Vendors modules) rather than depending on `ProductsService`/a Vendors service.

This is a read-only, aggregation-free module: it runs two `$text` queries (one per collection) in parallel depending on the requested `type`, and merges the results into a single payload.

## Data Model
This module defines no schema of its own. It relies on text indexes declared in other modules' schema files:

| Index | Declared in | Fields | Enables |
|---|---|---|---|
| `{ name: "text", category: 1 }` | `src/modules/products/schema/product.schema.ts` | `name` (text), `category` (ascending, part of the same compound index) | The `$text: { $search: ... }` query in `SearchService.searchProducts` — matches against product **names only** (the compound index's text component covers just `name`, not `description` or `tags`) |
| `{ "profile.businessName": "text", "profile.description": "text" }` | `src/modules/vendors/schema/vendor.schema.ts` | `profile.businessName`, `profile.description` | The `$text: { $search: ... }` query in `SearchService.searchVendors` — matches vendor business name and description |

Both are declared where the underlying schema is owned (Product and Vendor modules respectively), not inside the Search module itself. `SearchModule` just re-registers those same schemas so it can inject their models.

## Authentication
The single route in this module (`GET /api/search`) is fully public — no guard is applied.

## Endpoints

### `GET /api/search`
- **Auth:** public
- **Request:** query = `SearchQueryDto` — `q` (string, optional per the DTO's `@IsOptional()`, but effectively **required at runtime**), `type` (one of `"products" | "vendors" | "all"`, optional, defaults to `"all"`), `category` (string, optional, applied only to the product search)
- **Response:** `{ success: true, message: "Search results fetched successfully", data: { products: any[], vendors: any[], totalResults: number } }`
- **Errors:** `BadRequestException("Search query \"q\" is required")` if `q` is missing/falsy — thrown by the service even though the DTO itself marks `q` optional (a validation-layer inconsistency: an empty query string passes `class-validator` but is rejected by the service)
- Business rule: each matched result set is capped at 20 documents (`SEARCH_RESULT_LIMIT`) and sorted by MongoDB's computed `textScore` (best match first).

## Business Rules & Notes
- **`type` controls which collections are queried:** `"products"` → only `searchProducts`; `"vendors"` → only `searchVendors`; `"all"` (default) → both, run concurrently via `Promise.all`. The skipped side resolves to an empty array rather than being omitted from the response shape.
- **`category` filter only applies to products.** Passing `category` while `type=vendors` has no effect since `searchVendors` doesn't accept it.
- **Both queries use `{ score: { $meta: "textScore" } }`** as a projection and sort key, which requires the respective `$text` index to exist — without it, MongoDB throws a runtime error (`text index required`), which is not specifically caught here and would surface as an unhandled 500.
- **No pagination:** results are a flat top-N (20) list per collection with no page/skip support, unlike Products' own list/filter endpoint.
- **Independent of `ProductsService`/Categories validation:** unlike the Products module, `SearchService` does not call `CategoriesService.assertActiveCategory` — an arbitrary/nonexistent `category` string simply yields zero product matches rather than a validation error.
- **Return shape inconsistency to note:** `products`/`vendors` are typed `any[]` and returned as raw lean Mongoose documents (via `.lean()`), including the internal `score` field added by the projection — these are not passed through any "safe" transformation like `ProductsService.toSafeProduct`.
