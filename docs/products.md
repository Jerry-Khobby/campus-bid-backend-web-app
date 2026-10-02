# Products

## Overview
The Products module owns the `Product` collection — the items a vendor sells on CampusBid (food, goods, etc.). It handles creating, updating, listing/filtering, and deleting products, as well as vendor-scoped mutations (stock, price, availability, images). It also exposes a public "nearby" endpoint that finds products sold by vendors near a given geographic point.

Products belong to a `category` (a plain string that must match an active `Category` document — enforced via a call into the Categories module) and to a `vendorId` (a reference to a `Vendor` document owned by the Vendors module). The module does not manage vendor location or vendor identity itself; it borrows the `Vendor` model directly for the nearby-search aggregation.

## Data Model
`Product` schema (`src/modules/products/schema/product.schema.ts`), `{ timestamps: true }`:

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `vendorId` | ObjectId (ref `Vendor`) | required | Owning vendor |
| `name` | string | required | |
| `description` | string | optional | |
| `category` | string | required | Free-text category name, e.g. "Food", "Books"; validated against active `Category` documents by `CategoriesService` |
| `images` | string[] | default `[]` | Image URLs (e.g. Cloudinary `secure_url`s) |
| `price` | number | required | |
| `discountPrice` | number | optional | |
| `stock` | number | default `0` | |
| `isAvailable` | boolean | default `true` | |
| `preparationTime` | number | optional | In minutes |
| `tags` | string[] | default `[]` | |
| `specifications` | `{ weight?, dimensions?, other? }` | default `{}` | `other` is a free-form object |
| `rating` | `{ average: number, count: number }` | default `{ average: 0, count: 0 }` | Not mutated anywhere in this module (no rating-write endpoint here) |
| `isFlashSale` | boolean | default `false` | |
| `flashSaleId` | ObjectId (ref `FlashSale`) | default `null` | |
| `views` | number | default `0` | Not incremented anywhere in this module |
| `soldCount` | number | default `0` | Not incremented anywhere in this module |
| `createdAt` / `updatedAt` | Date | auto (timestamps) | |

**Indexes:**
- `{ name: "text", category: 1 }` — a compound text index on `name` (with a plain ascending index on `category`). Note: this is **not** the index the Search module's `$text` query relies on for products' descriptions/tags — it only text-indexes `name`.
- `{ vendorId: 1 }` — speeds up per-vendor product lookups (e.g. filtering by `vendorId`, and the `$lookup` join used by `getNearbyProducts`).

## Authentication
Guarded routes use `AccessTokenGuard` (Passport `jwt` strategy validating a bearer access token, populating `req.user` with `{ sub, email, role }`) stacked with `RolesGuard` + `@Roles("vendor")`, which throws `ForbiddenException` if `req.user.role` isn't in the allowed list.

| Route | Auth |
|---|---|
| `POST /api/products/create` | Vendor only |
| `PATCH /api/products/:id/update` | Vendor only (must own the product) |
| `GET /api/products/nearby` | Public |
| `GET /api/products/:id` | Public |
| `GET /api/products` | Public |
| `PATCH /api/products/:id/stock` | Vendor only (must own the product) |
| `POST /api/products/update-price` | Vendor only (must own the product) |
| `PATCH /api/products/:id/availability` | Vendor only (must own the product) |
| `POST /api/products/:id/images` | Vendor only (must own the product) |
| `DELETE /api/products/:id` | Vendor only (must own the product) |

Ownership is enforced in the service layer (not a guard): each mutating method loads the product and compares `product.vendorId.toString() === actorId` (where `actorId` is `req.user.sub`), throwing `ForbiddenException` on mismatch.

## Endpoints

