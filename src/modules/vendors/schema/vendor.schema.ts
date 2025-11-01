import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document,Types } from "mongoose";

/* --------------------------- Subschemas --------------------------- */

// ✅ Profile
@Schema({ _id: false })
class Profile {
  @Prop({ required: true })
  businessName: string;

  @Prop()
  ownerName?: string;

  @Prop({ required: true })
  phoneNumber: string;

  @Prop()
  description?: string;

  @Prop()
  logo?: string; // URL

  @Prop()
  banner?: string; // URL
}

// ✅ Location (GeoJSON)
@Schema({ _id: false })
class Location {
  @Prop()
  address?: string;

  @Prop()
  building?: string;

  @Prop({ type: String, enum: ["Point"], default: "Point" })
  type: string;

  @Prop({
    type: [Number], // [longitude, latitude]
    required: true,
    default: [0, 0],
  })
  coordinates: number[];
}

// ✅ Business Hours
@Schema({ _id: false })
class BusinessHour {
  @Prop({ required: true })
  day: string; // e.g., "Monday"

  @Prop()
  openTime?: string; // e.g., "08:00"

  @Prop()
  closeTime?: string; // e.g., "22:00"

  @Prop({ default: false })
  isClosed?: boolean;
}

// ✅ Rating
@Schema({ _id: false })
class Rating {
  @Prop({ type: Number, default: 0 })
  average: number;

  @Prop({ type: Number, default: 0 })
  count: number;
}

// ✅ Stats
@Schema({ _id: false })
class Stats {
  @Prop({ type: Number, default: 0 })
  totalOrders: number;

  @Prop({ type: Number, default: 0 })
  completedOrders: number;

  @Prop({ type: Number, default: 0 })
  totalRevenue: number;
}

// ✅ Bank Details
@Schema({ _id: false })
class BankDetails {
  @Prop()
  accountName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  bankName?: string;

  @Prop({ default: false })
  isVerified?: boolean;
}

/* ----------------------------- Vendor ----------------------------- */

@Schema({ timestamps: true })
export class Vendor extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ default: "vendor" })
  role: string;

  @Prop({ type: Profile, required: true })
  profile: Profile;

  @Prop({ type: Location, default: { type: "Point", coordinates: [0, 0] } })
  location: Location;

  @Prop({ type: [BusinessHour], default: [] })
  businessHours: BusinessHour[];

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ type: Rating, default: () => ({}) })
  rating: Rating;

  @Prop({ type: Stats, default: () => ({}) })
  stats: Stats;

  @Prop({ type: BankDetails, default: () => ({}) })
  bankDetails: BankDetails;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({default:null})
  refreshToken?:string;

  @Prop({ default: true })
  isActive: boolean;
}

/* ------------------------- Schema Factory ------------------------- */

export const VendorSchema = SchemaFactory.createForClass(Vendor);

// ✅ Proper GeoJSON Index (important!)
VendorSchema.index({ "location.coordinates": "2dsphere" });

// Type alias
export type VendorDocument = Vendor & Document & {_id:Types.ObjectId};
