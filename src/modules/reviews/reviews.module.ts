import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy";
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy";

import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";
import { Review, ReviewSchema } from "./schema/review.schema";
import { Order, OrderSchema } from "../orders/schema/order.schema";
import { Product, ProductSchema } from "../products/schema/product.schema";
import { Vendor, VendorSchema } from "../vendors/schema/vendor.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        global: true,
        secret: configService.get<string>("JWT_SECRET"),
        signOptions: { expiresIn: "15m" },
      }),
    }),
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService, AccessTokenStrategy, RefreshTokenStrategy],
})
export class ReviewsModule {}