### `POST /api/products/create`
- **Auth:** authenticated (`vendor`)
- **Request:** body = `CreateProductDto` — `name` (string, required), `description` (string, optional), `category` (string, required), `images` (string[], optional), `price` (number ≥0, required), `discountPrice` (number ≥0, optional), `stock` (number ≥0, optional), `isAvailable` (boolean, optional), `preparationTime` (number ≥0, optional), `tags` (string[], optional), `specifications` (nested `{ weight?, dimensions?, other? }`, optional), `isFlashSale` (boolean, optional), `flashSaleId` (MongoId, optional). `vendorId` is taken from `req.user.sub`, not the body.
- **Response:** `{ success: true, message: "Product created successfully", product: SafeProduct }` (controller spreads the service's `{ product }` result into the response object)
- **Errors:** `BadRequestException` if `vendorId` missing/invalid or `category` isn't an active category; `InternalServerErrorException` if the save fails
- Business rule: calls `CategoriesService.assertActiveCategory(dto.category)` before creating — the category must exist and be `isActive: true`.

### `PATCH /api/products/:id/update`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** path `id` (Mongo ObjectId); body = `UpdateProductDto` (all `CreateProductDto` fields made optional via `PartialType`)
- **Response:** `{ success: true, message: "Product updated successfully", product: SafeProduct }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException` (no such product), `ForbiddenException` (not the owning vendor)
- Business rule: if `dto.category` is present, `CategoriesService.assertActiveCategory` is called again (category re-validated only when it's part of the update payload). Other whitelisted fields are copied onto the document directly (partial update, not a full replace).

### `GET /api/products/nearby`
- **Auth:** public
- **Request:** query = `NearbyQueryDto` — `latitude` (number, -90..90, required), `longitude` (number, -180..180, required), `radius` (number ≥0.1 km, optional, default 5km applied in the service), `category` (string, optional), `page` (number ≥1, optional, default 1), `limit` (number ≥1, optional, default 10)
- **Response:** `{ success: true, message: "Nearby products fetched successfully", items: NearbyProduct[], total, page, limit }` (controller spreads the service's paginated result)
- **Errors:** none module-specific beyond DTO validation (400 from the global `ValidationPipe`)
- Declared before `GET /:id` in the controller — see Business Rules for why.

### `GET /api/products/:id`
- **Auth:** public
- **Request:** path `id` (Mongo ObjectId)
- **Response:** `{ success: true, message: "Product fetched successfully", product: SafeProduct }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException` (not found)
- Business rule: result is cached in `cache-manager` under key `product:<id>` for 60 seconds.

### `GET /api/products`
- **Auth:** public
- **Request:** query = `FilterProductDto` — `search` (string, optional; case-insensitive regex match against `name`, `description`, `tags`), `category` (string, optional, exact match), `vendorId` (string, optional, must be a valid ObjectId to be applied), `isAvailable` (boolean, optional), `isFlashSale` (boolean, optional), `page` (number ≥1, default 1), `limit` (number ≥1, default 10). `isAvailable`/`isFlashSale` now go through a `@Transform` that maps the query-string values `"true"`/`"false"` to actual booleans before `@IsBoolean()` validates them — previously these came through as the literal strings `"true"`/`"false"`, which `@IsBoolean()` rejects outright, so these two filters never actually worked via a real HTTP query string.
- **Response:** `{ success: true, message: "Products fetched successfully", items: SafeProduct[], total, page, limit }`
- **Errors:** none module-specific beyond DTO validation
- Business rule: this is a regex-based filter, not the MongoDB `$text` search used by the Search module. Results (`items`+`total`) are cached per unique `{query, page, limit}` combination for 60 seconds; sorted by `createdAt` descending.

### `PATCH /api/products/:id/stock`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** path `id`; body = `UpdateStockDto` — `stock` (number ≥0, required)
- **Response:** `{ success: true, message: "Stock updated successfully", productId, stock }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException`, `ForbiddenException`

### `POST /api/products/update-price`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** body = `UpdatePriceDto` — `productId` (MongoId, required), `price` (number ≥0, required), `discountPrice` (number ≥0, optional). Note: unlike other single-product mutations, the product id is in the **body**, not the path.
- **Response:** `{ success: true, message: "Price updated successfully", productId, price, discountPrice }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException`, `ForbiddenException`

### `PATCH /api/products/:id/availability`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** path `id`; body = `UpdateAvailabilityDto` — `isAvailable` (boolean, required)
- **Response:** `{ success: true, message: "Availability updated successfully", product: SafeProduct }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException`, `ForbiddenException`

### `POST /api/products/:id/images`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** `multipart/form-data`, path `id`; file field name **`images`** (array, up to `MAX_IMAGES_PER_REQUEST` = 10 files, via `FilesInterceptor("images", MAX_IMAGES_PER_REQUEST, IMAGE_UPLOAD_OPTIONS)` — size/mime-type limited the same way as every other upload endpoint, see `docs/architecture.md`)
- **Response:** `{ success: true, message: "Images added successfully", images: string[] }` — the product's full updated `images` array (existing + newly appended URLs)
- **Errors:** `BadRequestException` if no files provided; `ForbiddenException`/`NotFoundException` from an ownership check that now runs **before** uploading anything to Cloudinary (`ProductsService.assertVendorOwnsProduct`) — previously ownership was only checked inside `addProductImages`, after the (potentially large, multi-file) upload had already completed, wasting the upload for a request that was always going to be rejected
- Business rule: the controller uploads each file to Cloudinary via `CloudinaryService.uploadImage` (in parallel with `Promise.all`) and passes the resulting `secure_url`s to `ProductsService.addProductImages`, which `push`es them onto the existing `images` array (does not replace it).

### `DELETE /api/products/:id`
- **Auth:** authenticated (`vendor`, owner only)
- **Request:** path `id`
- **Response:** `{ success: true, message: "Product deleted successfully" }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException`, `ForbiddenException`

## Business Rules & Notes
- **Route order matters:** `GET nearby` is declared *before* `GET :id` in `products.controller.ts`. If `:id` came first, Nest/Express would match `/products/nearby` as `:id === "nearby"` and never reach the nearby handler. This ordering is intentional and must be preserved if routes are ever reorganized.
- **`getNearbyProducts` uses `$geoNear` on the Vendor collection, not Product.** The `Product` schema has no location field at all — location lives on `Vendor.location` (a GeoJSON `Point`, 2dsphere-indexed as `"location.coordinates"`). The aggregation pipeline (`buildNearbyPipeline` in `products.service.ts`) therefore starts from `vendorModel.aggregate([...])`:
  1. `$geoNear` finds vendors within `radius` (km, converted to meters) of the given `latitude`/`longitude`, restricted to `isActive: true` vendors, adding a computed `distance` field.
  2. `$lookup` joins each matched vendor to its products (`from: "products", localField: "_id", foreignField: "vendorId"`).
  3. `$unwind` flattens the joined products array into one document per product.
  4. `$match` keeps only `isAvailable: true` products, optionally filtered further by `category`.
  5. `$project` reshapes into the `NearbyProduct` response with `vendorName` sourced from `profile.businessName`.
  6. Sorted by `distance` ascending, then paginated in application code (`$skip`/`$limit` appended to the pipeline for a separate count pipeline as well — two aggregations run in parallel, one for the page of items and one with `$count`).
  This is why the search must go through Vendor: Product itself carries no coordinates, only the vendor it belongs to does.
- **Cross-module dependency on Categories:** `ProductsService.createProduct` always calls `CategoriesService.assertActiveCategory(dto.category)`. `ProductsService.updateProduct` calls it only when `dto.category` is present in the update payload (partial updates that don't touch `category` skip re-validation).
- **Cloudinary usage:** only the "add images" flow (`POST /:id/images`) uploads directly to Cloudinary from this module; `createProduct`/`updateProduct` accept already-hosted image URLs as plain strings in the DTO.
- **Caching:** uses `@nestjs/cache-manager`. Single-product reads and list reads are cached for 60 seconds. Any mutation (update, stock/price/availability change, image add, delete) deletes the specific `product:<id>` cache key directly, and invalidates **all** list-cache keys at once via a version token (`rotateProductListVersion`): every list cache key now embeds a version (`products:<version>:<JSON.stringify({q, page, limit})>`), stored itself under `products:list-version` with a 24-hour TTL; rotating that token to a fresh UUID makes every previously-cached list key unreachable in one write, without needing to enumerate or delete them individually. This replaces a previous approach that tried to delete all `products:*` keys via the cache store's `.keys()` method — a method the actual Keyv-backed store in use here doesn't support, so that call silently no-op'd (logged at debug level) and **every product list was served stale indefinitely after any mutation**, not just "briefly stale."
- **Ownership checks are duplicated per method** (not centralized in a guard) — every mutating method in `ProductsService` independently loads the product and compares `vendorId` to `actorId`.
- **`FilterProductDto.search`** is a regex `$or` across `name`/`description`/`tags` — this is a different mechanism from the Search module's MongoDB `$text` index search.
