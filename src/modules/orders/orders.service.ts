import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RateOrderDto } from './dto/rate-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { AcceptOrderDto } from './dto/accept-order.dto';
import { RejectOrderDto } from './dto/reject-order.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { Order, OrderDocument } from './schema/order.schema';
import { OrderStatus } from './dto/order-status.enum';

// Import dependent schemas
import { User,UserDocument } from '../users/schema/user.schema';
import { Product,ProductDocument } from '../products/schema/product.schema';
import { Vendor,VendorDocument } from '../vendors/schema/vendor.schema';

// Import dependent services
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payment.service';

const MINUTES_TO_MILLISECONDS = 60_000;
const ORDER_CACHE_TTL_SECONDS = 300;

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
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // -------------------------
  // CREATE ORDER
  // -------------------------
  async createOrder(customerId: string, dto: CreateOrderDto): Promise<OrderDocument> {
    try {
      // ✅ 1. Verify customer exists
      const customer = await this.userModel.findById(customerId);
      if (!customer) throw new ForbiddenException('Invalid customer account');

      // ✅ 2. Validate vendor
      if (!dto.vendorId) throw new BadRequestException('Vendor ID is required');
      const vendor = await this.vendorModel.findById(dto.vendorId);
      if (!vendor || vendor.role !== 'vendor')
        throw new BadRequestException('Invalid vendor ID provided');

      // ✅ 3. Validate products
      const productIds = dto.items.map((i) => i.productId);
      const products = await this.productModel.find({ _id: { $in: productIds } });
      if (products.length !== dto.items.length)
        throw new BadRequestException('One or more products do not exist');

      // ✅ 4. Verify product ownership (vendor)
      for (const product of products) {
        if (product.vendorId.toString() !== vendor._id.toString()) {
          throw new ForbiddenException(
            `Product ${product.name} does not belong to the selected vendor`,
          );
        }
      }

      // ✅ 5. Generate order number
      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // ✅ 6. Create order
      const order = new this.orderModel({
        ...dto,
        orderNumber,
        customerId,
        status: OrderStatus.PENDING,
        statusHistory: [
          { status: OrderStatus.PENDING, timestamp: new Date(), note: 'Order created' },
        ],
      });

      const saved = await order.save();
      await this.cacheManager.set(`order:${saved._id}`, saved, 600);

      this.logger.log(`🛒 Order created by ${customer.email} for vendor ${vendor.email}`);
      return saved;
    } catch (error) {
      this.logger.error('❌ Error creating order', error);
      throw new InternalServerErrorException('Failed to create order');
    }
  }

  // -------------------------
  // GET ALL ORDERS (Role-based)
  // -------------------------
  async getOrders(userId: string, role: string, query: OrderQueryDto) {
    const cacheKey = `orders:${role}:${userId}:${JSON.stringify(query)}`;
    const cached = await this.cacheManager.get<OrderDocument[]>(cacheKey);
    if (cached) {
      this.logger.log('💾 Returning cached orders');
      return cached;
    }

    const filter: any = {};
    if (role === 'student') filter.customerId = userId;
    if (role === 'vendor') filter.vendorId = userId;
    if (query.status) filter.status = query.status;

    const orders = await this.orderModel
      .find(filter)
      .populate('customerId vendorId items.productId', '-password')
      .sort({ createdAt: -1 })
      .exec();

    await this.cacheManager.set(cacheKey, orders, 300);
    return orders;
  }

  // -------------------------
  // GET SINGLE ORDER
  // -------------------------
