import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

@Schema({ timestamps: true })
export class Vendor extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: "vendor" })
  role: string;

  // ✅ Profile
  @Prop({
    type: {
      businessName: { type: String, required: true },
      ownerName: { type: String },
      phoneNumber: { type: String, required: true },
      description: { type: String },
      logo: { type: String }, // URL
      banner: { type: String }, // URL
    },
  })
  profile: {
    businessName: string;
    ownerName?: string;
    phoneNumber: string;
    description?: string;
    logo?: string;
    banner?: string;
  };

  // ✅ Location (GeoJSON)
  @Prop({
    type: {
      address: { type: String },
      building: { type: String },
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: {
        type: [Number], // [longitude, latitude]
        index: "2dsphere",
      },
    },
  })
  location: {
    address?: string;
    building?: string;
    type: "Point";
    coordinates: [number, number];
  };

  // ✅ Business Hours
  @Prop([{
    day: { type: String, required: true },
    openTime: { type: String },
    closeTime: { type: String },
    isClosed: { type: Boolean, default: false },
  }])
  businessHours: {
    day: string;
    openTime?: string;
    closeTime?: string;
    isClosed?: boolean;
  }[];

  // ✅ Categories
  @Prop({ type: [String], default: [] })
  categories: string[];

  // ✅ Rating
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

  // ✅ Stats
  @Prop({
    type: {
      totalOrders: { type: Number, default: 0 },
      completedOrders: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
    },
    default: {},
  })
  stats: {
    totalOrders: number;
    completedOrders: number;
    totalRevenue: number;
  };

  // ✅ Bank Details
  @Prop({
    type: {
      accountName: { type: String },
      accountNumber: { type: String },
      bankName: { type: String },
      isVerified: { type: Boolean, default: false },
    },
    default: {},
  })
  bankDetails: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    isVerified?: boolean;
  };

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);

// ✅ Add geospatial index explicitly
VendorSchema.index({ location: "2dsphere" });

// ✅ Add this line (this fixes your error)
export type VendorDocument = Vendor & Document;
