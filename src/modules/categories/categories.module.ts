import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";

import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy";
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy";

import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { Category, CategorySchema } from "./schema/category.schema";
import { ProductSchema } from "../products/schema/product.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: "Product", schema: ProductSchema },
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
  controllers: [CategoriesController],
  providers: [CategoriesService, AccessTokenStrategy, RefreshTokenStrategy],
  exports: [CategoriesService],
})
export class CategoriesModule {}
