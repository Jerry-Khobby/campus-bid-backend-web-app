import { BadRequestException } from "@nestjs/common";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_IMAGE_SIZE_MEGABYTES = 5;
export const MAX_IMAGES_PER_REQUEST = 10;

type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

function acceptOnlyImages(request: unknown, file: Express.Multer.File, callback: FileFilterCallback): void {
  if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
    callback(null, true);
    return;
  }

  callback(new BadRequestException(`Only ${ALLOWED_IMAGE_MIME_TYPES.join(", ")} images are allowed`), false);
}

// Multer buffers uploads in memory, so the size and count limits are what keep a
// single request from exhausting the process (multer surfaces them as 413s).
export const IMAGE_UPLOAD_OPTIONS: MulterOptions = {
  limits: {
    fileSize: MAX_IMAGE_SIZE_MEGABYTES * BYTES_PER_MEGABYTE,
    files: MAX_IMAGES_PER_REQUEST,
  },
  fileFilter: acceptOnlyImages,
};
