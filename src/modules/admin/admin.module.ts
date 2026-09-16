import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { User, UserSchema } from "../users/schema/user.schema";
import { Vendor, VendorSchema } from "../vendors/schema/vendor.schema";
import { Order, OrderSchema } from "../orders/schema/order.schema";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Vendor.name, schema: VendorSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
