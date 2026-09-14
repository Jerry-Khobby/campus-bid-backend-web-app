# Reviews

## Overview

A `Review` is a persistent, standalone document created after an order reaches the `completed` status. It is created by the customer via `POST /api/reviews` and captures **one rating per product** in the order (via `productRatings`), plus a single overall `rating` for the vendor and an optional free-text `review` comment. Every time a review is submitted, it also feeds a **running average** into `Product.rating` and `Vendor.rating` (see Business Rules below). Reviews are queryable per vendor, are permanently retained, and are protected from duplication by a unique index on `(orderId, productId)`.

This is distinct from the lightweight `Order.rating` field defined on the `Order` schema (`src/modules/orders/schema/order.schema.ts`, prop `rating?: { score, review, createdAt }`). That field is a single embedded sub-document set directly on the order itself — either when the customer confirms delivery (`OrdersService.confirmDelivery`, if `dto.rating` is supplied) or via the dedicated `OrdersService.rateOrder` flow. It records one score/comment for the *order as a whole*, is not stored in its own collection, is not deduplicated, and does **not** update `Product.rating` or `Vendor.rating`. The Reviews module, by contrast, is the system of record for public, per-product/per-vendor reviews and is what drives the aggregate rating shown on products and vendors.

## Data Model

### Review (`src/modules/reviews/schema/review.schema.ts`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `orderId` | ObjectId (ref `Order`) | Yes | Order the review is tied to |
| `productId` | ObjectId (ref `Product`) | Yes | Product being rated |
| `vendorId` | ObjectId (ref `Vendor`) | Yes | Vendor being rated |
| `customerId` | ObjectId (ref `User`) | Yes | Reviewer (from JWT, not request body) |
| `rating` | Number | Yes | `min: 1`, `max: 5` |
| `review` | String | No | Optional free-text comment |
| `createdAt` / `updatedAt` | Date | auto | `timestamps: true` |

**Unique index:** `ReviewSchema.index({ orderId: 1, productId: 1 }, { unique: true })` — prevents the same product on the same order from being reviewed more than once. A duplicate insert triggers Mongo error code `11000`, which the service maps to a `409 Conflict`.

## Authentication

- `POST /reviews`: `AccessTokenGuard` (JWT) + `RolesGuard` with `@Roles("student")` — only authenticated students (customers) may submit reviews. The reviewer's identity is taken from `req.user.sub`, not from the request body.
- `GET /reviews/vendor/:vendorId`: no guard — publicly accessible.

## Endpoints

Global prefix is `/api` (set in `src/main.ts` via `app.setGlobalPrefix('api')`), and the controller prefix is `reviews`.

### `POST /api/reviews`

Creates one `Review` document per entry in `productRatings`, and updates the vendor's running rating once.

**Request body** (`CreateReviewDto`):

| Field | Type | Validation |
|---|---|---|
| `orderId` | string | `@IsMongoId()` |
| `vendorId` | string | `@IsMongoId()` |
| `rating` | number | `@IsNumber()`, `min 1`, `max 5` — overall vendor rating |
| `review` | string | optional |
| `productRatings` | array of `{ productId: string (MongoId), rating: number (1–5) }` | `@IsArray()`, `@ValidateNested({ each: true })` — one entry per product being reviewed |

**Response** (`201`):
```json
{
  "success": true,
  "message": "Review submitted successfully",
  "data": {
    "orderId": "string",
    "reviewsCreated": 1
  }
}
```
(`reviewsCreated` is simply `productRatings.length`; the endpoint does not return the created review documents themselves.)

**Errors / logic flow** (`ReviewsService.createReview`):
1. `assertReviewableOrder(orderId, customerId)`:
   - Order not found → `404 NotFoundException` ("Order not found")
   - `order.customerId !== customerId` (ownership check) → `403 ForbiddenException` ("Not allowed to review this order")
   - `order.status !== "completed"` → `400 BadRequestException` ("Order must be completed before it can be reviewed")
2. For each `productRatings` entry, a `Review` is created. If the `(orderId, productId)` pair already has a review, the resulting Mongo duplicate-key error (`code === 11000`) is caught and rethrown as `409 ConflictException` ("This product was already reviewed for this order"). Any other creation error is logged and rethrown as-is.
3. After each product review is created, `Product.rating` is updated (`applyProductRating`).
4. After the loop, `Vendor.rating` is updated once using the top-level `dto.rating` (`applyVendorRating`).

Note: if `Product.findById` or `Vendor.findById` returns null, the corresponding rating update is silently skipped (no error thrown).

### `GET /api/reviews/vendor/:vendorId`

Lists paginated reviews for a vendor, with each review's `customerId` populated to `profile.firstName profile.lastName`.

**Query params** (`ReviewQueryDto`):

| Field | Type | Default | Notes |
|---|---|---|---|
| `rating` | number | — | optional exact-match filter, 1–5 |
| `page` | number | `1` | `min 1` |
| `limit` | number | `10` | `min 1` |

**Response** (`200`):
```json
{
  "success": true,
  "message": "Reviews fetched successfully",
  "data": {
    "items": [ /* Review documents, customerId populated with profile.firstName/profile.lastName */ ],
    "total": 0,
    "page": 1,
    "limit": 10
  }
}
```

No errors are explicitly thrown by this endpoint; an unknown/nonexistent `vendorId` simply yields an empty `items` array.

## Business Rules & Notes

**Running average formula** (`ReviewsService.nextRating`), applied identically to both `Product.rating` and `Vendor.rating` (each shaped as `{ average: number, count: number }`):

```
newCount   = current.count + 1
newAverage = (current.average * current.count + rating) / newCount
average    = round(newAverage, 2 decimal places)  // via Number(x.toFixed(2))
```

- **Product rating**: for every entry in `productRatings`, `applyProductRating(productId, entry.rating)` loads the `Product`, recomputes its `rating.average`/`rating.count` with the formula above using that entry's `rating`, and saves it. This runs once per product in the submission.
- **Vendor rating**: after all product reviews are created, `applyVendorRating(vendorId, dto.rating)` runs the same formula once against the vendor's `rating.average`/`rating.count`, using the single top-level `dto.rating` (the "overall vendor rating" from the request, not any individual product rating).
- If the referenced `Product` or `Vendor` document isn't found, that particular rating update is skipped — the review record itself is still created.
- A review can only be created against an order in `completed` status, and only by that order's own customer.
- Duplicate reviews for the same `orderId` + `productId` combination are rejected at the database level (unique index) and surfaced to the client as `409 Conflict`.
