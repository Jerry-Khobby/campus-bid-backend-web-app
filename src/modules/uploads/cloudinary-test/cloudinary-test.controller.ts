import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../cloudinary.service';

@Controller('cloudinary-test')
export class CloudinaryTestController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTest(@UploadedFile() file: Express.Multer.File) {
    // 1️⃣ confirm file reached backend
    console.log('File received:', {
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });

    // 2️⃣ upload to cloudinary
    const result = await this.cloudinaryService.uploadImage(file);

    // 3️⃣ return raw cloudinary response
    return {
      success: true,
      cloudinary: result,
    };
  }
}
