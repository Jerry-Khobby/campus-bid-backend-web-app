import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { OrdersService } from './orders.service';
import { Order } from './schema/order.schema';
import { User } from '../users/schema/user.schema';
import { Product } from '../products/schema/product.schema';
import { Vendor } from '../vendors/schema/vendor.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payment.service';
import { OrderStatus } from './dto/order-status.enum';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderModel: any;
  let cacheManager: any;
  let notificationsService: any;
  let paymentsService: any;

  const customerId = new Types.ObjectId().toString();
  const vendorId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId().toString();
  const paymentId = new Types.ObjectId().toString();

  const buildOrder = (overrides: Record<string, any> = {}) => ({
    _id: orderId,
    customerId: { toString: () => customerId },
    vendorId: { toString: () => vendorId },
    status: OrderStatus.PENDING,
    statusHistory: [],
    paymentId: undefined,
    save: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    orderModel = { findById: jest.fn() };
    cacheManager = { get: jest.fn(), set: jest.fn() };
    notificationsService = { notify: jest.fn().mockResolvedValue({}) };
    paymentsService = { releasePayment: jest.fn(), refundPayment: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(Product.name), useValue: {} },
        { provide: getModelToken(Vendor.name), useValue: {} },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('acceptOrder', () => {
    it('accepts a pending order owned by the vendor', async () => {
      const order = buildOrder();
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);

      const result = await service.acceptOrder(orderId, vendorId, {
        estimatedPreparationTime: 30,
      });

      expect(result.status).toBe(OrderStatus.ACCEPTED);
      expect(result.estimatedDeliveryTime).toBeInstanceOf(Date);
      expect(notificationsService.notify).toHaveBeenCalledWith(
        customerId,
        'customer',
        'order_status_changed',
        'Order Accepted',
        'Your order has been accepted and is being prepared',
        expect.objectContaining({ status: OrderStatus.ACCEPTED }),
      );
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(
        service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({ vendorId: { toString: () => 'someone-else' } }),
      );

      await expect(
        service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the order is not pending', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.ACCEPTED }));

      await expect(
        service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 }),
      ).rejects.toThrow(ConflictException);
    });

    it('does not fail the accept flow when the notification call throws', async () => {
      const order = buildOrder();
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);
      notificationsService.notify.mockRejectedValue(new Error('notify down'));

      await expect(
        service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 }),
      ).resolves.toBeDefined();
    });
  });

  describe('rejectOrder', () => {
    it('rejects a pending order and refunds an existing payment', async () => {
      const order = buildOrder({ paymentId: { toString: () => paymentId } });
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);
      paymentsService.refundPayment.mockResolvedValue({});

      const result = await service.rejectOrder(orderId, vendorId, { reason: 'Out of stock' });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Out of stock');
      expect(paymentsService.refundPayment).toHaveBeenCalledWith(
        paymentId,
        { reason: 'Order rejected by vendor: Out of stock' },
        vendorId,
      );
    });

    it('continues rejecting the order when the refund call throws', async () => {
      const order = buildOrder({ paymentId: { toString: () => paymentId } });
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);
      paymentsService.refundPayment.mockRejectedValue(new Error('already refunded'));

      const result = await service.rejectOrder(orderId, vendorId, { reason: 'Out of stock' });

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('skips the refund call when the order has no payment', async () => {
      const order = buildOrder();
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);

      await service.rejectOrder(orderId, vendorId, { reason: 'Out of stock' });

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({ vendorId: { toString: () => 'someone-else' } }),
      );

      await expect(
        service.rejectOrder(orderId, vendorId, { reason: 'Out of stock' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the order is not pending', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.DELIVERED }));

      await expect(
        service.rejectOrder(orderId, vendorId, { reason: 'Out of stock' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('markDelivered', () => {
    it('marks an out-for-delivery order as delivered', async () => {
      const order = buildOrder({ status: OrderStatus.OUT_FOR_DELIVERY });
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);

      const result = await service.markDelivered(orderId, vendorId);

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.actualDeliveryTime).toBeInstanceOf(Date);
    });

    it('throws ConflictException when the order is not out for delivery', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.PENDING }));

      await expect(service.markDelivered(orderId, vendorId)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({
          status: OrderStatus.OUT_FOR_DELIVERY,
          vendorId: { toString: () => 'someone-else' },
        }),
      );

      await expect(service.markDelivered(orderId, vendorId)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.markDelivered(orderId, vendorId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmDelivery', () => {
    it('completes the order, stores the rating, and releases payment', async () => {
      const order = buildOrder({
        status: OrderStatus.DELIVERED,
        paymentId: { toString: () => paymentId },
      });
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);
      paymentsService.releasePayment.mockResolvedValue({});

      const result = await service.confirmDelivery(orderId, customerId, {
        rating: 5,
        review: 'Great!',
      });

      expect(result.status).toBe(OrderStatus.COMPLETED);
      expect(result.rating).toEqual(expect.objectContaining({ score: 5, review: 'Great!' }));
      expect(paymentsService.releasePayment).toHaveBeenCalledWith(paymentId, customerId);
    });

    it('completes the order without a rating when none is provided', async () => {
      const order = buildOrder({ status: OrderStatus.DELIVERED });
      order.save.mockResolvedValue(order);
      orderModel.findById.mockResolvedValue(order);

      const result = await service.confirmDelivery(orderId, customerId, {});

      expect(result.status).toBe(OrderStatus.COMPLETED);
      expect(result.rating).toBeUndefined();
      expect(paymentsService.releasePayment).not.toHaveBeenCalled();
    });

    it('propagates the error when releasing payment fails', async () => {
      const order = buildOrder({
        status: OrderStatus.DELIVERED,
        paymentId: { toString: () => paymentId },
      });
      orderModel.findById.mockResolvedValue(order);
      paymentsService.releasePayment.mockRejectedValue(new ForbiddenException('cannot release'));

      await expect(service.confirmDelivery(orderId, customerId, {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(order.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the order belongs to another customer', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({
          status: OrderStatus.DELIVERED,
          customerId: { toString: () => 'someone-else' },
        }),
      );

      await expect(service.confirmDelivery(orderId, customerId, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when the order is not delivered', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.PENDING }));

      await expect(service.confirmDelivery(orderId, customerId, {})).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('trackOrder', () => {
    it('returns a trimmed tracking summary for the owning customer', async () => {
      const leanOrder = {
        customerId: { toString: () => customerId },
        vendorId: { toString: () => vendorId },
      };
      const populatedOrder = {
        _id: orderId,
        status: OrderStatus.OUT_FOR_DELIVERY,
        statusHistory: [{ status: OrderStatus.PENDING, timestamp: new Date() }],
        estimatedDeliveryTime: new Date(),
        vendorId: { profile: { businessName: 'Pizza Place', phoneNumber: '0551234567' } },
      };

      orderModel.findById
        .mockReturnValueOnce({ lean: () => ({ exec: () => Promise.resolve(leanOrder) }) })
        .mockReturnValueOnce({ populate: () => ({ exec: () => Promise.resolve(populatedOrder) }) });

      const result = await service.trackOrder(orderId, customerId, 'student');

      expect(result).toEqual({
        orderId,
        currentStatus: OrderStatus.OUT_FOR_DELIVERY,
        statusHistory: populatedOrder.statusHistory,
        estimatedDeliveryTime: populatedOrder.estimatedDeliveryTime,
        vendor: { businessName: 'Pizza Place', phoneNumber: '0551234567' },
      });
    });

    it('throws BadRequestException for an invalid order id', async () => {
      await expect(service.trackOrder('not-an-id', customerId, 'student')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      await expect(service.trackOrder(orderId, customerId, 'student')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when a different customer requests tracking', async () => {
      const leanOrder = {
        customerId: { toString: () => 'someone-else' },
        vendorId: { toString: () => vendorId },
      };
      orderModel.findById.mockReturnValueOnce({
        lean: () => ({ exec: () => Promise.resolve(leanOrder) }),
      });

      await expect(service.trackOrder(orderId, customerId, 'student')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
