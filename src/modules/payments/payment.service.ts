import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Payment, PaymentDocument } from './schema/payment.schema';
import { Order, OrderDocument } from '../orders/schema/order.schema';
import { PaystackService } from './paystack.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { PaymentMethod } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryDto } from './dto/payment-query.dto';
import { NotificationsService } from '../notifications/notifications.service';

const ADMIN_COMMISSION_RATE = 0.1;
const PESEWAS_PER_CEDI = 100;
const DEFAULT_PAYSTACK_CALLBACK_URL = 'http://localhost:3000/api/payments/callback';
const HANDLED_WEBHOOK_EVENTS = ['charge.success', 'charge.failed'];

export interface CardPaymentResult {
  paymentId: Types.ObjectId;
  paymentMethod: 'card';
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface MobileMoneyPaymentResult {
  paymentId: Types.ObjectId;
  paymentMethod: 'mobile_money';
  reference: string;
  status: string;
  displayText?: string;
}

export type InitializePaymentResult = CardPaymentResult | MobileMoneyPaymentResult;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly paystackService: PaystackService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // -----------------------------
  // INITIALIZE PAYMENT (student)
  // -----------------------------
  async initializePayment(
    customerId: string,
    dto: InitializePaymentDto,
    customerEmail: string,
  ): Promise<InitializePaymentResult> {
    const order = await this.findOrderForCustomer(dto.orderId, customerId);
    await this.assertOrderHasNoActivePayment(order._id as Types.ObjectId);

    const amountInSmallestUnit = this.toSmallestCurrencyUnit(order.pricing.total);
    const reference = this.generatePaymentReference(order._id as Types.ObjectId);

    // Created before calling Paystack so its _id can be embedded in the
    // callback URL below — the frontend needs paymentId to know which
    // payment to poll once Paystack redirects the browser back (card) or
    // once the mobile money charge resolves (no redirect for that one).
    const payment = await this.createPendingPayment(order, dto, reference);

    if (dto.paymentMethod === PaymentMethod.MOBILE_MONEY) {
      return this.initializeMobileMoneyPayment(payment, customerEmail, amountInSmallestUnit, reference, dto);
    }

    const callbackUrl = this.getPaystackCallbackUrl(payment._id as Types.ObjectId);
    const transaction = await this.paystackService.initializeTransaction(
      customerEmail,
      amountInSmallestUnit,
      reference,
      callbackUrl,
    );

    return {
      paymentId: payment._id as Types.ObjectId,
      paymentMethod: 'card',
      authorizationUrl: transaction.authorization_url,
      accessCode: transaction.access_code,
      reference,
    };
  }

  private async initializeMobileMoneyPayment(
    payment: PaymentDocument,
    email: string,
    amountInSmallestUnit: number,
    reference: string,
    dto: InitializePaymentDto,
  ): Promise<MobileMoneyPaymentResult> {
    const charge = await this.paystackService.chargeMobileMoney(
      email,
      amountInSmallestUnit,
      reference,
      dto.phone!,
      dto.momoProvider!,
    );

    if (charge.status === 'failed') {
      payment.status = 'failed';
      payment.gatewayResponse = charge;
      await payment.save();
    }

    return {
      paymentId: payment._id as Types.ObjectId,
      paymentMethod: 'mobile_money',
      reference,
      status: charge.status,
      displayText: charge.display_text,
    };
  }

  // -----------------------------
  // SUBMIT MOBILE MONEY OTP (student)
  // -----------------------------
  async submitMomoOtp(paymentId: string, otp: string, actorId: string): Promise<{ status: string }> {
    const payment = await this.findById(paymentId);

    if (payment.customerId.toString() !== actorId)
      throw new ForbiddenException('You cannot act on this payment');

    if (payment.paymentMethod !== 'mobile_money' || payment.status !== 'pending')
      throw new ConflictException('This payment is not awaiting an OTP');

    const result = await this.paystackService.submitOtp(payment.transactionId, otp);

    if (result.status === 'failed') {
      payment.status = 'failed';
      payment.gatewayResponse = result;
      await payment.save();
    }

    return { status: result.status };
  }

  private async findOrderForCustomer(orderId: string, customerId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    if (order.customerId.toString() !== customerId)
      throw new ForbiddenException('You cannot pay for this order');

    return order;
  }

  private async assertOrderHasNoActivePayment(orderId: Types.ObjectId): Promise<void> {
    const activePayment = await this.paymentModel.findOne({
      orderId,
      status: { $ne: 'failed' },
    });

    if (activePayment) throw new ConflictException('This order already has an active payment');
  }

  private toSmallestCurrencyUnit(amountInCedis: number): number {
    return Math.round(amountInCedis * PESEWAS_PER_CEDI);
  }

  private generatePaymentReference(orderId: Types.ObjectId): string {
    return `ord_${orderId}_${Date.now()}`;
  }

