import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { Product, ProductSchema } from "./schema/product.schema";
import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy";
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy";
import { ConfigModule,ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";


@Module({
  imports: [
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
                useFactory: (configService: ConfigService) => ({
                  global: true,
                  secret: configService.get<string>('JWT_ACCESS_SECRET'),
                  signOptions: { expiresIn: '15m' },
                }),
    }),

  ],
  controllers: [ProductsController],
  providers: [ProductsService,AccessTokenStrategy,RefreshTokenStrategy],
  exports: [ProductsService],
})
export class ProductsModule {}
