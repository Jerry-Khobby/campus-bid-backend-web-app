import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class Message {
  // Conversation this message belongs to
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversationId: Types.ObjectId;

  // Sender (can be vendor or customer)
  @Prop({ type: Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  // Identify sender type for UI
  @Prop({
    type: String,
    enum: ['customer', 'vendor'],
    required: true,
  })
  senderType: 'customer' | 'vendor';

  // Type of message sent
  @Prop({
    type: String,
    enum: ['text', 'predefined', 'image'],
    required: true,
  })
  messageType: 'text' | 'predefined' | 'image';

  // Actual message content (text, predefined text, or image URL)
  @Prop({ type: String, required: true })
  content: string;

  // Optional: If message is from predefined templates
  @Prop({ type: String })
  predefinedMessageId?: string;

  // Read status
  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date })
  readAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Indexes for faster chat loading
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ senderId: 1 });
