import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  InternalServerErrorException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomInt, timingSafeEqual } from 'crypto';

import { CreateOrderDto } from './dto/create-order.dto';
import { OrderItemDto } from './dto/subdocuments/order-item.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RateOrderDto } from './dto/rate-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { AcceptOrderDto } from './dto/accept-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { Order, OrderDocument } from './schema/order.schema';
import { OrderStatus } from './dto/order-status.enum';
import { assertTransitionAllowed, VENDOR_PROGRESS_STATUSES } from './order-state-machine';
import {
  CENTS_PER_UNIT,
  DELIVERY_CODE_LENGTH,
  DELIVERY_FEE,
  HTTP_SERVER_ERROR,
  MAX_DELIVERY_CODE_ATTEMPTS,
  MINUTES_TO_MILLISECONDS,
  ORDER_NUMBER_SUFFIX_RANGE,
  SERVICE_FEE,
} from './order.constants';

// Import dependent schemas
import { User,UserDocument } from '../users/schema/user.schema';
import { Product,ProductDocument } from '../products/schema/product.schema';
import { Vendor,VendorDocument } from '../vendors/schema/vendor.schema';
import { Payment, PaymentDocument } from '../payments/schema/payment.schema';

// Import dependent services
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payment.service';

type OrderItemSnapshot = {
  productId: Types.ObjectId;
  productName: string;
  productImage?: string;
  quantity: number;
  price: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Vendor.name) private readonly vendorModel:Model<VendorDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // -------------------------
  // CREATE ORDER
  // -------------------------
  async createOrder(customerId: string, dto: CreateOrderDto): Promise<OrderDocument> {
    try {
      const customer = await this.findCustomerOrFail(customerId);
      const vendor = await this.findOrderableVendorOrFail(dto.vendorId);
      const products = await this.findOrderableProducts(dto.items, dto.vendorId);

      const items = this.buildOrderItems(dto.items, products);
      await this.reserveStock(items);
      const saved = await this.saveNewOrder(customerId, dto, items);

      this.logger.log(`🛒 Order created by ${customer.email} for vendor ${vendor.email}`);
      return saved;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('❌ Error creating order', error);
      throw new InternalServerErrorException('Failed to create order');
    }
  }

  private async findCustomerOrFail(customerId: string): Promise<UserDocument> {
    const customer = await this.userModel.findById(customerId);
    if (!customer) throw new ForbiddenException('Invalid customer account');
    return customer;
  }

  private async findOrderableVendorOrFail(vendorId: string): Promise<VendorDocument> {
    const vendor = await this.vendorModel.findById(vendorId);
    if (!vendor || vendor.role !== 'vendor') throw new NotFoundException('Vendor not found');
    if (!vendor.isActive) throw new BadRequestException('This vendor is not accepting orders');
    return vendor;
  }

  private async findOrderableProducts(
    requestedItems: OrderItemDto[],
    vendorId: string,
  ): Promise<ProductDocument[]> {
    const productIds = requestedItems.map((item) => item.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException('Each product can appear only once in an order');
    }

    const products = await this.productModel.find({ _id: { $in: productIds } });
    if (products.length !== productIds.length) {
      throw new NotFoundException('One or more products do not exist');
    }

    products.forEach((product) => this.assertProductOrderable(product, vendorId));
    return products;
  }

  private assertProductOrderable(product: ProductDocument, vendorId: string): void {
    if (product.vendorId.toString() !== vendorId) {
      throw new BadRequestException(`Product ${product.name} does not belong to the selected vendor`);
    }
    if (!product.isAvailable) {
      throw new BadRequestException(`${product.name} is not available`);
    }
  }

  private buildOrderItems(
    requestedItems: OrderItemDto[],
    products: ProductDocument[],
  ): OrderItemSnapshot[] {
    const productsById = new Map(products.map((product) => [String(product._id), product]));

    return requestedItems.map(({ productId, quantity }) => {
      const product = productsById.get(productId)!;
      return {
        productId: product._id as Types.ObjectId,
        productName: product.name,
        productImage: product.images?.[0],
        quantity,
        price: this.resolveUnitPrice(product),
      };
    });
  }

  private resolveUnitPrice(product: ProductDocument): number {
    const hasDiscount = product.discountPrice != null && product.discountPrice < product.price;
    return hasDiscount ? product.discountPrice! : product.price;
  }

  // Each decrement is conditional on enough stock remaining, so two buyers
  // racing for the last unit cannot both succeed. If a later item has run
  // out, the units already taken for this order are put back.
  private async reserveStock(items: OrderItemSnapshot[]): Promise<void> {
    const reserved: OrderItemSnapshot[] = [];
    for (const item of items) {
      const updated = await this.productModel.findOneAndUpdate(
        { _id: item.productId, isAvailable: true, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
      );
      if (!updated) {
        await this.restoreStock(reserved);
        throw new ConflictException(`Not enough stock left for ${item.productName}`);
      }
      reserved.push(item);
    }
  }

  private async restoreStock(items: { productId: Types.ObjectId; quantity: number }[]): Promise<void> {
    await Promise.all(
      items.map((item) =>
        this.productModel.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } }),
      ),
    );
  }

  private async saveNewOrder(
    customerId: string,
    dto: CreateOrderDto,
    items: OrderItemSnapshot[],
  ): Promise<OrderDocument> {
    const order = new this.orderModel({
      vendorId: dto.vendorId,
      deliveryAddress: dto.deliveryAddress,
      customerNotes: dto.customerNotes,
      items,
      pricing: this.calculatePricing(items),
      orderNumber: `ORD-${Date.now()}-${randomInt(ORDER_NUMBER_SUFFIX_RANGE)}`,
      deliveryCode: this.generateDeliveryCode(),
      stockReserved: true,
      customerId,
      status: OrderStatus.PENDING,
      statusHistory: [
        { status: OrderStatus.PENDING, timestamp: new Date(), note: 'Order created' },
      ],
    });

    try {
      return await order.save();
    } catch (error) {
      await this.restoreStock(items);
      throw error;
    }
  }

  private calculatePricing(items: { price: number; quantity: number }[]) {
    const subtotal = this.roundToCents(
      items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    );
    const total = this.roundToCents(subtotal + DELIVERY_FEE + SERVICE_FEE);
    return { subtotal, deliveryFee: DELIVERY_FEE, serviceFee: SERVICE_FEE, total };
  }

  private roundToCents(amount: number): number {
    return Math.round(amount * CENTS_PER_UNIT) / CENTS_PER_UNIT;
  }

  private generateDeliveryCode(): string {
    const exclusiveMax = 10 ** DELIVERY_CODE_LENGTH;
    return randomInt(exclusiveMax).toString().padStart(DELIVERY_CODE_LENGTH, '0');
  }

  // -------------------------
  // GET ALL ORDERS (Role-based)
  // -------------------------
  // Not cached: this list changes constantly (new orders, status updates from
  // either party) and every mutation happens through a different method, so
  // caching it correctly would mean remembering to invalidate it from every
  // one of them. A customer seeing their own order list a few minutes stale
  // is a worse bug than the DB load saved by caching it.
  async getOrders(userId: string, role: string, query: OrderQueryDto): Promise<any[]> {
    const filter: any = {};
    if (role === 'student') filter.customerId = userId;
    if (role === 'vendor') filter.vendorId = userId;
    if (query.status) filter.status = query.status;

    const orders = await this.orderModel
      .find(filter)
      .populate('customerId vendorId items.productId', '-password')
      .sort({ createdAt: -1 })
      .exec();

    return orders.map((order) => this.hideDeliveryCodeFromVendor(order, role));
  }

  // The delivery code is only meaningful as proof the CUSTOMER handed it to
  // the vendor in person - a vendor who could just read it off their own
  // order view could enter it themselves and mark anything "delivered".
  private hideDeliveryCodeFromVendor(order: OrderDocument, role: string): any {
    if (role !== 'vendor') return order;
    const obj = typeof (order as any).toObject === 'function' ? (order as any).toObject() : order;
    const { deliveryCode, ...rest } = obj;
    return rest;
  }

  // -------------------------
  // GET SINGLE ORDER
  // -------------------------
