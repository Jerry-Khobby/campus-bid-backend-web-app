import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  // Basic fields
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string; // hashed

  @Prop({ default: 'student', enum: ['student', 'admin', 'vendor'] })
  role: string;

  // Profile info
  @Prop({
    type: {
      firstName: { type: String },
      lastName: { type: String },
      phoneNumber: { type: String },
      studentId: { type: String },
      university: { type: String },
      profileImage: { type: String }, // URL
    },
    default: {},
  })
  profile: {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    studentId?: string;
    university?: string;
    profileImage?: string;
  };

  // Addresses
  @Prop({
    type: [
      {
        label: { type: String },
        building: { type: String },
        room: { type: String },
        location: {
          type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
          },
          coordinates: {
            type: [Number], // [longitude, latitude]
            index: '2dsphere',
          },
        },
        instructions: { type: String },
        isDefault: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  addresses: {
    label: string;
    building?: string;
    room?: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    instructions?: string;
    isDefault?: boolean;
  }[];

  // Saved items (references to Product)
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }], default: [] })
  savedItems: Types.ObjectId[];

  // Payment methods
  @Prop({
    type: [
      {
        type: { type: String }, // 'card' | 'mobile_money'
        provider: { type: String },
        last4: { type: String },
        isDefault: { type: Boolean, default: false },
        metadata: { type: Object },
      },
    ],
    default: [],
  })
  paymentMethods: {
    type: string;
    provider: string;
    last4: string;
    isDefault: boolean;
    metadata?: Record<string, any>;
  }[];

  // Flags
  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

// ✅ Optional: Add geospatial index for addresses
UserSchema.index({ 'addresses.location': '2dsphere' });
