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
import { Order, OrderDocument } from './schema/order.schema';
import { OrderStatus } from './dto/order-status.enum';

// Import dependent schemas
import { User,UserDocument } from '../users/schema/user.schema';
import { Product,ProductDocument } from '../products/schema/product.schema';
import { Vendor,VendorDocument } from '../vendors/schema/vendor.schema';

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
  if (role === 'student' && orderLean.customerId.toString() !== userId) {
    throw new ForbiddenException('Unauthorized access');
  }
  if (role === 'vendor' && orderLean.vendorId.toString() !== userId) {
    throw new ForbiddenException('Unauthorized access');
  }

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
    if ([OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REFUNDED].includes(order.status as OrderStatus))
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
}
