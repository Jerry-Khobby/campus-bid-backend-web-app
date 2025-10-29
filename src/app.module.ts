import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {MongooseModule} from "@nestjs/mongoose";
import { ConfigModule } from '@nestjs/config';
import { RedisOptions } from './config/redis-config';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UserModule } from './modules/users/user.module';
import { VendorModule } from './modules/vendors/vendors.module';
import { ProductsModule } from './modules/products/products.module';
import { FlashSaleModule } from './modules/flash-sales/flash-sale.module';
@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    CacheModule.registerAsync(RedisOptions),
    UserModule,
    VendorModule,
    ProductsModule,
    FlashSaleModule,

  ],
  controllers: [AppController],
  providers: [AppService,{
    provide: APP_INTERCEPTOR,
    useClass: CacheModule,
  }],
})
export class AppModule {}
