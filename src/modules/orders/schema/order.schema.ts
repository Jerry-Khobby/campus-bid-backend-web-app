import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { DISPUTE_RESOLUTIONS, type DisputeResolution } from '../order.constants';

export type OrderDocument = Order & Document;

export interface OrderDispute {
  reason: string;
  openedAt: Date;
  resolution?: DisputeResolution;
  resolutionNote?: string;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
}

@Schema({ timestamps: true, versionKey: false })
export class Order {
  @Prop({ unique: true, required: true })
  orderNumber: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId: Types.ObjectId;

  @Prop({
    type: [
      {
        productId: { type: SchemaTypes.ObjectId, ref: 'Product', required: true },
        productName: { type: String, required: true, trim: true },
        productImage: { type: String },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
        isFlashSale: { type: Boolean, default: false },
        flashSaleId: { type: SchemaTypes.ObjectId, ref: 'FlashSale' },
      },
    ],
    required: true,
    _id: false,
  })
  items: {
    productId: Types.ObjectId;
    productName: string;
    productImage?: string;
    quantity: number;
    price: number;
    isFlashSale: boolean;
    flashSaleId?: Types.ObjectId;
  }[];

  @Prop({
    type: {
      subtotal: { type: Number, required: true, min: 0 },
      deliveryFee: { type: Number, required: true, min: 0 },
      serviceFee: { type: Number, required: true, min: 0 },
      total: { type: Number, required: true, min: 0 },
    },
    required: true,
    _id: false,
  })
  pricing: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    total: number;
  };

  @Prop({
    type: {
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
          type: [Number],
          default: [0, 0],
        },
      },
      instructions: { type: String },
    },
    required: true,
    _id: false,
  })
  deliveryAddress: {
    label?: string;
    building?: string;
    room?: string;
    location: { type: 'Point'; coordinates: [number, number] };
    instructions?: string;
    
  };

  @Prop({
    type: String,
    enum: [
      'pending',
      'accepted',
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered',
      'disputed',
      'completed',
      'cancelled',
      'refunded',
    ],
    default: 'pending',
    index: true,
  })
  status: string;

  @Prop({
    type: [
      {
        status: { type: String },
        timestamp: { type: Date, default: Date.now },
        note: { type: String },
      },
    ],
    _id: false,
  })
  statusHistory: { status: string; timestamp: Date; note?: string }[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  // Shown only to the customer, never exposed to the vendor - the vendor
  // must ask the customer for it in person before markDelivered will
  // accept it, so a delivery can't be claimed without the customer actually
  // having the order in hand.
  //
  // Not required: orders placed before this field existed have none, and
  // marking `required` would fail validation on every save() of an older
  // order (cancel, confirm-delivery, accept, ...), not just markDelivered.
  // A missing code simply means that order can never match a submitted one,
  // which is the safe failure mode - see the backfill script for making
  // markDelivered work again on pre-existing orders.
  @Prop({ type: String })
  deliveryCode?: string;

  // Every markDelivered attempt counts, so guessing stops at
  // MAX_DELIVERY_CODE_ATTEMPTS even if the requests arrive in parallel.
  @Prop({ type: Number, default: 0 })
  deliveryCodeAttempts?: number;

  // True when createOrder took the units out of product stock, so a cancel
  // knows it has units to give back. Older orders never reserved any.
  @Prop({ type: Boolean, default: false })
  stockReserved?: boolean;

  @Prop() estimatedDeliveryTime?: Date;
  @Prop() actualDeliveryTime?: Date;

  // Opened by the customer on a delivered order. The payment stays held until
  // an admin resolves it, which is claimed atomically by setting `resolution`
  // so two admins cannot both move the money.
  @Prop({
    type: {
      reason: { type: String, required: true },
      openedAt: { type: Date, required: true },
      resolution: { type: String, enum: DISPUTE_RESOLUTIONS },
      resolutionNote: { type: String },
      resolvedBy: { type: SchemaTypes.ObjectId, ref: 'User' },
      resolvedAt: { type: Date },
    },
    _id: false,
  })
  dispute?: OrderDispute;

  @Prop() vendorNotes?: string;
  @Prop() customerNotes?: string;
  @Prop() cancellationReason?: string;

  @Prop({
    type: {
      score: { type: Number, min: 1, max: 5 },
      review: { type: String },
      createdAt: { type: Date, default: Date.now },
    },
    _id: false,
  })
  rating?: {
    score?: number;
    review?: string;
    createdAt?: Date;
  };
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Fallback only - createOrder() always sets orderNumber itself before the
// document is constructed, since a required field can't be filled in here:
// Mongoose runs validation before 'save' hooks, so a pre('save') hook is too
// late to satisfy `required: true`.
OrderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const unique = uuidv4().split('-')[0];
    this.orderNumber = `ORD-${date}-${unique}`;
  }
  next();
});

// Indexes
OrderSchema.index({ 'deliveryAddress.location': '2dsphere' });
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ vendorId: 1, createdAt: -1 });
OrderSchema.index({ status: 1 });
