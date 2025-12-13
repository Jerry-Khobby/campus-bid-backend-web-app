import {Module} from "@nestjs/common"
import { VendorController } from "./vendors.controller"
import { VendorService } from "./vendors.service"

import { MongooseModule } from "@nestjs/mongoose"
import { Vendor,VendorSchema } from "./schema/vendor.schema"
import { MailModule } from "src/utils/mail.module"
import { RefreshTokenStrategy } from "src/common/guards/strategies/refresh-token.strategy"
import { AccessTokenStrategy } from "src/common/guards/strategies/access-token.strategy"
import { ConfigModule,ConfigService } from "@nestjs/config"
import { JwtModule } from "@nestjs/jwt"
import { CloudinaryModule } from "../uploads/cloudinary.module"
import { GoogleStrategy } from "../users/oauth/google.strategy"




@Module({
  imports:[
        MongooseModule.forFeature([{ name: Vendor.name, schema: VendorSchema }]),
        ConfigModule,
        MailModule,
        CloudinaryModule,
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
  controllers:[VendorController],
  providers:[VendorService,AccessTokenStrategy,RefreshTokenStrategy,GoogleStrategy],
  exports:[VendorService]
})



export class VendorModule{}