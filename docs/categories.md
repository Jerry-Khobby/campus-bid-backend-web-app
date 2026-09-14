# Categories

## Overview
The Categories module owns the `Category` collection, which defines the fixed set of product categories vendors can assign products to (e.g. "Food", "Books", "Electronics"). It provides admin-only CRUD for managing categories and a public listing endpoint that returns active categories along with a live product count per category.

Categories are referenced by name (a plain string), not by ObjectId, from `Product.category`. `CategoriesService` is imported directly into the Products module and exposes `assertActiveCategory`, which the Products module calls to validate that a product's category exists and is active before allowing a create/update.

## Data Model
`Category` schema (`src/modules/categories/schema/category.schema.ts`), `{ timestamps: true }`:

| Field | Type | Required/Default | Notes |
|---|---|---|---|
| `name` | string | required, unique, trimmed | Category display name |
| `slug` | string | required, unique | Auto-generated from `name` via a `pre("save")` hook whenever `name` is modified (lowercased, spaces → hyphens, non `[a-z0-9-]` chars stripped); never set directly by client input |
| `icon` | string | optional | URL to an icon asset |
| `isActive` | boolean | default `true` | Soft-delete flag; `DELETE` sets this to `false` rather than removing the document |
| `sortOrder` | number | default `0` | Used to order the public listing |
| `createdAt` / `updatedAt` | Date | auto (timestamps) | |

**Indexes:** `name` and `slug` each have a MongoDB unique index (from `unique: true` in their `@Prop` options). No text or geospatial indexes are declared on this schema.

## Authentication
`GET /` (list active categories) is public. `POST`, `PATCH`, and `DELETE` are protected by `AccessTokenGuard` (JWT bearer, populates `req.user`) plus `RolesGuard` with `@Roles("admin")` — only users whose JWT payload has `role: "admin"` may call them; others get `ForbiddenException`.

| Route | Auth |
|---|---|
| `GET /api/categories` | Public |
| `POST /api/categories` | Admin only |
| `PATCH /api/categories/:id` | Admin only |
| `DELETE /api/categories/:id` | Admin only |

## Endpoints

### `GET /api/categories`
- **Auth:** public
- **Request:** no parameters read by the handler (note: a `CategoryQueryDto` with `page`/`limit` exists in `dto/category-query.dto.ts` but is **not** used by `CategoriesController.listActive()` — the endpoint takes no query object and returns the full unpaginated list of active categories)
- **Response:** `{ success: true, message: "Categories fetched successfully", data: ActiveCategorySummary[] }` where each item is `{ id, name, icon, productCount }`
- **Errors:** none module-specific
- Business rule: returns only `isActive: true` categories, sorted by `sortOrder` ascending; `productCount` is computed per category via a live `Product.countDocuments({ category: category.name })` call for each category (N+1 query pattern — one count query per category, run via `Promise.all`).

### `POST /api/categories`
- **Auth:** admin only
- **Request:** body = `CreateCategoryDto` — `name` (string, required), `icon` (string, optional), `isActive` (boolean, optional), `sortOrder` (number ≥0, optional)
- **Response:** `{ success: true, message: "Category created successfully", data: CategoryDocument }`
- **Errors:** `ConflictException` if a category with the same `name` already exists (case-insensitive exact match via regex); `InternalServerErrorException` if the save fails
- Business rule: `slug` is derived automatically from `name`; it is not accepted as client input.

### `PATCH /api/categories/:id`
- **Auth:** admin only
- **Request:** path `id` (Mongo ObjectId); body = `UpdateCategoryDto` (all `CreateCategoryDto` fields optional via `PartialType`)
- **Response:** `{ success: true, message: "Category updated successfully", data: CategoryDocument }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException` (not found), `InternalServerErrorException` (save failure)
- Business rule: uses `Object.assign(category, dto)` — any field present in the body overwrites the corresponding document field; if `name` changes, the `pre("save")` hook regenerates `slug`. No duplicate-name check is performed on update (unlike create), so renaming to a name matching another category would fail at the database layer (unique index) rather than with a friendly `ConflictException`.

### `DELETE /api/categories/:id`
- **Auth:** admin only
- **Request:** path `id`
- **Response:** `{ success: true, message: "Category deactivated successfully", data: null }`
- **Errors:** `BadRequestException` (invalid id), `NotFoundException`
- Business rule: this is a soft delete — it sets `isActive = false` and saves; the document is never removed from the database. The response wording ("deactivated") reflects this correctly.

## Business Rules & Notes
- **`assertActiveCategory(name)`** (used by the Products module): looks up `categoryModel.findOne({ name, isActive: true })` — an **exact, case-sensitive** match against `name` (not `slug`, and not the case-insensitive regex used in `create()`'s duplicate check). If no active category with that exact name exists, it throws `BadRequestException("Invalid or inactive category: " + name)`. This is called from `ProductsService.createProduct` unconditionally, and from `ProductsService.updateProduct` only when the update payload includes a `category` field.
- **`CategoriesModule` imports the `Product` model directly** (registers `{ name: "Product", schema: ProductSchema }` via `MongooseModule.forFeature`) solely to run `countDocuments` for the public listing's `productCount` — it does not import `ProductsModule` itself, avoiding a circular module dependency, but does duplicate the raw schema registration.
- **Unused DTO:** `CategoryQueryDto` (pagination) is defined but never wired into the controller; `GET /categories` currently has no pagination despite the DTO's presence.
- **No error notification service:** caught errors (`create`, `update`) are logged via `Logger.error` and rethrown as `InternalServerErrorException`; there is no external error-reporting integration in this module.
