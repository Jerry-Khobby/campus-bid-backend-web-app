import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { Product, ProductSchema } from "../products/schema/product.schema";
import { Vendor, VendorSchema } from "../vendors/schema/vendor.schema";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Vendor.name, schema: VendorSchema },
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