async getOrderById(orderId: string, userId: string, role: string): Promise<OrderDocument> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new BadRequestException('Invalid order ID');
  }

  const cacheKey = `order:${orderId}`;
  const cached = await this.cacheManager.get<OrderDocument>(cacheKey);
  if (cached) return cached;

  // ✅ Use lean() for faster check
  const orderLean = await this.orderModel.findById(orderId).lean().exec();
  if (!orderLean) throw new NotFoundException('Order not found');

  // ✅ Check authorization with ObjectIds
  this.assertOrderAccess(orderLean, userId, role);

  // ✅ Now fetch with populate
  const order = await this.orderModel
    .findById(orderId)
    .populate('customerId vendorId items.productId', '-password')
    .exec();

    if(!order){
      throw new NotFoundException("Order not found");
    }

  await this.cacheManager.set(cacheKey, order, 300);
  return order;
}

  // -------------------------
  // UPDATE ORDER (Vendor Only)
  // -------------------------
  async updateOrder(orderId: string, dto: UpdateOrderDto): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    Object.assign(order, dto);
    const updated = await order.save();
    await this.cacheManager.set(`order:${orderId}`, updated, 600);

    this.logger.log(`🔄 Order updated: ${orderId}`);
    return updated;
  }

  // -------------------------
  // UPDATE STATUS (Vendor/Admin)
  // -------------------------
  async updateOrderStatus(orderId: string, vendorId: string, status: OrderStatus): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);

    order.status = status;
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      note: `Status changed to ${status}`,
    });

    const updated = await order.save();
    await this.cacheManager.set(`order:${orderId}`, updated, 600);

    this.logger.log(`🚚 Order status updated: ${orderId} → ${status}`);
    return updated;
  }

  // -------------------------
  // CANCEL ORDER (Customer)
  // -------------------------
  async cancelOrder(orderId: string, customerId: string, dto: CancelOrderDto) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId.toString() !== customerId)
      throw new ForbiddenException('You can only cancel your own orders');
    if ([OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(order.status as OrderStatus))
      throw new ConflictException('Cannot cancel this order');

    order.status = OrderStatus.CANCELLED;
    order.cancellationReason = dto.cancellationReason;
    order.statusHistory.push({
      status: OrderStatus.CANCELLED,
      timestamp: new Date(),
      note: dto.cancellationReason,
    });

    if (order.paymentId) {
      await this.refundCancelledOrderPayment(order, dto.cancellationReason, customerId);
    }

    const updated = await order.save();
    await this.cacheManager.set(`order:${orderId}`, updated, 300);

    this.logger.log(`❌ Order cancelled: ${orderId}`);
    return updated;
  }

  private async refundCancelledOrderPayment(
    order: OrderDocument,
    reason: string,
    customerId: string,
  ): Promise<void> {
    try {
      await this.paymentsService.refundPayment(
        order.paymentId!.toString(),
        { reason: `Order cancelled by customer: ${reason}` },
        customerId,
      );
    } catch (error) {
      this.logger.warn(`Failed to refund payment for cancelled order ${order._id}`, error);
    }
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
    await this.cacheManager.set(`order:${orderId}`, updated, 300);

    this.logger.log(`⭐ Order rated: ${orderId}`);
    return updated;
  }

  // -------------------------
  // AUTO-COMPLETE DELIVERED ORDERS
  // -------------------------
  async autoCompleteDeliveredOrders(): Promise<number> {
    const delivered = await this.orderModel.find({
      status: OrderStatus.DELIVERED,
    });

    let count = 0;
    for (const order of delivered) {
      order.status = OrderStatus.COMPLETED;
      order.statusHistory.push({
        status: OrderStatus.COMPLETED,
        timestamp: new Date(),
        note: 'Auto-completed by system',
      });
      await order.save();
      await this.cacheManager.set(`order:${order._id}`, order, 300);
      count++;
    }

    if (count > 0) this.logger.log(`🕒 Auto-completed ${count} orders`);
    return count;
  }

  // -------------------------
  // ACCEPT ORDER (Vendor)
  // -------------------------
  async acceptOrder(
    orderId: string,
    vendorId: string,
    dto: AcceptOrderDto,
  ): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);
    this.assertOrderStatus(order, OrderStatus.PENDING);

    order.status = OrderStatus.ACCEPTED;
    order.estimatedDeliveryTime = new Date(
      Date.now() + dto.estimatedPreparationTime * MINUTES_TO_MILLISECONDS,
    );
    this.addStatusHistory(order, OrderStatus.ACCEPTED, 'Order accepted by vendor');

    const updated = await this.saveAndCache(order);
    await this.notifyCustomer(
      updated,
      'Order Accepted',
      'Your order has been accepted and is being prepared',
    );

    return updated;
  }

  // -------------------------
  // REJECT ORDER (Vendor)
  // -------------------------
  async rejectOrder(
    orderId: string,
    vendorId: string,
    dto: RejectOrderDto,
  ): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);
    this.assertOrderStatus(order, OrderStatus.PENDING);

    order.status = OrderStatus.CANCELLED;
    order.cancellationReason = dto.reason;
    this.addStatusHistory(order, OrderStatus.CANCELLED, dto.reason);

    if (order.paymentId) {
      await this.refundRejectedOrderPayment(order, dto.reason, vendorId);
    }

    const updated = await this.saveAndCache(order);
    await this.notifyCustomer(
      updated,
      'Order Rejected',
      `Your order was rejected: ${dto.reason}`,
    );

    return updated;
  }

  // -------------------------
  // MARK DELIVERED (Vendor)
  // -------------------------
  async markDelivered(orderId: string, vendorId: string): Promise<OrderDocument> {
    const order = await this.findOrderOrFail(orderId);
    this.assertVendorOwnsOrder(order, vendorId);
    this.assertOrderStatus(order, OrderStatus.OUT_FOR_DELIVERY);

    order.status = OrderStatus.DELIVERED;
    order.actualDeliveryTime = new Date();
    this.addStatusHistory(order, OrderStatus.DELIVERED, 'Order marked as delivered by vendor');

    const updated = await this.saveAndCache(order);
    await this.notifyCustomer(updated, 'Order Delivered', 'Your order has been delivered');

    return updated;
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
    this.assertOrderStatus(order, OrderStatus.DELIVERED);

    if (dto.rating) {
      order.rating = { score: dto.rating, review: dto.review, createdAt: new Date() };
    }
    order.status = OrderStatus.COMPLETED;
    this.addStatusHistory(order, OrderStatus.COMPLETED, 'Delivery confirmed by customer');

    if (order.paymentId) {
      await this.paymentsService.releasePayment(order.paymentId.toString(), customerId);
    }

    const updated = await this.saveAndCache(order);
    await this.notifyVendor(
      updated,
      'Delivery Confirmed',
      'Delivery confirmed, payment released',
    );

    return updated;
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

  private addStatusHistory(order: OrderDocument, status: OrderStatus, note: string): void {
    order.statusHistory.push({ status, timestamp: new Date(), note });
  }

  private async saveAndCache(order: OrderDocument): Promise<OrderDocument> {
    const updated = await order.save();
    await this.cacheManager.set(`order:${updated._id}`, updated, ORDER_CACHE_TTL_SECONDS);
    return updated;
  }

  private async refundRejectedOrderPayment(
    order: OrderDocument,
    reason: string,
    vendorId: string,
  ): Promise<void> {
    try {
      await this.paymentsService.refundPayment(
        order.paymentId!.toString(),
        { reason: `Order rejected by vendor: ${reason}` },
        vendorId,
      );
    } catch (error) {
      this.logger.warn(`Failed to refund payment for rejected order ${order._id}`, error);
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
