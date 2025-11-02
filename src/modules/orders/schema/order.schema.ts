import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type OrderDocument = Order & Document;

@Schema({ timestamps: true, versionKey: false })
export class Order {
  @Prop({ unique: true, required: true })
  orderNumber: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true, index: true })
  vendorId: Types.ObjectId;

  @Prop({
    type: [
      {
        productId: { type: Types.ObjectId, ref: 'Product', required: true },
        productName: { type: String, required: true, trim: true },
        productImage: { type: String },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
        isFlashSale: { type: Boolean, default: false },
        flashSaleId: { type: Types.ObjectId, ref: 'FlashSale' },
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

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop() estimatedDeliveryTime?: Date;
  @Prop() actualDeliveryTime?: Date;

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

// Auto-generate order number before saving
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