  private getPaystackCallbackUrl(paymentId: Types.ObjectId): string {
    const appUrl = this.configService.get<string>('APP_URL');
    const base = appUrl ? `${appUrl}/payments/callback` : DEFAULT_PAYSTACK_CALLBACK_URL;
    return `${base}?paymentId=${paymentId.toString()}`;
  }

  private async createPendingPayment(
    order: OrderDocument,
    dto: InitializePaymentDto,
    reference: string,
  ): Promise<PaymentDocument> {
    const payment = new this.paymentModel({
      orderId: order._id,
      customerId: order.customerId,
      vendorId: order.vendorId,
      amount: order.pricing.total,
      paymentMethod: dto.paymentMethod,
      status: 'pending',
      transactionId: reference,
      gatewayReference: reference,
      metadata:
        dto.paymentMethod === PaymentMethod.MOBILE_MONEY
          ? { momoProvider: dto.momoProvider, phone: dto.phone }
          : undefined,
    });

    const saved = await payment.save();

    // The order needs to point back at whichever payment is currently
    // active on it - cancelling, disputing, and releasing on delivery all
    // read this field, and a retried payment (after a failed attempt)
    // should replace it with the new one, not leave the stale reference.
    order.paymentId = saved._id as Types.ObjectId;
    await order.save();

    return saved;
  }

  // -----------------------------
  // PAYSTACK WEBHOOK
  // -----------------------------
  async handleWebhook(rawBody: Buffer, signature: string, event: any): Promise<{ received: boolean }> {
    if (!this.paystackService.verifyWebhookSignature(rawBody, signature))
      throw new UnauthorizedException('Invalid webhook signature');

    if (!HANDLED_WEBHOOK_EVENTS.includes(event?.event)) return { received: true };

    const payment = await this.paymentModel.findOne({ transactionId: event.data.reference });
    if (!payment) {
      this.logger.warn(`Webhook received for unknown reference ${event.data.reference}`);
      return { received: true };
    }

    if (payment.status !== 'pending') return { received: true };

    // Re-verify against Paystack's API for both events rather than trusting
    // the webhook body directly - same reasoning as the amount/status check
    // below: a webhook payload is a hint to check, not a source of truth.
    await this.reconcileWithPaystack(payment);

    return { received: true };
  }

  // Independently asks Paystack for a payment's real status and applies
  // whatever it finds. Used by the webhook above, and also called whenever a
  // 'pending' payment is fetched (see findById) so the system self-heals if
  // a webhook is ever missed, delayed, or never configured at all - Paystack
  // webhooks are a courtesy notification, not the only way to find out.
  private async reconcileWithPaystack(payment: PaymentDocument): Promise<void> {
    const verified = await this.paystackService.verifyTransaction(payment.transactionId);

    if (this.isVerifiedChargeValid(verified, payment.amount)) {
      payment.status = 'held';
      payment.holdStartTime = new Date();
      payment.gatewayResponse = verified;
      await payment.save();
      return;
    }

    // Paystack itself still has this in flight (e.g. the customer hasn't
    // approved a mobile money prompt yet) - leave it pending for now.
    if (['pending', 'processing', 'ongoing', 'queued'].includes(verified.status)) {
      return;
    }

    if (verified.status === 'success') {
      this.logger.error(`Amount/status mismatch reconciling payment ${payment._id} - marking failed`);
      await this.notifyAdminsOfChargeMismatch(payment, verified);
    }

    await this.markPaymentFailed(payment, verified);
  }

  private async notifyAdminsOfChargeMismatch(
    payment: PaymentDocument,
    verified: { status: string; amount: number },
  ): Promise<void> {
    try {
      await this.notificationsService.notifyAllAdmins(
        'payment',
        'Payment verification mismatch',
        `Paystack verification for payment ${payment._id} did not match the expected amount/status and was marked failed.`,
        {
          paymentId: (payment._id as Types.ObjectId).toString(),
          verifiedStatus: verified.status,
          verifiedAmount: verified.amount,
        },
      );
    } catch (error) {
      this.logger.warn(`Failed to notify admins of charge mismatch for payment ${payment._id}`, error);
    }
  }

  private isVerifiedChargeValid(
    verified: { status: string; amount: number },
    expectedAmount: number,
  ): boolean {
    const expectedAmountInSmallestUnit = this.toSmallestCurrencyUnit(expectedAmount);
    return verified.status === 'success' && Math.round(verified.amount) === expectedAmountInSmallestUnit;
  }

  private async markPaymentFailed(payment: PaymentDocument, eventData: Record<string, any>): Promise<void> {
    payment.status = 'failed';
    payment.gatewayResponse = eventData;
    await payment.save();
  }

