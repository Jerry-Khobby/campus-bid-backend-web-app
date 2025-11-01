import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy";
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy";
import { ConfigModule,ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { CacheModule } from "@nestjs/cache-manager";
import { OrderSchema,Order } from "./schema/order.schema";
import { Product,ProductSchema } from "../products/schema/product.schema";
import { User,UserSchema } from "../users/schema/user.schema";
import { Vendor,VendorSchema } from "../vendors/schema/vendor.schema";

@Module({

    imports: [
      MongooseModule.forFeature([
        { name: Order.name, schema: OrderSchema },
        {name:Product.name,schema:ProductSchema},
        {name:User.name,schema:UserSchema},
        {name:Vendor.name,schema:VendorSchema},

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
    controllers: [OrdersController],
    providers: [OrdersService, AccessTokenStrategy, RefreshTokenStrategy],
    exports: [OrdersService],

})



export class OrdersModule{}