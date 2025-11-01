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
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RateOrderDto } from './dto/rate-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { Order, OrderDocument } from './schema/order.schema';
import { OrderStatus } from './dto/order-status.enum';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // -------------------------
  // CREATE ORDER
  // -------------------------
  async createOrder(customerId: string, dto: CreateOrderDto): Promise<OrderDocument> {
    try {
      const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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

      this.logger.log(`🛒 New order created: ${orderNumber}`);
      return saved;
    } catch (error) {
      this.logger.error('❌ Error creating order', error);
      throw new InternalServerErrorException('Failed to create order');
    }
  }

  // -------------------------
  // GET ALL ORDERS (Role-based)
  // -------------------------
  async getOrders(customerId: string, role: string, query: OrderQueryDto) {
    const cacheKey = `orders:${role}:${customerId}:${JSON.stringify(query)}`;
    const cached = await this.cacheManager.get<OrderDocument[]>(cacheKey);
    if (cached) {
      this.logger.log('💾 Returning cached orders');
      return cached;
    }

    const filter: any = {};
    if (role === 'student') filter.customerId = customerId;
    if (role === 'vendor') filter.vendorId = customerId;
    if (query.status) filter.status = query.status;

    const orders = await this.orderModel
      .find(filter)
      .populate('userId vendorId items.productId paymentId', '-password')
      .sort({ createdAt: -1 })
      .exec();

    await this.cacheManager.set(cacheKey, orders, 300);
    return orders;
  }

  // -------------------------
  // GET SINGLE ORDER
  // -------------------------
  async getOrderById(orderId: string, customerId: string, role: string): Promise<OrderDocument> {
    const cacheKey = `order:${orderId}`;
    const cached = await this.cacheManager.get<OrderDocument>(cacheKey);
    if (cached) return cached;

    const order = await this.orderModel
      .findById(orderId)
      .populate('userId vendorId items.productId paymentId', '-password')
      .exec();

    if (!order) throw new NotFoundException('Order not found');

    // Restrict access
    if (role === 'student' && order.customerId.toString() !== customerId)
      throw new ForbiddenException('You are not authorized to view this order');
    if (role === 'vendor' && order.vendorId.toString() !== customerId)
      throw new ForbiddenException('You are not authorized to view this order');

    await this.cacheManager.set(cacheKey, order, 300);
    return order;
  }

  // -------------------------
  // UPDATE ORDER
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
  // UPDATE STATUS
  // -------------------------
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<OrderDocument> {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

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
    if (
      [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(order.status as OrderStatus)
    )
      throw new ConflictException('Cannot cancel this order');

    order.status = OrderStatus.CANCELLED;
    order.cancellationReason = dto.cancellationReason;
    order.statusHistory.push({
      status: OrderStatus.CANCELLED,
      timestamp: new Date(),
      note: dto.cancellationReason,
    });

    const updated = await order.save();
    await this.cacheManager.set(`order:${orderId}`, updated, 300);

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
    await this.cacheManager.set(`order:${orderId}`, updated, 300);

    this.logger.log(`⭐ Order rated: ${orderId}`);
    return updated;
  }

  // -------------------------
  // AUTO-COMPLETE DELIVERED ORDERS (Cron / Admin)
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
}
