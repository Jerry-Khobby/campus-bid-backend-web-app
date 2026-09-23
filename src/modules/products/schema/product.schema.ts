import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, SchemaTypes, Types } from "mongoose";

@Schema({ timestamps: true })
export class Product extends Document {
  // ✅ Reference to Vendor
  @Prop({ type: SchemaTypes.ObjectId, ref: "Vendor", required: true })
  vendorId: Types.ObjectId;

  // ✅ Basic Info
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  category: string; // e.g., "Food", "Books", "Electronics"

  @Prop({ type: [String], default: [] })
  images: string[]; // Array of image URLs

  // ✅ Pricing & Stock
  @Prop({ required: true })
  price: number;

  @Prop()
  discountPrice?: number;

  @Prop({ default: 0 })
  stock: number;

  @Prop({ default: true })
  isAvailable: boolean;

  @Prop()
  preparationTime?: number; // in minutes

  // ✅ Tags and Metadata
  @Prop({ type: [String], default: [] })
  tags: string[];

  // ✅ Product Specifications
  @Prop({
    type: {
      weight: { type: String },
      dimensions: { type: String },
      other: { type: Object, default: {} },
    },
    default: {},
  })
  specifications: {
    weight?: string;
    dimensions?: string;
    other?: Record<string, any>;
  };

  // ✅ Rating Info
  @Prop({
    type: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    default: {},
  })
  rating: {
    average: number;
    count: number;
  };

  // ✅ Flash Sale Info
  @Prop({ default: false })
  isFlashSale: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: "FlashSale", default: null })
  flashSaleId?: Types.ObjectId | null;

  // ✅ Stats
  @Prop({ default: 0 })
  views: number;

  @Prop({ default: 0 })
  soldCount: number;
}

// ✅ Create schema factory
export const ProductSchema = SchemaFactory.createForClass(Product);

// ✅ Add indexes for performance
ProductSchema.index({ name: "text", category: 1 });
ProductSchema.index({ vendorId: 1 });

// ✅ Export type
export type ProductDocument = Product & Document;
