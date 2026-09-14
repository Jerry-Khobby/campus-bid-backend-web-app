import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenStrategy } from 'src/common/guards/strategies/access-token.strategy';
import { RefreshTokenStrategy } from 'src/common/guards/strategies/refresh-token.strategy';

import { CloudinaryProvider } from './cloudinary.provider';
import { CloudinaryService } from './cloudinary.service';
import { UploadsController } from './uploads.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        global: true,
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [UploadsController],
  providers: [CloudinaryProvider, CloudinaryService, AccessTokenStrategy, RefreshTokenStrategy],
  exports: [CloudinaryProvider, CloudinaryService],
})
export class CloudinaryModule {}