import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { OrdersService } from './orders.service';
import { Order } from './schema/order.schema';
import { User } from '../users/schema/user.schema';
import { Product } from '../products/schema/product.schema';
import { Vendor } from '../vendors/schema/vendor.schema';
import { Payment } from '../payments/schema/payment.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payment.service';
import { OrderStatus } from './dto/order-status.enum';
import { MAX_DELIVERY_CODE_ATTEMPTS } from './order.constants';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderModel: any;
  let userModel: any;
  let productModel: any;
  let vendorModel: any;
  let paymentModel: any;
  let notificationsService: any;
  let paymentsService: any;

  const customerId = new Types.ObjectId().toString();
  const vendorId = new Types.ObjectId().toString();
  const orderId = new Types.ObjectId().toString();
  const paymentId = new Types.ObjectId().toString();
  const productId = new Types.ObjectId().toString();

  const buildOrder = (overrides: Record<string, any> = {}) => ({
    _id: orderId,
    orderNumber: 'ORD-1',
    customerId: { toString: () => customerId },
    vendorId: { toString: () => vendorId },
    status: OrderStatus.PENDING,
    statusHistory: [],
    items: [{ productId, quantity: 2 }],
    paymentId: undefined,
    save: jest.fn(),
    ...overrides,
  });

  const buildSavingOrder = (overrides: Record<string, any> = {}) => {
    const order = buildOrder(overrides);
    order.save.mockResolvedValue(order);
    orderModel.findById.mockResolvedValue(order);
    return order;
  };

  const withPayment = { paymentId: { toString: () => paymentId } };

  const mockPaymentStatus = (status: string) => {
    paymentModel.findById.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ status }) }),
    });
  };

  beforeEach(async () => {
    orderModel = Object.assign(
      jest.fn().mockImplementation((doc: any) => ({ ...doc, save: jest.fn().mockResolvedValue(doc) })),
      { findById: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
    );
    userModel = { findById: jest.fn() };
    productModel = {
      find: jest.fn(),
      findOneAndUpdate: jest.fn().mockResolvedValue({}),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    vendorModel = { findById: jest.fn() };
    paymentModel = { findById: jest.fn() };
    notificationsService = {
      notify: jest.fn().mockResolvedValue({}),
      notifyAllAdmins: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = { releasePayment: jest.fn(), refundPayment: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  describe('createOrder', () => {
    const secondProductId = new Types.ObjectId().toString();

    const buildProduct = (overrides: Record<string, any> = {}) => ({
      _id: productId,
      vendorId: { toString: () => vendorId },
      name: 'Notebook',
      images: ['notebook.png'],
      price: 10,
      discountPrice: undefined,
      isAvailable: true,
      stock: 5,
      ...overrides,
    });

    const buildDto = (overrides: Record<string, any> = {}) =>
      ({
        vendorId,
        items: [{ productId, quantity: 3 }],
        deliveryAddress: { location: { type: 'Point', coordinates: [0, 0] } },
        ...overrides,
      }) as any;

    beforeEach(() => {
      userModel.findById.mockResolvedValue({ email: 'student@test.com' });
      vendorModel.findById.mockResolvedValue({
        _id: { toString: () => vendorId },
        role: 'vendor',
        isActive: true,
        email: 'vendor@test.com',
      });
      productModel.find.mockResolvedValue([buildProduct()]);
    });

    it('prices items from the product catalogue, not the request', async () => {
      const tamperedDto = buildDto({ items: [{ productId, quantity: 3, price: 0.01 }] });

      const order: any = await service.createOrder(customerId, tamperedDto);

      expect(order.items[0].price).toBe(10);
    });

    it('takes the product name from the catalogue, not the request', async () => {
      const tamperedDto = buildDto({ items: [{ productId, quantity: 3, productName: 'Free laptop' }] });

      const order: any = await service.createOrder(customerId, tamperedDto);

      expect(order.items[0].productName).toBe('Notebook');
    });

    it('computes the pricing breakdown on the server', async () => {
      const tamperedDto = buildDto({ pricing: { subtotal: 0, deliveryFee: 0, serviceFee: 0, total: 0.01 } });

      const order: any = await service.createOrder(customerId, tamperedDto);

      expect(order.pricing).toEqual({ subtotal: 30, deliveryFee: 2, serviceFee: 0, total: 32 });
    });

    it('uses the discount price when the product has one', async () => {
      productModel.find.mockResolvedValue([buildProduct({ discountPrice: 7 })]);

      const order: any = await service.createOrder(customerId, buildDto());

      expect(order.items[0].price).toBe(7);
    });

    it('ignores a discount price that is higher than the price', async () => {
      productModel.find.mockResolvedValue([buildProduct({ discountPrice: 12 })]);

      const order: any = await service.createOrder(customerId, buildDto());

      expect(order.items[0].price).toBe(10);
    });

    it('rounds the subtotal to two decimal places', async () => {
      productModel.find.mockResolvedValue([buildProduct({ price: 0.1 })]);

      const order: any = await service.createOrder(customerId, buildDto());

      expect(order.pricing.subtotal).toBe(0.3);
    });

    it('generates a six-digit delivery code', async () => {
      const order: any = await service.createOrder(customerId, buildDto());

      expect(order.deliveryCode).toMatch(/^\d{6}$/);
    });

    it('marks the order as holding reserved stock', async () => {
      const order: any = await service.createOrder(customerId, buildDto());

      expect(order.stockReserved).toBe(true);
    });

    it('decrements stock only when enough units remain', async () => {
      await service.createOrder(customerId, buildDto());

      expect(productModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: productId, isAvailable: true, stock: { $gte: 3 } },
        { $inc: { stock: -3 } },
      );
    });

    it('rejects the order with a 409 when the stock has run out', async () => {
      productModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(ConflictException);
    });

    it('gives back units already reserved when a later item runs out', async () => {
      productModel.find.mockResolvedValue([
        buildProduct(),
        buildProduct({ _id: secondProductId, name: 'Pen' }),
      ]);
      productModel.findOneAndUpdate.mockResolvedValueOnce({}).mockResolvedValueOnce(null);
      const dto = buildDto({
        items: [
          { productId, quantity: 3 },
          { productId: secondProductId, quantity: 1 },
        ],
      });

      await expect(service.createOrder(customerId, dto)).rejects.toThrow(ConflictException);
      expect(productModel.updateOne).toHaveBeenCalledWith({ _id: productId }, { $inc: { stock: 3 } });
    });

    it('gives back the reserved units when saving the order fails', async () => {
      orderModel.mockImplementation((doc: any) => ({
        ...doc,
        save: jest.fn().mockRejectedValue(new Error('db down')),
      }));

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(productModel.updateOne).toHaveBeenCalledWith({ _id: productId }, { $inc: { stock: 3 } });
    });

    it('rejects a product that is not available with a 400', async () => {
      productModel.find.mockResolvedValue([buildProduct({ isAvailable: false })]);

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(BadRequestException);
    });

    it('rejects a product from another vendor with a 400 instead of a 500', async () => {
      const otherVendorProduct = buildProduct({ vendorId: { toString: () => 'other-vendor' } });
      productModel.find.mockResolvedValue([otherVendorProduct]);

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(BadRequestException);
    });

    it('rejects a product that does not exist with a 404', async () => {
      productModel.find.mockResolvedValue([]);

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(NotFoundException);
    });

    it('rejects the same product listed twice with a 400', async () => {
      const dto = buildDto({ items: [{ productId, quantity: 1 }, { productId, quantity: 2 }] });

      await expect(service.createOrder(customerId, dto)).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown vendor with a 404', async () => {
      vendorModel.findById.mockResolvedValue(null);

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(NotFoundException);
    });

    it('rejects a vendor that is suspended or not yet approved with a 400', async () => {
      vendorModel.findById.mockResolvedValue({ role: 'vendor', isActive: false });

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(BadRequestException);
    });

    it('reports an unexpected failure as a 500', async () => {
      userModel.findById.mockRejectedValue(new Error('db down'));

      await expect(service.createOrder(customerId, buildDto())).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('updateOrder', () => {
    it('rejects a vendor who does not own the order', async () => {
      orderModel.findById.mockResolvedValue(buildOrder());

      await expect(
        service.updateOrder(orderId, 'other-vendor', { vendorNotes: 'hijack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates vendor notes on an order the vendor owns', async () => {
      buildSavingOrder();

      const result = await service.updateOrder(orderId, vendorId, { vendorNotes: 'Ready at 5pm' });

      expect(result.vendorNotes).toBe('Ready at 5pm');
    });

    it('updates the estimated delivery time', async () => {
      buildSavingOrder();

      const result = await service.updateOrder(orderId, vendorId, {
        estimatedDeliveryTime: '2026-10-01T18:00:00.000Z' as any,
      });

      expect(result.estimatedDeliveryTime).toEqual(new Date('2026-10-01T18:00:00.000Z'));
    });

    it('never applies a status that slipped into the update', async () => {
      buildSavingOrder();
      const smuggled = { vendorNotes: 'x', status: OrderStatus.COMPLETED } as any;

      const result = await service.updateOrder(orderId, vendorId, smuggled);

      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('never applies pricing that slipped into the update', async () => {
      buildSavingOrder({ pricing: { total: 32 } });
      const smuggled = { pricing: { total: 999 } } as any;

      const result = await service.updateOrder(orderId, vendorId, smuggled);

      expect(result.pricing.total).toBe(32);
    });
  });

  describe('updateOrderStatus', () => {
    it('updates the status and never returns the delivery code to the vendor', async () => {
      buildSavingOrder({ status: OrderStatus.ACCEPTED, deliveryCode: '482193' });

      const result = await service.updateOrderStatus(orderId, vendorId, OrderStatus.PREPARING);

      expect(result.deliveryCode).toBeUndefined();
    });

    it('moves an accepted order to preparing', async () => {
      buildSavingOrder({ status: OrderStatus.ACCEPTED });

      const result = await service.updateOrderStatus(orderId, vendorId, OrderStatus.PREPARING);

      expect(result.status).toBe(OrderStatus.PREPARING);
    });

    it('refuses to skip straight from pending to out for delivery', async () => {
      buildSavingOrder({ status: OrderStatus.PENDING });

      await expect(
        service.updateOrderStatus(orderId, vendorId, OrderStatus.OUT_FOR_DELIVERY),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to mark an order delivered without the delivery code', async () => {
      buildSavingOrder({ status: OrderStatus.OUT_FOR_DELIVERY });

      await expect(
        service.updateOrderStatus(orderId, vendorId, OrderStatus.DELIVERED),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({ vendorId: { toString: () => 'someone-else' } }),
      );

      await expect(
        service.updateOrderStatus(orderId, vendorId, OrderStatus.PREPARING),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelOrder', () => {
    const dto = { cancellationReason: 'Changed my mind' };

    it.each([OrderStatus.PENDING, OrderStatus.ACCEPTED])('cancels a %s order', async (status) => {
      buildSavingOrder({ status });

      const result = await service.cancelOrder(orderId, customerId, dto);

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it.each([
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ])('refuses to cancel a %s order', async (status) => {
      buildSavingOrder({ status });

      await expect(service.cancelOrder(orderId, customerId, dto)).rejects.toThrow(ConflictException);
    });

    it('refuses to cancel an order whose stored status is unknown', async () => {
      buildSavingOrder({ status: 'archived' });

      await expect(service.cancelOrder(orderId, customerId, dto)).rejects.toThrow(ConflictException);
    });

    it('throws ForbiddenException when the order belongs to another customer', async () => {
      buildSavingOrder({ customerId: { toString: () => 'someone-else' } });

      await expect(service.cancelOrder(orderId, customerId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('refunds a held payment', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');

      await service.cancelOrder(orderId, customerId, dto);

      expect(paymentsService.refundPayment).toHaveBeenCalledWith(
        paymentId,
        { reason: 'Order cancelled by customer: Changed my mind' },
        customerId,
      );
    });

    it('skips the refund when the payment was never captured', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('pending');

      await service.cancelOrder(orderId, customerId, dto);

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });

    it('fails with a 502 when the refund fails', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));

      await expect(service.cancelOrder(orderId, customerId, dto)).rejects.toThrow(BadGatewayException);
    });

    it('leaves the order uncancelled when the refund fails', async () => {
      const order = buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));

      await service.cancelOrder(orderId, customerId, dto).catch(() => undefined);

      expect(order.save).not.toHaveBeenCalled();
    });

    it('alerts the admins when the refund fails', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));

      await service.cancelOrder(orderId, customerId, dto).catch(() => undefined);

      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'payment',
        'Order refund failed',
        expect.any(String),
        expect.objectContaining({ orderId, reason: 'paystack down' }),
      );
    });

    it('still reports the refund failure when alerting the admins fails', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));
      notificationsService.notifyAllAdmins.mockRejectedValue(new Error('notify down'));

      await expect(service.cancelOrder(orderId, customerId, dto)).rejects.toThrow(BadGatewayException);
    });

    it('gives the reserved units back to stock', async () => {
      buildSavingOrder({ stockReserved: true });

      await service.cancelOrder(orderId, customerId, dto);

      expect(productModel.updateOne).toHaveBeenCalledWith({ _id: productId }, { $inc: { stock: 2 } });
    });

    it('leaves stock alone for an order that never reserved any', async () => {
      buildSavingOrder({ stockReserved: undefined });

      await service.cancelOrder(orderId, customerId, dto);

      expect(productModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('rateOrder', () => {
    const dto = { score: 4, review: 'Tasty' };

    it('stores the rating on a completed order', async () => {
      buildSavingOrder({ status: OrderStatus.COMPLETED });

      const result: any = await service.rateOrder(orderId, customerId, dto);

      expect(result.rating).toEqual(expect.objectContaining({ score: 4, review: 'Tasty' }));
    });

    it('refuses to rate an order that is not completed', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });

      await expect(service.rateOrder(orderId, customerId, dto)).rejects.toThrow(BadRequestException);
    });

    it("refuses to rate another customer's order", async () => {
      buildSavingOrder({ status: OrderStatus.COMPLETED, customerId: { toString: () => 'someone-else' } });

      await expect(service.rateOrder(orderId, customerId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.rateOrder(orderId, customerId, dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptOrder', () => {
    it('accepts a pending order owned by the vendor', async () => {
      buildSavingOrder();

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

    it('throws BadRequestException for a malformed order id', async () => {
      await expect(
        service.acceptOrder('not-an-id', vendorId, { estimatedPreparationTime: 30 }),
      ).rejects.toThrow(BadRequestException);
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
      buildSavingOrder();
      notificationsService.notify.mockRejectedValue(new Error('notify down'));

      await expect(
        service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 }),
      ).resolves.toBeDefined();
    });

    it('never returns the delivery code to the vendor who just accepted the order', async () => {
      buildSavingOrder({ deliveryCode: '482193' });

      const result = await service.acceptOrder(orderId, vendorId, { estimatedPreparationTime: 30 });

      expect(result.deliveryCode).toBeUndefined();
    });
  });

  describe('rejectOrder', () => {
    const dto = { reason: 'Out of stock' };

    it('rejects a pending order and refunds a held payment', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');

      const result = await service.rejectOrder(orderId, vendorId, dto);

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(result.cancellationReason).toBe('Out of stock');
      expect(paymentsService.refundPayment).toHaveBeenCalledWith(
        paymentId,
        { reason: 'Order rejected by vendor: Out of stock' },
        vendorId,
      );
    });

    it('fails with a 502 instead of rejecting when the refund fails', async () => {
      buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));

      await expect(service.rejectOrder(orderId, vendorId, dto)).rejects.toThrow(BadGatewayException);
    });

    it('leaves the order pending when the refund fails', async () => {
      const order = buildSavingOrder(withPayment);
      mockPaymentStatus('held');
      paymentsService.refundPayment.mockRejectedValue(new Error('paystack down'));

      await service.rejectOrder(orderId, vendorId, dto).catch(() => undefined);

      expect(order.save).not.toHaveBeenCalled();
    });

    it('skips the refund call when the order has no payment', async () => {
      buildSavingOrder();

      await service.rejectOrder(orderId, vendorId, dto);

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
    });

    it('gives the reserved units back to stock', async () => {
      buildSavingOrder({ stockReserved: true });

      await service.rejectOrder(orderId, vendorId, dto);

      expect(productModel.updateOne).toHaveBeenCalledWith({ _id: productId }, { $inc: { stock: 2 } });
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({ vendorId: { toString: () => 'someone-else' } }),
      );

      await expect(service.rejectOrder(orderId, vendorId, dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when the order is no longer pending', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.ACCEPTED }));

      await expect(service.rejectOrder(orderId, vendorId, dto)).rejects.toThrow(ConflictException);
    });

    it('never returns the delivery code to the rejecting vendor', async () => {
      buildSavingOrder({ deliveryCode: '482193' });

      const result = await service.rejectOrder(orderId, vendorId, dto);

      expect(result.deliveryCode).toBeUndefined();
    });
  });

  describe('markDelivered', () => {
    const buildOutForDelivery = (overrides: Record<string, any> = {}) => {
      const order = buildSavingOrder({
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryCode: '482193',
        deliveryCodeAttempts: 1,
        ...overrides,
      });
      orderModel.findOneAndUpdate.mockResolvedValue(order);
      return order;
    };

    it('marks an out-for-delivery order as delivered when the code matches', async () => {
      buildOutForDelivery();

      const result = await service.markDelivered(orderId, vendorId, '482193');

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.actualDeliveryTime).toBeInstanceOf(Date);
      expect(result.deliveryCode).toBeUndefined();
    });

    it('still accepts the 4-digit code of an order created before codes were lengthened', async () => {
      buildOutForDelivery({ deliveryCode: '4821' });

      const result = await service.markDelivered(orderId, vendorId, '4821');

      expect(result.status).toBe(OrderStatus.DELIVERED);
    });

    it('throws ForbiddenException when the delivery code does not match', async () => {
      const order = buildOutForDelivery();

      await expect(service.markDelivered(orderId, vendorId, '000000')).rejects.toThrow(ForbiddenException);
      expect(order.save).not.toHaveBeenCalled();
    });

    it('counts the attempt only while the order is under the attempt limit', async () => {
      buildOutForDelivery();

      await service.markDelivered(orderId, vendorId, '482193');

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: orderId, deliveryCodeAttempts: { $not: { $gte: MAX_DELIVERY_CODE_ATTEMPTS } } },
        { $inc: { deliveryCodeAttempts: 1 } },
        { new: true },
      );
    });

    it('refuses even the right code once the order is locked', async () => {
      buildOutForDelivery();
      orderModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.markDelivered(orderId, vendorId, '482193')).rejects.toThrow(ForbiddenException);
    });

    it('alerts the admins when the last allowed attempt fails', async () => {
      buildOutForDelivery({ deliveryCodeAttempts: MAX_DELIVERY_CODE_ATTEMPTS });

      await service.markDelivered(orderId, vendorId, '000000').catch(() => undefined);

      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'order_update',
        'Delivery code locked',
        expect.any(String),
        expect.objectContaining({ orderId }),
      );
    });

    it('says "1 attempt left" in the singular before the final attempt', async () => {
      buildOutForDelivery({ deliveryCodeAttempts: MAX_DELIVERY_CODE_ATTEMPTS - 1 });

      await expect(service.markDelivered(orderId, vendorId, '000000')).rejects.toThrow('(1 attempt left)');
    });

    it('does not alert the admins while attempts remain', async () => {
      buildOutForDelivery({ deliveryCodeAttempts: 1 });

      await service.markDelivered(orderId, vendorId, '000000').catch(() => undefined);

      expect(notificationsService.notifyAllAdmins).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the order is not out for delivery', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.PENDING }));

      await expect(service.markDelivered(orderId, vendorId, '482193')).rejects.toThrow(ConflictException);
    });

    it('does not count an attempt on an order that is not out for delivery', async () => {
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.PENDING }));

      await service.markDelivered(orderId, vendorId, '482193').catch(() => undefined);

      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the order belongs to another vendor', async () => {
      orderModel.findById.mockResolvedValue(
        buildOrder({
          status: OrderStatus.OUT_FOR_DELIVERY,
          vendorId: { toString: () => 'someone-else' },
        }),
      );

      await expect(service.markDelivered(orderId, vendorId, '482193')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.markDelivered(orderId, vendorId, '482193')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmDelivery', () => {
    it('completes the order, stores the rating, and releases payment', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED, ...withPayment });
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
      buildSavingOrder({ status: OrderStatus.DELIVERED });

      const result = await service.confirmDelivery(orderId, customerId, {});

      expect(result.status).toBe(OrderStatus.COMPLETED);
      expect(result.rating).toBeUndefined();
      expect(paymentsService.releasePayment).not.toHaveBeenCalled();
    });

    it('propagates the error when releasing payment fails', async () => {
      const order = buildSavingOrder({ status: OrderStatus.DELIVERED, ...withPayment });
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

  describe('autoCompleteDeliveredOrders', () => {
    const buildDelivered = (overrides: Record<string, any> = {}) => {
      const order = buildOrder({ status: OrderStatus.DELIVERED, ...withPayment, ...overrides });
      order.save.mockResolvedValue(order);
      return order;
    };

    it('releases the held payment on behalf of the customer', async () => {
      orderModel.find.mockResolvedValue([buildDelivered()]);

      await service.autoCompleteDeliveredOrders();

      expect(paymentsService.releasePayment).toHaveBeenCalledWith(paymentId, customerId);
    });

    it('completes the order once the payment is released', async () => {
      const order = buildDelivered();
      orderModel.find.mockResolvedValue([order]);

      await service.autoCompleteDeliveredOrders();

      expect(order.status).toBe(OrderStatus.COMPLETED);
    });

    it('still completes the order when notifying the vendor fails', async () => {
      const order = buildDelivered();
      orderModel.find.mockResolvedValue([order]);
      notificationsService.notify.mockRejectedValue(new Error('notify down'));

      await service.autoCompleteDeliveredOrders();

      expect(order.status).toBe(OrderStatus.COMPLETED);
    });

    it('completes an order that has no payment without releasing anything', async () => {
      orderModel.find.mockResolvedValue([buildDelivered({ paymentId: undefined })]);

      await service.autoCompleteDeliveredOrders();

      expect(paymentsService.releasePayment).not.toHaveBeenCalled();
    });

    it('leaves the order delivered when its payment cannot be released', async () => {
      const order = buildDelivered();
      orderModel.find.mockResolvedValue([order]);
      paymentsService.releasePayment.mockRejectedValue(new ConflictException('not held'));

      await service.autoCompleteDeliveredOrders();

      expect(order.save).not.toHaveBeenCalled();
    });

    it('alerts the admins about orders whose payment cannot be released', async () => {
      orderModel.find.mockResolvedValue([buildDelivered()]);
      paymentsService.releasePayment.mockRejectedValue(new ConflictException('not held'));

      await service.autoCompleteDeliveredOrders();

      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'payment',
        'Orders could not be auto-completed',
        expect.any(String),
        { orderIds: [orderId] },
      );
    });

    it('counts only the orders it actually completed', async () => {
      const otherOrderId = new Types.ObjectId().toString();
      orderModel.find.mockResolvedValue([buildDelivered(), buildDelivered({ _id: otherOrderId })]);
      paymentsService.releasePayment
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new ConflictException('not held'));

      const count = await service.autoCompleteDeliveredOrders();

      expect(count).toBe(1);
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

  describe('getOrderById', () => {
    function mockLeanFind(result: any) {
      const exec = jest.fn().mockResolvedValue(result);
      const lean = jest.fn().mockReturnValue({ exec });
      orderModel.findById.mockReturnValueOnce({ lean });
    }

    function mockPopulateFind(result: any) {
      const exec = jest.fn().mockResolvedValue(result);
      const populate = jest.fn().mockReturnValue({ exec });
      orderModel.findById.mockReturnValueOnce({ populate });
    }

    it('throws BadRequestException for a malformed id', async () => {
      await expect(service.getOrderById('not-an-id', customerId, 'student')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the order does not exist', async () => {
      mockLeanFind(null);

      await expect(service.getOrderById(orderId, customerId, 'student')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('checks authorization via the cheap lean fetch before ever populating the full order', async () => {
      mockLeanFind({
        customerId: { toString: () => 'someone-else' },
        vendorId: { toString: () => vendorId },
      });

      await expect(service.getOrderById(orderId, customerId, 'student')).rejects.toThrow(
        ForbiddenException,
      );
      expect(orderModel.findById).toHaveBeenCalledTimes(1);
    });

    it('strips the delivery code when a vendor requests the order', async () => {
      mockLeanFind({
        customerId: { toString: () => customerId },
        vendorId: { toString: () => vendorId },
      });
      const populated = {
        _id: orderId,
        deliveryCode: '482193',
        status: 'out_for_delivery',
        toObject: () => ({ _id: orderId, deliveryCode: '482193', status: 'out_for_delivery' }),
      };
      mockPopulateFind(populated);

      const result = await service.getOrderById(orderId, vendorId, 'vendor');

      expect(result.deliveryCode).toBeUndefined();
    });

    it('fetches fresh every time, keeping the delivery code for the customer', async () => {
      mockLeanFind({
        customerId: { toString: () => customerId },
        vendorId: { toString: () => vendorId },
      });
      const populated = {
        _id: orderId,
        deliveryCode: '482193',
        toObject: () => ({ _id: orderId, deliveryCode: '482193' }),
      };
      mockPopulateFind(populated);

      const result = await service.getOrderById(orderId, customerId, 'student');

      expect(result.deliveryCode).toBe('482193');
    });
  });

  describe('getOrders', () => {
    function mockFindChain(result: any[]) {
      const exec = jest.fn().mockResolvedValue(result);
      const sort = jest.fn().mockReturnValue({ exec });
      const populate = jest.fn().mockReturnValue({ sort });
      orderModel.find.mockReturnValue({ populate });
      return { populate };
    }

    it('returns the freshly queried orders as-is for a student', async () => {
      mockFindChain([{ _id: 'order-1' }]);

      const result = await service.getOrders(customerId, 'student', {} as any);

      expect(result).toEqual([{ _id: 'order-1' }]);
    });

    it('filters by customerId for a student', async () => {
      mockFindChain([]);

      await service.getOrders(customerId, 'student', {} as any);

      expect(orderModel.find).toHaveBeenCalledWith({ customerId });
    });

    it('filters by vendorId for a vendor', async () => {
      mockFindChain([]);

      await service.getOrders(vendorId, 'vendor', {} as any);

      expect(orderModel.find).toHaveBeenCalledWith({ vendorId });
    });

    it("strips the delivery code from a vendor's view of their orders", async () => {
      mockFindChain([{ _id: 'order-1', status: 'out_for_delivery', deliveryCode: '482193' }]);

      const result = await service.getOrders(vendorId, 'vendor', {} as any);

      expect(result[0].deliveryCode).toBeUndefined();
      expect(result[0].status).toBe('out_for_delivery');
    });

    it("keeps the delivery code in a customer's view of their own orders", async () => {
      mockFindChain([{ _id: 'order-1', status: 'out_for_delivery', deliveryCode: '482193' }]);

      const result = await service.getOrders(customerId, 'student', {} as any);

      expect(result[0].deliveryCode).toBe('482193');
    });

    it('adds a status filter when provided', async () => {
      mockFindChain([]);

      await service.getOrders(customerId, 'student', { status: 'pending' } as any);

      expect(orderModel.find).toHaveBeenCalledWith({ customerId, status: 'pending' });
    });
  });

  describe('openDispute', () => {
    const reason = 'Two of the notebooks were missing';
    const buildDisputed = () => buildOrder({ status: OrderStatus.DISPUTED, dispute: { reason } });

    it('moves a delivered order to disputed with the reason', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });
      orderModel.findOneAndUpdate.mockResolvedValue(buildDisputed());

      const result = await service.openDispute(orderId, customerId, { reason });

      expect(result.status).toBe(OrderStatus.DISPUTED);
    });

    it('only disputes the order while it is still delivered', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });
      orderModel.findOneAndUpdate.mockResolvedValue(buildDisputed());

      await service.openDispute(orderId, customerId, { reason });

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: orderId, status: OrderStatus.DELIVERED },
        expect.objectContaining({
          $set: expect.objectContaining({ status: OrderStatus.DISPUTED, dispute: expect.objectContaining({ reason }) }),
        }),
        { new: true },
      );
    });

    it('throws ConflictException when the order changed before the dispute was saved', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });
      orderModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.openDispute(orderId, customerId, { reason })).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException for an order that has not been delivered', async () => {
      buildSavingOrder({ status: OrderStatus.OUT_FOR_DELIVERY });

      await expect(service.openDispute(orderId, customerId, { reason })).rejects.toThrow(ConflictException);
    });

    it("throws ForbiddenException for another customer's order", async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });

      await expect(
        service.openDispute(orderId, new Types.ObjectId().toString(), { reason }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('alerts the admins that the order needs review', async () => {
      buildSavingOrder({ status: OrderStatus.DELIVERED });
      orderModel.findOneAndUpdate.mockResolvedValue(buildDisputed());

      await service.openDispute(orderId, customerId, { reason });

      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'order_update',
        'Order disputed',
        expect.any(String),
        expect.objectContaining({ orderId, reason }),
      );
    });
  });

  describe('confirmDelivery on a disputed order', () => {
    it('throws ConflictException, leaving the decision to an admin', async () => {
      buildSavingOrder({ status: OrderStatus.DISPUTED, ...withPayment });

      await expect(service.confirmDelivery(orderId, customerId, {})).rejects.toThrow(ConflictException);
      expect(paymentsService.releasePayment).not.toHaveBeenCalled();
    });
  });

  describe('resolveDispute', () => {
    const adminId = new Types.ObjectId().toString();
    const refund = { resolution: 'refund' as const, note: 'Vendor confirmed the items were missing' };
    const release = { resolution: 'release' as const, note: 'Delivery photo shows every item' };

    const claimDisputedOrder = (overrides: Record<string, any> = {}) => {
      const order = buildOrder({ status: OrderStatus.DISPUTED, ...withPayment, ...overrides });
      order.save.mockResolvedValue(order);
      orderModel.findOneAndUpdate.mockResolvedValue(order);
      return order;
    };

    it('refunds the customer and marks the order refunded', async () => {
      claimDisputedOrder();

      const result = await service.resolveDispute(orderId, adminId, refund);

      expect(paymentsService.refundPayment).toHaveBeenCalledWith(paymentId, { reason: refund.note }, customerId);
      expect(result.status).toBe(OrderStatus.REFUNDED);
    });

    it('releases the payment to the vendor and completes the order', async () => {
      claimDisputedOrder();

      const result = await service.resolveDispute(orderId, adminId, release);

      expect(paymentsService.releasePayment).toHaveBeenCalledWith(paymentId, customerId);
      expect(result.status).toBe(OrderStatus.COMPLETED);
    });

    it('claims only an unresolved dispute, so two admins cannot both move the money', async () => {
      claimDisputedOrder();

      await service.resolveDispute(orderId, adminId, refund);

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: orderId, status: OrderStatus.DISPUTED, 'dispute.resolution': { $exists: false } },
        expect.objectContaining({
          $set: expect.objectContaining({ 'dispute.resolution': 'refund', 'dispute.resolutionNote': refund.note }),
        }),
        { new: true },
      );
    });

    it('throws ConflictException when the order has no open dispute', async () => {
      orderModel.findOneAndUpdate.mockResolvedValue(null);
      orderModel.findById.mockResolvedValue(buildOrder({ status: OrderStatus.COMPLETED }));

      await expect(service.resolveDispute(orderId, adminId, refund)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findOneAndUpdate.mockResolvedValue(null);
      orderModel.findById.mockResolvedValue(null);

      await expect(service.resolveDispute(orderId, adminId, refund)).rejects.toThrow(NotFoundException);
    });

    it('passes a payment-rule rejection through and reopens the dispute', async () => {
      const order = claimDisputedOrder();
      paymentsService.releasePayment.mockRejectedValue(new ConflictException('Payment cannot be released'));

      await expect(service.resolveDispute(orderId, adminId, release)).rejects.toThrow(ConflictException);
      expect(orderModel.updateOne).toHaveBeenCalledWith({ _id: orderId }, expect.objectContaining({ $unset: expect.any(Object) }));
      expect(order.save).not.toHaveBeenCalled();
    });

    it('reports a payment gateway failure as BadGatewayException and reopens the dispute', async () => {
      claimDisputedOrder();
      paymentsService.refundPayment.mockRejectedValue(new Error('Paystack timeout'));

      await expect(service.resolveDispute(orderId, adminId, refund)).rejects.toThrow(BadGatewayException);
      expect(orderModel.updateOne).toHaveBeenCalled();
    });

    it('resolves an order that never had a payment without moving money', async () => {
      claimDisputedOrder({ paymentId: undefined });

      const result = await service.resolveDispute(orderId, adminId, refund);

      expect(paymentsService.refundPayment).not.toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.REFUNDED);
    });

    it('tells the customer and the vendor how the dispute was resolved', async () => {
      claimDisputedOrder();

      await service.resolveDispute(orderId, adminId, refund);

      expect(notificationsService.notify).toHaveBeenCalledWith(
        customerId, 'customer', 'order_status_changed', 'Dispute Resolved', expect.stringContaining(refund.note), expect.any(Object),
      );
      expect(notificationsService.notify).toHaveBeenCalledWith(
        vendorId, 'vendor', 'order_status_changed', 'Dispute Resolved', expect.stringContaining(refund.note), expect.any(Object),
      );
    });

    it('throws BadRequestException for a malformed order id', async () => {
      await expect(service.resolveDispute('not-an-id', adminId, refund)).rejects.toThrow(BadRequestException);
    });
  });
});
