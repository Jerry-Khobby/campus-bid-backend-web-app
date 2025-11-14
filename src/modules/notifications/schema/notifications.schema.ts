import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true, versionKey: false })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: ['customer', 'vendor'], required: true })
  userType: 'customer' | 'vendor';

  @Prop({
    type: String,
    enum: ['order_update', 'new_message', 'flash_sale', 'payment'],
    required: true,
  })
  type: 'order_update' | 'new_message' | 'flash_sale' | 'payment';

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: Object, default: {} })
  data?: Record<string, any>;

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop()
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userType: 1 });

