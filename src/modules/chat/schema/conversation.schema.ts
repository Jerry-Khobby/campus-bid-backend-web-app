import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;

@Schema({ timestamps: true, versionKey: false })
export class Conversation {
  // -----------------------------
  // PARTICIPANTS
  // -----------------------------
  @Prop({
    type: {
      customerId: { type: SchemaTypes.ObjectId, ref: 'User', required: true },
      vendorId: { type: SchemaTypes.ObjectId, ref: 'Vendor', required: true },
    },
    required: true,
  })
  participants: {
    customerId: Types.ObjectId;
    vendorId: Types.ObjectId;
  };

  // -----------------------------
  // LINK TO ORDER (optional)
  // -----------------------------
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Order', required: false })
  orderId?: Types.ObjectId;

  // -----------------------------
  // LAST MESSAGE INFO
  // -----------------------------
  @Prop({
    type: {
      text: { type: String },
      senderId: { type: SchemaTypes.ObjectId, ref: 'User' },
      timestamp: { type: Date },
    },
    default: null,
  })
  lastMessage?: {
    text: string;
    senderId: Types.ObjectId;
    timestamp: Date;
  };

  // -----------------------------
  // UNREAD COUNTS
  // -----------------------------
  @Prop({
    type: {
      customer: { type: Number, default: 0 },
      vendor: { type: Number, default: 0 },
    },
    default: { customer: 0, vendor: 0 },
  })
  unreadCount: {
    customer: number;
    vendor: number;
  };

  // -----------------------------
  // STATUS
  // -----------------------------
  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Helpful indexes
ConversationSchema.index({ 'participants.customerId': 1 });
ConversationSchema.index({ 'participants.vendorId': 1 });
ConversationSchema.index({ orderId: 1 });
ConversationSchema.index({ updatedAt: -1 });
