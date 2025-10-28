import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class FlashSale extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  originalPrice: number;

  @Prop({ type: Number, required: true })
  startingBid: number;

  @Prop({ type: Number })
  currentBid?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  currentBidder?: Types.ObjectId;

  @Prop({ type: Number, default: 1 })
  minimumBidIncrement: number;

  @Prop({ type: Number, default: 1 })
  quantity: number;

  @Prop({ type: Date, required: true })
  startTime: Date;

  @Prop({ type: Date, required: true })
  endTime: Date;

  @Prop({
    type: String,
    enum: ['upcoming', 'active', 'completed', 'cancelled'],
    default: 'upcoming',
  })
  status: 'upcoming' | 'active' | 'completed' | 'cancelled';

  @Prop([
    {
      userId: { type: Types.ObjectId, ref: 'User', required: true },
      amount: { type: Number, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ])
  bids: {
    userId: Types.ObjectId;
    amount: number;
    timestamp: Date;
  }[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  winner?: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['closing_time', 'expiring_stock'],
  })
  reason?: string;
}

export const FlashSaleSchema = SchemaFactory.createForClass(FlashSale);
