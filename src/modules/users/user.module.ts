import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "./schema/user.schema";
import { Order, OrderSchema } from "../orders/schema/order.schema";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule,ConfigService } from "@nestjs/config";
import { MailModule } from "src/utils/mail.module";
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy";
import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy";
import { CloudinaryModule } from "../uploads/cloudinary.module";
import { GoogleStrategy } from "./oauth/google.strategy";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    ConfigModule,
    CloudinaryModule,
    MailModule,
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
  controllers: [UserController],
  providers: [UserService,AccessTokenStrategy,RefreshTokenStrategy,GoogleStrategy],
  exports: [UserService],
})
export class UserModule {}
