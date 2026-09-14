# Uploads

## Overview
The Uploads module provides generic image-upload endpoints backed by Cloudinary. It owns no Mongoose schema/collection — its job is purely to accept multipart file uploads, stream them to Cloudinary, and return the resulting hosted URLs. `CloudinaryService` (and the underlying `CloudinaryProvider`, which configures the `cloudinary` SDK from `CLD_CLOUD_NAME`/`CLD_API_KEY`/`CLD_API_SECRET` env vars) is exported from this module and reused directly by the Products module (`ProductsController` injects `CloudinaryService` to implement `POST /products/:id/images`).

## Data Model
No Mongoose schema is defined in this module. There is no persisted "upload record" — Cloudinary is the system of record for the uploaded files, and callers are responsible for persisting the returned URL wherever it belongs (e.g. onto a `Product.images` array).

## Authentication
Both routes require a valid access token: `AccessTokenGuard` (Passport `jwt` strategy) is applied at the method level. No role restriction (`RolesGuard`/`@Roles`) is applied — any authenticated user, regardless of role, may call either endpoint.

| Route | Auth |
|---|---|
| `POST /api/upload/image` | Authenticated (any role) |
| `POST /api/upload/images` | Authenticated (any role) |

## Endpoints

### `POST /api/upload/image`
- **Auth:** authenticated (any role)
- **Request:** `multipart/form-data`, single file field named **`image`** (via `FileInterceptor("image")`)
- **Response:** `{ success: true, message: "Image uploaded successfully", data: { url: string, filename: string, size: number } }` — `url` is Cloudinary's `secure_url`, `filename` is Cloudinary's `public_id`, `size` is the original `Express.Multer.File.size`
- **Errors:** `BadRequestException("No image file provided")` if the field is missing; any Cloudinary upload error rejects the underlying promise and propagates as an unhandled error (no explicit catch/wrap in `CloudinaryService.uploadImage` or the controller)

### `POST /api/upload/images`
- **Auth:** authenticated (any role)
- **Request:** `multipart/form-data`, file field named **`images`** (array, up to 10 files — `FilesInterceptor("images", 10)`, `MAX_IMAGES_PER_UPLOAD = 10`)
- **Response:** `{ success: true, message: "Images uploaded successfully", data: Array<{ url, filename, size }> }` — one entry per uploaded file, same shape as the single-image endpoint, order-matched to the input files
- **Errors:** `BadRequestException("No image file provided")` if no files are provided (note: message text says "No image file provided" for both endpoints, singular wording even on the plural route — verified directly in `uploads.controller.ts`)

## Business Rules & Notes
- **Cloudinary upload mechanism:** `CloudinaryService.uploadImage` wraps `cloudinary.uploader.upload_stream` in a `Promise`, piping the in-memory `file.buffer` into it via `buffer-to-stream`. Every file is uploaded into the fixed Cloudinary folder `"pictures"` (hardcoded, not configurable per call).
- **Multiple files are uploaded in parallel** via `Promise.all` in both `uploadImages` (this module) and `ProductsController.uploadImages` (Products module's private helper) — if any single upload rejects, `Promise.all` rejects the whole batch (no partial-success handling).
- **No file-type/size validation** is performed in this module before handing the buffer to Cloudinary — `FileInterceptor`/`FilesInterceptor` are used with no `limits` or `fileFilter` options, so any file type Multer accepts will be forwarded to Cloudinary.
- **Reused by Products module:** `POST /api/products/:id/images` (see `docs/products.md`) does not go through these `/api/upload/*` routes — it calls `CloudinaryService.uploadImage` directly from `ProductsController`, then persists the resulting URLs onto the product's `images` array. The generic `/api/upload/*` endpoints are a standalone utility for callers who need a hosted URL without an associated product mutation.
- **No error reporting/notification on Cloudinary failure** — a failed upload simply rejects the promise chain and bubbles up as an unhandled server error; it is not logged or reported to any monitoring service in this module.
