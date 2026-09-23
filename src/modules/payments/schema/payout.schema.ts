import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';

export type PayoutDocument = Payout & Document;

@Schema({ timestamps: true })
export class Payout {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: [SchemaTypes.ObjectId], ref: 'Payment', required: true })
  paymentIds: Types.ObjectId[];

  @Prop({
    type: String,
    enum: ['requested', 'processing', 'completed', 'failed'],
    default: 'requested',
    index: true,
  })
  status: string;

  @Prop({ default: Date.now })
  requestedAt: Date;

  @Prop() completedAt?: Date;

  @Prop({ type: Object }) bankSnapshot?: Record<string, any>;

  @Prop() adminNote?: string;
  @Prop() failureReason?: string;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);

PayoutSchema.index({ vendorId: 1, createdAt: -1 });
