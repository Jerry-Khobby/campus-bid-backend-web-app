import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {MongooseModule} from "@nestjs/mongoose";
import { ConfigModule } from '@nestjs/config';
import { RedisOptions } from './config/redis-config';
import { CacheModule } from '@nestjs/cache-manager';
import { UserModule } from './modules/users/user.module';
import { VendorModule } from './modules/vendors/vendors.module';
import { ProductsModule } from './modules/products/products.module';
import { FlashSaleModule } from './modules/flash-sales/flash-sale.module';
import { ScheduleModule } from '@nestjs/schedule';
import { OrdersModule } from './modules/orders/orders.module';
import { ChatModule } from './modules/chat/chat.module';
import { PaymentsModule } from './modules/payments/payment.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SearchModule } from './modules/search/search.module';
import { CloudinaryModule } from './modules/uploads/cloudinary.module';
import { AdminModule } from './modules/admin/admin.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DEFAULT_THROTTLE, HttpThrottlerGuard } from './common/throttle/throttle.config';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(DEFAULT_THROTTLE),
    MongooseModule.forRoot(process.env.MONGODB_URI!),
    CacheModule.registerAsync(RedisOptions),
    UserModule,
    VendorModule,
    ProductsModule,
    FlashSaleModule,
    OrdersModule,
    ChatModule,
    PaymentsModule,
    NotificationsModule,
    CategoriesModule,
    ReviewsModule,
    SearchModule,
    CloudinaryModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
