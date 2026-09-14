import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

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

// ✅ OAuth Subschema
@Schema({ _id: false })
class OAuth {
  @Prop()
  googleId?: string;
}

/* ----------------------------- Vendor ----------------------------- */

@Schema({ timestamps: true })
export class Vendor extends Document {
  // Email & password
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({
    required: function (this: VendorDocument) {
      return this.authProvider === "local";
    },
  })
  password?: string;

  // Auth provider
  @Prop({ default: "local", enum: ["local", "google"] })
  authProvider: "local" | "google";

  @Prop({ type: OAuth, default: {} })
  oauth?: OAuth;

  // Role
  @Prop({ default: "vendor" })
  role: string;

  // Profile info
  @Prop({ type: Profile, required: true })
  profile: Profile;

  // Location
  @Prop({ type: Location, default: { type: "Point", coordinates: [0, 0] } })
  location: Location;

  // Business hours
  @Prop({ type: [BusinessHour], default: [] })
  businessHours: BusinessHour[];

  // Categories
  @Prop({ type: [String], default: [] })
  categories: string[];

  // Rating & stats
  @Prop({ type: Rating, default: () => ({}) })
  rating: Rating;

  @Prop({ type: Stats, default: () => ({}) })
  stats: Stats;

  // Bank details
  @Prop({ type: BankDetails, default: () => ({}) })
  bankDetails: BankDetails;

  // Refresh token
  @Prop({ default: null })
  refreshToken?: string;

  // Flags
  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

/* ------------------------- Schema Factory ------------------------- */

export const VendorSchema = SchemaFactory.createForClass(Vendor);

// ✅ Proper GeoJSON Index
VendorSchema.index({ "location.coordinates": "2dsphere" });

// ✅ Text index for vendor search
VendorSchema.index({ "profile.businessName": "text", "profile.description": "text" });

// Type alias
export type VendorDocument = Vendor & Document & { _id: Types.ObjectId };