  // -----------------------------
  // FIND PAYMENT BY ID
  // -----------------------------
  async findById(paymentId: string): Promise<PaymentDocument> {
    if (!Types.ObjectId.isValid(paymentId)) throw new BadRequestException('Invalid paymentId');
    const payment = await this.paymentModel.findById(paymentId);
    if (!payment) throw new NotFoundException('Payment not found');

    // Self-heal: a client polling this endpoint (e.g. the checkout callback
    // page) would otherwise be stuck on 'pending' forever if Paystack's
    // webhook never arrives. Reconciliation failures here shouldn't break
    // the read - the caller just sees the payment still pending and the next
    // poll (or the webhook, if it does arrive) can resolve it instead.
    if (payment.status === 'pending') {
      try {
        await this.reconcileWithPaystack(payment);
      } catch (error) {
        this.logger.warn(`Reconciliation failed for payment ${payment._id}: ${error.message}`);
      }
    }

    return payment;
  }

  // -----------------------------
  // LIST / FILTER PAYMENTS (admin)
  // -----------------------------
  async listPayments(query: PaymentQueryDto): Promise<PaymentDocument[]> {
    const filter = this.buildPaymentFilter(query);
    return this.paymentModel
      .find(filter)
      .populate('customerId', 'email profile.firstName profile.lastName')
      .populate('vendorId', 'email profile.businessName')
      .sort({ createdAt: -1 });
  }

  private buildPaymentFilter(query: PaymentQueryDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (query.status) filter.status = query.status;
    if (query.paymentMethod) filter.paymentMethod = query.paymentMethod;
    if (query.customerId && Types.ObjectId.isValid(query.customerId))
      filter.customerId = new Types.ObjectId(query.customerId);
    if (query.vendorId && Types.ObjectId.isValid(query.vendorId))
      filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.transactionId) filter.transactionId = query.transactionId;

    return filter;
  }

  // -----------------------------
  // PAYMENT HISTORY (any authenticated role)
  // -----------------------------
  async getPaymentHistory(userId: string, role: string): Promise<PaymentDocument[]> {
    const filter = this.buildHistoryFilter(userId, role);
    return this.paymentModel.find(filter).sort({ createdAt: -1 });
  }

  private buildHistoryFilter(userId: string, role: string): Record<string, unknown> {
    if (role === 'student') return { customerId: userId };
    if (role === 'vendor') return { vendorId: userId };
    return {};
  }

  // -----------------------------
  // UPDATE PAYMENT (admin use)
  // -----------------------------
  async updatePayment(paymentId: string, dto: UpdatePaymentDto): Promise<PaymentDocument> {
    const payment = await this.findById(paymentId);
    Object.assign(payment, dto);
    await payment.save();
    return payment;
  }

  // -----------------------------
  // RELEASE PAYMENT (customer confirms)
  // -----------------------------
  async releasePayment(paymentId: string, actorId: string): Promise<PaymentDocument> {
    const payment = await this.findById(paymentId);

    if (payment.customerId.toString() !== actorId)
      throw new ForbiddenException('You cannot release this payment');

    if (payment.status !== 'held')
      throw new ConflictException('Payment cannot be released in current state');

    const { adminCommission, vendorPayout } = this.splitPaymentAmount(payment.amount);

    payment.status = 'released';
    payment.releaseTime = new Date();
    payment.adminCommission = adminCommission;
    payment.vendorPayout = vendorPayout;
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

    return payment;
  }

  private splitPaymentAmount(amount: number): { adminCommission: number; vendorPayout: number } {
    const adminCommission = amount * ADMIN_COMMISSION_RATE;
    const vendorPayout = amount - adminCommission;
    return { adminCommission, vendorPayout };
  }

  private isPaymentParty(payment: PaymentDocument, actorId: string): boolean {
    return (
      payment.customerId.toString() === actorId || payment.vendorId.toString() === actorId
    );
  }

  // -----------------------------
  // REFUND PAYMENT
  // -----------------------------
  async refundPayment(
    paymentId: string,
    dto: RefundPaymentDto,
    actorId: string,
  ): Promise<PaymentDocument> {
    const payment = await this.findById(paymentId);

    if (!this.isPaymentParty(payment, actorId))
      throw new ForbiddenException('You cannot refund this payment');

    if (payment.status !== 'held')
      throw new ConflictException('Payment cannot be refunded in current state');

    // Actually reverse the charge with Paystack before touching our own
    // records - if this throws, the payment stays 'held' and the customer
    // is told the refund failed, rather than us claiming success on a
    // refund that never happened.
    const refund = await this.paystackService.refundTransaction(payment.transactionId);

    payment.status = 'refunded';
    payment.refundTime = new Date();
    payment.metadata = { ...(payment.metadata || {}), refundReason: dto.reason, refund };
    await payment.save();

    this.logger.warn(`Payment ${payment._id} refunded for reason: ${dto.reason}`);

    try {
      await this.notificationsService.notifyAllAdmins(
        'payment_disputed',
        'Payment disputed',
        `A payment was refunded following a customer dispute: ${dto.reason}`,
        { paymentId: (payment._id as Types.ObjectId).toString() },
      );
    } catch (error) {
      this.logger.warn(`Failed to notify admins of dispute for payment ${payment._id}`, error);
    }

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
