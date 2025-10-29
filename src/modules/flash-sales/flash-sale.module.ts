import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashSaleController } from './flash-sale.controller';
import { FlashSaleService } from './flash-sale.service';
import { FlashSale, FlashSaleSchema } from './schema/flash-sale.schema';
import { AccessTokenStrategy } from 'src/common/guards/strategies/access-token.strategy';
import { RefreshTokenStrategy } from 'src/common/guards/strategies/refresh-token.strategy';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlashSale.name, schema: FlashSaleSchema },
    ]),
    CacheModule.register(),
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
  controllers: [FlashSaleController],
  providers: [FlashSaleService, AccessTokenStrategy, RefreshTokenStrategy],
  exports: [FlashSaleService],
})
export class FlashSaleModule {}
