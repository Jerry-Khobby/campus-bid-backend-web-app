import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';

export enum FlashSaleStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum FlashSaleReason {
  CLOSING_TIME = 'closing_time',
  EXPIRING_STOCK = 'expiring_stock',
}

@Schema({ timestamps: true })
export class FlashSale {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  originalPrice: number;

  @Prop({ required: true })
  startingBid: number;

  @Prop()
  currentBid?: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  currentBidder?: Types.ObjectId;

  @Prop({ default: 1 })
  minimumBidIncrement: number;

  @Prop({ default: 1 })
  quantity: number;

  @Prop({ required: true })
  startTime: Date;

  @Prop({ required: true })
  endTime: Date;

  @Prop({
    type: String,
    enum: Object.values(FlashSaleStatus),
    default: FlashSaleStatus.UPCOMING,
  })
  status: FlashSaleStatus;

  @Prop([
    {
      userId: { type: SchemaTypes.ObjectId, ref: 'User' },
      amount: Number,
      timestamp: Date,
    },
  ])
  bids: Array<{
    userId: Types.ObjectId;
    amount: number;
    timestamp: Date;
  }>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  winner?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FlashSaleReason),
  })
  reason?: FlashSaleReason;
}

export type FlashSaleDocument = FlashSale & Document;
export const FlashSaleSchema = SchemaFactory.createForClass(FlashSale);
