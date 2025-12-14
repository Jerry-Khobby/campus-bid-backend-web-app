import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary.module';
import { CloudinaryTestController } from './cloudinary-test.controller';

@Module({
  imports: [CloudinaryModule],
  controllers: [CloudinaryTestController],
})
export class TestModule {}