async getOrderById(orderId: string, userId: string, role: string): Promise<any> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new BadRequestException('Invalid order ID');
  }

  // ✅ Use lean() for faster check
  const orderLean = await this.orderModel.findById(orderId).lean().exec();
  if (!orderLean) throw new NotFoundException('Order not found');

  // ✅ Check authorization with ObjectIds - this has to happen before the
  // cache read below, not after: the cached copy is shared across every
  // caller of this order id regardless of who they are, so serving it
  // first would let anyone who can guess an order id read someone else's
  // order for as long as it stays cached.
  this.assertOrderAccess(orderLean, userId, role);

  // Not cached: this order gets mutated from many independent places (this
  // module's own status transitions, plus payment.service.ts linking a
  // payment to it), and a stale read here is exactly the kind of bug a
  // customer notices immediately - e.g. their own payment status or
  // delivery code looking wrong right after it changed.
  const order = await this.orderModel
    .findById(orderId)
    .populate('customerId vendorId items.productId', '-password')
    .exec();

    if(!order){
      throw new NotFoundException("Order not found");
    }

  return this.hideDeliveryCodeFromVendor(order, role);
}

  // -------------------------
  // UPDATE ORDER (Vendor Only)
  // -------------------------
  async updateOrder(orderId: string, vendorId: string, dto: UpdateOrderDto): Promise<any> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);

    if (dto.vendorNotes !== undefined) order.vendorNotes = dto.vendorNotes;
    if (dto.estimatedDeliveryTime !== undefined) {
      order.estimatedDeliveryTime = new Date(dto.estimatedDeliveryTime);
    }
    const updated = await order.save();

    this.logger.log(`🔄 Order updated: ${orderId}`);
    return this.hideDeliveryCodeFromVendor(updated, 'vendor');
  }

  // -------------------------
  // UPDATE STATUS (Vendor)
  // -------------------------
  async updateOrderStatus(orderId: string, vendorId: string, status: OrderStatus): Promise<any> {
    if (!VENDOR_PROGRESS_STATUSES.includes(status)) {
      throw new BadRequestException(`Use the dedicated route to move an order to '${status}'`);
    }
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);

    this.changeStatus(order, status, `Status changed to ${status}`);
    const updated = await order.save();

    this.logger.log(`🚚 Order status updated: ${orderId} → ${status}`);
    return this.hideDeliveryCodeFromVendor(updated, 'vendor');
  }

  // -------------------------
  // CANCEL ORDER (Customer)
  // -------------------------
  async cancelOrder(orderId: string, customerId: string, dto: CancelOrderDto) {
    const order = await this.findOrderOrFail(orderId);
    this.assertCustomerOwnsOrder(order, customerId);
    assertTransitionAllowed(order.status, OrderStatus.CANCELLED);

    await this.refundHeldPayment(
      order,
      `Order cancelled by customer: ${dto.cancellationReason}`,
      customerId,
    );

    order.cancellationReason = dto.cancellationReason;
    this.changeStatus(order, OrderStatus.CANCELLED, dto.cancellationReason);
    const updated = await order.save();
    await this.releaseReservedStock(updated);

    this.logger.log(`❌ Order cancelled: ${orderId}`);
    return updated;
  }

  // -------------------------
  // RATE ORDER (Customer)
  // -------------------------
  async rateOrder(orderId: string, customerId: string, dto: RateOrderDto) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId.toString() !== customerId)
      throw new ForbiddenException('You can only rate your own orders');
    if (order.status !== OrderStatus.COMPLETED)
      throw new BadRequestException('You can only rate completed orders');

    order.rating = {
      score: dto.score,
      review: dto.review,
      createdAt: new Date(),
    };

    const updated = await order.save();

    this.logger.log(`⭐ Order rated: ${orderId}`);
    return updated;
  }

  // -------------------------
  // AUTO-COMPLETE DELIVERED ORDERS
  // -------------------------
  // An order whose payment cannot be released stays 'delivered', so the
  // next run retries it, and the admins are told which orders are stuck.
  async autoCompleteDeliveredOrders(): Promise<number> {
    const delivered = await this.orderModel.find({ status: OrderStatus.DELIVERED });

    const stuckOrderIds: string[] = [];
    for (const order of delivered) {
      try {
        await this.autoCompleteOrder(order);
      } catch (error) {
        this.logger.error(`Auto-complete failed for order ${order._id}`, error);
        stuckOrderIds.push(String(order._id));
      }
    }

    if (stuckOrderIds.length > 0) await this.alertAdminsOfStuckOrders(stuckOrderIds);

    const completedCount = delivered.length - stuckOrderIds.length;
    if (completedCount > 0) this.logger.log(`🕒 Auto-completed ${completedCount} orders`);
    return completedCount;
  }

  // Mirrors confirmDelivery. releasePayment only accepts the paying customer
  // as the actor, so the system releases on the customer's behalf.
  private async autoCompleteOrder(order: OrderDocument): Promise<void> {
    if (order.paymentId) {
      await this.paymentsService.releasePayment(
        order.paymentId.toString(),
        order.customerId.toString(),
      );
    }

    this.changeStatus(order, OrderStatus.COMPLETED, 'Auto-completed by system');
    const updated = await order.save();
    await this.notifyVendor(updated, 'Order Completed', 'Order auto-completed, payment released');
  }

  // -------------------------
  // ACCEPT ORDER (Vendor)
  // -------------------------
  async acceptOrder(
    orderId: string,
    vendorId: string,
    dto: AcceptOrderDto,
  ): Promise<any> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);

    this.changeStatus(order, OrderStatus.ACCEPTED, 'Order accepted by vendor');
    order.estimatedDeliveryTime = new Date(
      Date.now() + dto.estimatedPreparationTime * MINUTES_TO_MILLISECONDS,
    );

    const updated = await order.save();
    await this.notifyCustomer(
      updated,
      'Order Accepted',
      'Your order has been accepted and is being prepared',
    );

    return this.hideDeliveryCodeFromVendor(updated, 'vendor');
  }

  // -------------------------
  // REJECT ORDER (Vendor)
  // -------------------------
  async rejectOrder(
    orderId: string,
    vendorId: string,
    dto: RejectOrderDto,
  ): Promise<any> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);
    this.assertOrderStatus(order, OrderStatus.PENDING);

    await this.refundHeldPayment(order, `Order rejected by vendor: ${dto.reason}`, vendorId);

    order.cancellationReason = dto.reason;
    this.changeStatus(order, OrderStatus.CANCELLED, dto.reason);
    const updated = await order.save();
    await this.releaseReservedStock(updated);
    await this.notifyCustomer(
      updated,
      'Order Rejected',
      `Your order was rejected: ${dto.reason}`,
    );

    return this.hideDeliveryCodeFromVendor(updated, 'vendor');
  }

  // -------------------------
  // MARK DELIVERED (Vendor)
  // -------------------------
  async markDelivered(orderId: string, vendorId: string, deliveryCode: string): Promise<any> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);
    assertTransitionAllowed(order.status, OrderStatus.DELIVERED);

    const attempted = await this.recordDeliveryCodeAttempt(orderId);
    if (!this.isDeliveryCodeMatch(attempted.deliveryCode, deliveryCode)) {
      await this.rejectDeliveryCode(attempted);
    }

    this.changeStatus(attempted, OrderStatus.DELIVERED, 'Order marked as delivered by vendor');
    attempted.actualDeliveryTime = new Date();

    const updated = await attempted.save();
    await this.notifyCustomer(updated, 'Order Delivered', 'Your order has been delivered');

    return this.hideDeliveryCodeFromVendor(updated, 'vendor');
  }

  // The attempt is counted before the code is compared, and only while the
  // order is under the limit, so parallel guesses cannot exceed the limit.
  // `$not: { $gte }` also matches orders created before the counter existed.
  private async recordDeliveryCodeAttempt(orderId: string): Promise<OrderDocument> {
    const order = await this.orderModel.findOneAndUpdate(
      { _id: orderId, deliveryCodeAttempts: { $not: { $gte: MAX_DELIVERY_CODE_ATTEMPTS } } },
      { $inc: { deliveryCodeAttempts: 1 } },
      { new: true },
    );
    if (!order) {
      throw new ForbiddenException(
        'Too many wrong delivery codes for this order. Contact support to complete the delivery.',
      );
    }
    return order;
  }

  private isDeliveryCodeMatch(expected: string | undefined, submitted: string): boolean {
    if (!expected || expected.length !== submitted.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(submitted));
  }

  private async rejectDeliveryCode(order: OrderDocument): Promise<never> {
    const attemptsLeft = MAX_DELIVERY_CODE_ATTEMPTS - (order.deliveryCodeAttempts ?? 0);
    if (attemptsLeft <= 0) {
      await this.alertAdminsOfLockedDeliveryCode(order);
      throw new ForbiddenException(
        'That code doesn\'t match, and this order is now locked. Contact support to complete the delivery.',
      );
    }
    const attemptsLabel = attemptsLeft === 1 ? 'attempt' : 'attempts';
    throw new ForbiddenException(
      `That code doesn't match - ask the customer to read it out again (${attemptsLeft} ${attemptsLabel} left)`,
    );
  }

  // -------------------------
  // CONFIRM DELIVERY (Customer)
  // -------------------------
  async confirmDelivery(
    orderId: string,
    customerId: string,
    dto: ConfirmDeliveryDto,
  ): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertCustomerOwnsOrder(order, customerId);
    // A disputed order may also become COMPLETED, but only an admin decides that.
    this.assertOrderStatus(order, OrderStatus.DELIVERED);

    if (dto.rating) {
      order.rating = { score: dto.rating, review: dto.review, createdAt: new Date() };
    }

    if (order.paymentId) {
      await this.paymentsService.releasePayment(order.paymentId.toString(), customerId);
    }

    this.changeStatus(order, OrderStatus.COMPLETED, 'Delivery confirmed by customer');
    const updated = await order.save();
    await this.notifyVendor(
      updated,
      'Delivery Confirmed',
      'Delivery confirmed, payment released',
    );

    return updated;
  }

  // -------------------------
  // DISPUTES (Customer opens, Admin resolves)
  // -------------------------
  // A customer with a problem on a delivered order disputes it instead of
  // confirming delivery. The payment stays held - auto-complete only picks up
  // 'delivered' orders - until an admin refunds it or releases it to the vendor.
  async openDispute(orderId: string, customerId: string, dto: OpenDisputeDto): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertCustomerOwnsOrder(order, customerId);
    assertTransitionAllowed(order.status, OrderStatus.DISPUTED);

    const disputed = await this.markDisputed(order, dto.reason);
    await this.alertAdmins(
      'order_update',
      'Order disputed',
      `The customer disputed order ${disputed.orderNumber}; its payment is on hold until it is reviewed.`,
      { orderId: String(disputed._id), reason: dto.reason },
    );
    await this.notifyVendor(
      disputed,
      'Order Disputed',
      'The customer reported a problem with this order. The payment is on hold while our team reviews it.',
    );
    return disputed;
  }

  async resolveDispute(orderId: string, adminId: string, dto: ResolveDisputeDto): Promise<OrderDocument> {
    const order = await this.claimDisputeResolution(orderId, adminId, dto);

    try {
      await this.settleDisputedPayment(order, dto);
    } catch (error) {
      await this.releaseDisputeClaim(orderId);
      throw error;
    }

    const outcome = dto.resolution === 'refund' ? OrderStatus.REFUNDED : OrderStatus.COMPLETED;
    this.changeStatus(order, outcome, `Dispute resolved (${dto.resolution}): ${dto.note}`);
    const resolved = await order.save();
    await this.notifyDisputeOutcome(resolved, dto);
    return resolved;
  }

  // Conditional on 'delivered', so a delivery confirmed at the same moment
  // wins cleanly instead of being overwritten.
  private async markDisputed(order: OrderDocument, reason: string): Promise<OrderDocument> {
    const now = new Date();
    const disputed = await this.orderModel.findOneAndUpdate(
      { _id: order._id, status: OrderStatus.DELIVERED },
      {
        $set: { status: OrderStatus.DISPUTED, dispute: { reason, openedAt: now } },
        $push: { statusHistory: { status: OrderStatus.DISPUTED, timestamp: now, note: `Dispute opened: ${reason}` } },
      },
      { new: true },
    );
    if (!disputed) throw new ConflictException('This order can no longer be disputed');
    return disputed;
  }

  // Setting `resolution` is the claim: only one admin's request can match the
  // unresolved dispute, so the payment is never refunded and released twice.
  private async claimDisputeResolution(
    orderId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(orderId)) throw new BadRequestException('Invalid order ID');

    const claimed = await this.orderModel.findOneAndUpdate(
      { _id: orderId, status: OrderStatus.DISPUTED, 'dispute.resolution': { $exists: false } },
      {
        $set: {
          'dispute.resolution': dto.resolution,
          'dispute.resolutionNote': dto.note,
          'dispute.resolvedBy': new Types.ObjectId(adminId),
          'dispute.resolvedAt': new Date(),
        },
      },
      { new: true },
    );
    if (claimed) return claimed;

    await this.findOrderOrFail(orderId);
    throw new ConflictException('This order has no open dispute');
  }

  private async releaseDisputeClaim(orderId: string): Promise<void> {
    await this.orderModel.updateOne(
      { _id: orderId },
      {
        $unset: {
          'dispute.resolution': '',
          'dispute.resolutionNote': '',
          'dispute.resolvedBy': '',
          'dispute.resolvedAt': '',
        },
      },
    );
  }

  // PaymentsService only accepts a party to the payment as the actor, so the
  // admin's decision is carried out on the customer's behalf; the order's
  // dispute record keeps which admin decided. A rejection from the payment
  // rules (e.g. the payment is no longer held) is passed through as-is.
  private async settleDisputedPayment(order: OrderDocument, dto: ResolveDisputeDto): Promise<void> {
    if (!order.paymentId) return;

    const paymentId = order.paymentId.toString();
    const customerId = order.customerId.toString();
    try {
      if (dto.resolution === 'refund') {
        await this.paymentsService.refundPayment(paymentId, { reason: dto.note }, customerId);
      } else {
        await this.paymentsService.releasePayment(paymentId, customerId);
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < HTTP_SERVER_ERROR) throw error;
      this.logger.error(`Settling the disputed payment failed for order ${order._id}`, error);
      throw new BadGatewayException(
        'We could not move the payment, so the dispute is still open. Please try again shortly.',
      );
    }
  }

  private async notifyDisputeOutcome(order: OrderDocument, dto: ResolveDisputeDto): Promise<void> {
    const refunded = dto.resolution === 'refund';
    await this.notifyCustomer(
      order,
      'Dispute Resolved',
      refunded
        ? `Your dispute was upheld and your payment is being refunded. ${dto.note}`
        : `Your dispute was reviewed and the payment was released to the vendor. ${dto.note}`,
    );
    await this.notifyVendor(
      order,
      'Dispute Resolved',
      refunded
        ? `The dispute was upheld and the customer was refunded. ${dto.note}`
        : `The dispute was reviewed and the payment was released to you. ${dto.note}`,
    );
  }

  // -------------------------
  // TRACK ORDER (Customer/Vendor)
  // -------------------------
  async trackOrder(orderId: string, userId: string, role: string) {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException('Invalid order ID');
    }

    const orderLean = await this.orderModel.findById(orderId).lean().exec();
    if (!orderLean) throw new NotFoundException('Order not found');
    this.assertOrderAccess(orderLean, userId, role);

    const order = await this.orderModel
      .findById(orderId)
      .populate('vendorId', 'profile.businessName profile.phoneNumber')
      .exec();
    if (!order) throw new NotFoundException('Order not found');

    return this.buildTrackingSummary(order);
  }

  // -------------------------
  // Shared helpers
  // -------------------------
  private async findOrderOrFail(orderId: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(orderId)) throw new BadRequestException('Invalid order ID');
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private assertOrderAccess(
    order: { customerId: Types.ObjectId; vendorId: Types.ObjectId },
    userId: string,
    role: string,
  ): void {
    if (role === 'student' && order.customerId.toString() !== userId) {
      throw new ForbiddenException('Unauthorized access');
    }
    if (role === 'vendor' && order.vendorId.toString() !== userId) {
      throw new ForbiddenException('Unauthorized access');
    }
  }

  private assertVendorOwnsOrder(order: OrderDocument, vendorId: string): void {
    if (order.vendorId.toString() !== vendorId) {
      throw new ForbiddenException('You do not own this order');
    }
  }

  private assertCustomerOwnsOrder(order: OrderDocument, customerId: string): void {
    if (order.customerId.toString() !== customerId) {
      throw new ForbiddenException('You do not own this order');
    }
  }

  private assertOrderStatus(order: OrderDocument, expected: OrderStatus): void {
    if (order.status !== expected) {
      throw new ConflictException(`Order must be in '${expected}' status`);
    }
  }

  private changeStatus(order: OrderDocument, status: OrderStatus, note: string): void {
    assertTransitionAllowed(order.status, status);
    order.status = status;
    order.statusHistory.push({ status, timestamp: new Date(), note });
  }

  // A held payment must be refunded before the order is cancelled: if the
  // refund fails, the order stays as it was, the caller gets an error, and the
  // admins are alerted. A payment that was never captured needs no refund.
  private async refundHeldPayment(
    order: OrderDocument,
    reason: string,
    actorId: string,
  ): Promise<void> {
    if (!order.paymentId || !(await this.isPaymentHeld(order.paymentId))) return;

    try {
      await this.paymentsService.refundPayment(order.paymentId.toString(), { reason }, actorId);
    } catch (error) {
      this.logger.error(`Refund failed for order ${order._id}`, error);
      await this.alertAdminsOfRefundFailure(order, error);
      throw new BadGatewayException(
        'We could not refund the payment, so the order was not cancelled. Our team has been notified.',
      );
    }
  }

  // Orders placed before stock was reserved at checkout never took any units,
  // so giving units back for them would inflate the stock.
  private async releaseReservedStock(order: OrderDocument): Promise<void> {
    if (!order.stockReserved) return;
    await this.restoreStock(order.items);
  }

  private async isPaymentHeld(paymentId: Types.ObjectId): Promise<boolean> {
    const payment = await this.paymentModel.findById(paymentId).select('status').lean();
    return payment?.status === 'held';
  }

  private async alertAdminsOfRefundFailure(order: OrderDocument, error: unknown): Promise<void> {
    await this.alertAdmins(
      'payment',
      'Order refund failed',
      `Refunding order ${order.orderNumber} failed, so it was not cancelled. It needs a manual refund.`,
      {
        orderId: String(order._id),
        paymentId: order.paymentId?.toString(),
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }

  private async alertAdminsOfStuckOrders(orderIds: string[]): Promise<void> {
    await this.alertAdmins(
      'payment',
      'Orders could not be auto-completed',
      `${orderIds.length} delivered order(s) could not be completed because their payment could not be released.`,
      { orderIds },
    );
  }

  private async alertAdminsOfLockedDeliveryCode(order: OrderDocument): Promise<void> {
    await this.alertAdmins(
      'order_update',
      'Delivery code locked',
      `Order ${order.orderNumber} is locked after ${MAX_DELIVERY_CODE_ATTEMPTS} wrong delivery codes.`,
      { orderId: String(order._id), vendorId: order.vendorId.toString() },
    );
  }

  // The caller has already decided what to tell the user, so a failed alert
  // must not replace that response. It is logged as an error for monitoring.
  private async alertAdmins(
    type: string,
    title: string,
    message: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.notificationsService.notifyAllAdmins(type, title, message, data);
    } catch (error) {
      this.logger.error(`Failed to alert admins: ${title}`, error);
    }
  }

  private async notifyCustomer(
    order: OrderDocument,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.notificationsService.notify(
        order.customerId.toString(),
        'customer',
        'order_status_changed',
        title,
        message,
        { orderId: (order._id as Types.ObjectId).toString(), status: order.status },
      );
    } catch (error) {
      this.logger.warn(`Failed to notify customer for order ${order._id}`, error);
    }
  }

  private async notifyVendor(
    order: OrderDocument,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.notificationsService.notify(
        order.vendorId.toString(),
        'vendor',
        'order_status_changed',
        title,
        message,
        { orderId: (order._id as Types.ObjectId).toString(), status: order.status },
      );
    } catch (error) {
      this.logger.warn(`Failed to notify vendor for order ${order._id}`, error);
    }
  }

  private buildTrackingSummary(order: OrderDocument) {
    const vendor = order.vendorId as unknown as {
      profile?: { businessName?: string; phoneNumber?: string };
    };

    return {
      orderId: order._id,
      currentStatus: order.status,
      statusHistory: order.statusHistory,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      vendor: {
        businessName: vendor?.profile?.businessName,
        phoneNumber: vendor?.profile?.phoneNumber,
      },
    };
  }
}
