import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true, versionKey: false })
export class Payment {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Order', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, default: 'GHS' })
  currency: string;

  @Prop({ type: String, enum: ['card', 'mobile_money'], required: true })
  paymentMethod: string;

  @Prop({
    type: String,
    enum: ['pending', 'held', 'released', 'refunded', 'failed'],
    default: 'held',
    index: true,
  })
  status: string;

  @Prop({ type: String, unique: true })
  transactionId: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Payout', index: true })
  payoutId?: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  adminCommission: number;

  @Prop({ type: Number, default: 0 })
  vendorPayout: number;

  @Prop() gatewayReference?: string;

  @Prop({ type: Object }) gatewayResponse?: Record<string, any>;

  @Prop() holdStartTime?: Date;
  @Prop() releaseTime?: Date;
  @Prop() refundTime?: Date;

  @Prop({ type: Object }) metadata?: Record<string, any>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

// Indexes
PaymentSchema.index({ customerId: 1, createdAt: -1 });
PaymentSchema.index({ vendorId: 1, createdAt: -1 });
