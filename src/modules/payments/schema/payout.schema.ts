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

  // Stable across retries of the same payout - generated once on first
  // approval attempt and reused on every retry, so Paystack's own
  // duplicate-reference rejection backs up our status-guarded idempotency.
  @Prop({ unique: true, sparse: true }) transferReference?: string;

  @Prop() recipientCode?: string;
  @Prop() transferCode?: string;
  @Prop({ type: Object }) gatewayResponse?: Record<string, any>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);

PayoutSchema.index({ vendorId: 1, createdAt: -1 });

// At most one payout per vendor may await approval at a time, so two
// concurrent payout requests cannot both be created and approved.
PayoutSchema.index(
  { vendorId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'requested' } },
);
