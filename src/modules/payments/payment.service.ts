import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentDocument } from './schema/payment.schema';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  // -----------------------------
  // CREATE PAYMENT
  // -----------------------------
  async createPayment(dto: CreatePaymentDto): Promise<PaymentDocument> {
    const { orderId, customerId, vendorId, amount } = dto;

    // Validate ObjectIds
    [orderId, customerId, vendorId].forEach((id) => {
      if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid ID');
    });

    // Check for duplicate transactionId if provided
    if (dto.transactionId) {
      const existing = await this.paymentModel.findOne({ transactionId: dto.transactionId });
      if (existing) throw new ConflictException('Transaction ID already exists');
    }

    const payment = new this.paymentModel({
      ...dto,
      orderId: new Types.ObjectId(orderId),
      customerId: new Types.ObjectId(customerId),
      vendorId: new Types.ObjectId(vendorId),
      status: 'held',
      holdStartTime: new Date(),
    });

    try {
      const saved = await payment.save();
      return saved;
    } catch (err) {
      this.logger.error('Error creating payment', err);
      throw new InternalServerErrorException('Failed to create payment');
    }
  }

  // -----------------------------
  // FIND PAYMENT BY ID
  // -----------------------------
  async findById(paymentId: string): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(paymentId)) throw new BadRequestException('Invalid paymentId');
    const payment = await this.paymentModel.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  // -----------------------------
  // LIST / FILTER PAYMENTS
  // -----------------------------
  async listPayments(query: PaymentQueryDto): Promise<PaymentDocument[]> {
    const filter: any = {};

    if (query.status) filter.status = query.status;
    if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
    if (query.customerId && Types.ObjectId.isValid(query.customerId))
      filter.customerId = new Types.ObjectId(query.customerId);
    if (query.vendorId && Types.ObjectId.isValid(query.vendorId))
      filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.transactionId) filter.transactionId = query.transactionId;

    return this.paymentModel.find(filter).sort({ createdAt: -1 });
  }

  // -----------------------------
  // UPDATE PAYMENT (admin use)
  // -----------------------------
  async updatePayment(paymentId: string, dto: UpdatePaymentDto): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(paymentId)) throw new BadRequestException('Invalid paymentId');

    const payment = await this.paymentModel.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');

    Object.assign(payment, dto);
    await payment.save();

    return payment;
  }

  // -----------------------------
  // RELEASE PAYMENT (customer confirms)
  // -----------------------------
// -----------------------------
// RELEASE PAYMENT (customer confirms)
// -----------------------------
async releasePayment(paymentId: string, actorId: string): Promise<PaymentDocument> {
  const payment = await this.findById(paymentId);

  if (payment.customerId.toString() !== actorId)
    throw new ForbiddenException('You cannot release this payment');

  if (payment.status !== 'held')
    throw new ConflictException('Payment cannot be released in current state');

  // Commission logic
  const ADMIN_PERCENTAGE = 0.1; // 10%
  const adminCommission = payment.amount * ADMIN_PERCENTAGE;
  const vendorPayout = payment.amount - adminCommission;

  payment.status = 'released';
  payment.releaseTime = new Date();
  payment.adminCommission = adminCommission;
  payment.vendorPayout = vendorPayout;

  // Optional: Add a record for tracking release
  payment.metadata = {
    ...(payment.metadata || {}),
    releasedBy: actorId,
    releasedAt: new Date(),
    adminCommission,
    vendorPayout,
  };

  await payment.save();

  this.logger.log(
    `Payment ${payment._id} released: Admin gets ${adminCommission}, Vendor gets ${vendorPayout}`,
  );

  // 🔜 (Future) — If you integrate Paystack/Stripe later:
  // await this.gatewayService.sendPayoutToVendor(payment.vendorId, vendorPayout);

  return payment;
}


  // -----------------------------
  // REFUND PAYMENT
  // -----------------------------
  async refundPayment(dto: RefundPaymentDto, actorId: string): Promise<PaymentDocument> {
    const payment = await this.findById(dto.paymentId);

    if (payment.customerId.toString() !== actorId)
      throw new ForbiddenException('You cannot refund this payment');

    if (payment.status !== 'held')
      throw new ConflictException('Payment cannot be refunded in current state');

    payment.status = 'refunded';
    payment.refundTime = new Date();
    payment.metadata = { ...(payment.metadata || {}), refundReason: dto.reason };
    await payment.save();

    this.logger.warn(`Payment ${payment._id} refunded for reason: ${dto.reason}`);
    return payment;
  }

  // -----------------------------
  // UPDATE STATUS (admin use)
  // -----------------------------
  async updatePaymentStatus(paymentId: string, dto: UpdatePaymentStatusDto): Promise<PaymentDocument> {
    const payment = await this.findById(paymentId);
    payment.status = dto.status;
    await payment.save();
    return payment;
  }
}
