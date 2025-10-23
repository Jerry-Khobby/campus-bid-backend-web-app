import { Module } from "@nestjs/common";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "./schema/user.schema";
import { JwtModule } from "@nestjs/jwt";
@Module({
  imports:[MongooseModule.forFeature([{name:User.name,schema:UserSchema}]),
JwtModule.register({
  global:true,
  secret:process.env.JWT_SECRET || 'defaultSecret',
  signOptions:{expiresIn:'7d'}
})

],
  controllers:[UserController],
  providers:[UserService],
  exports:[UserService]
})

export class UserModule {}