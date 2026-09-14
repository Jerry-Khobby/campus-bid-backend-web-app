import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PredefinedMessageDocument = PredefinedMessage & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class PredefinedMessage {
  @Prop({ type: String, enum: ['customer', 'vendor', 'both'], required: true })
  role: 'customer' | 'vendor' | 'both';

  @Prop({ type: String, required: true })
  category: string;

  @Prop({ type: String, required: true })
  text: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export const PredefinedMessageSchema = SchemaFactory.createForClass(PredefinedMessage);

PredefinedMessageSchema.index({ role: 1, category: 1 });
