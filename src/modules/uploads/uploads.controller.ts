import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { AccessTokenGuard } from "src/common/guards/jwt-access.guard";
import { IMAGE_UPLOAD_OPTIONS, MAX_IMAGES_PER_REQUEST } from "src/common/uploads/image-upload.options";
import { CloudinaryService } from "./cloudinary.service";

@ApiTags("Uploads")
@Controller("upload")
export class UploadsController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post("image")
  @UseInterceptors(FileInterceptor("image", IMAGE_UPLOAD_OPTIONS))
  @ApiOperation({ summary: "Upload a single image" })
  @ApiResponse({ status: 201, description: "Image uploaded successfully" })
  async uploadImage(@UploadedFile() image: Express.Multer.File) {
    if (!image) throw new BadRequestException("No image file provided");

    const result = await this.cloudinaryService.uploadImage(image);

    return {
      success: true,
      message: "Image uploaded successfully",
      data: { url: result.secure_url, filename: result.public_id, size: image.size },
    };
  }

  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @Post("images")
  @UseInterceptors(FilesInterceptor("images", MAX_IMAGES_PER_REQUEST, IMAGE_UPLOAD_OPTIONS))
  @ApiOperation({ summary: "Upload multiple images" })
  @ApiResponse({ status: 201, description: "Images uploaded successfully" })
  async uploadImages(@UploadedFiles() images: Express.Multer.File[]) {
    if (!images?.length) throw new BadRequestException("No image files provided");

    const uploads = await Promise.all(images.map((file) => this.cloudinaryService.uploadImage(file)));
    const data = uploads.map((result, index) => ({
      url: result.secure_url,
      filename: result.public_id,
      size: images[index].size,
    }));

    return { success: true, message: "Images uploaded successfully", data };
  }
}
