import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentsService } from './payment.service';
import { PaystackService } from './paystack.service';
import { PayoutsService } from './payouts.service';
import { Payment } from './schema/payment.schema';
import { Order } from '../orders/schema/order.schema';
import { NotificationsService } from '../notifications/notifications.service';

// The real order.schema.ts pulls in the `uuid` package (ESM-only), which the
// project's CommonJS Jest transform cannot parse. Stub it so this unit test
// stays isolated from that unrelated, pre-existing toolchain incompatibility.
jest.mock('../orders/schema/order.schema', () => ({
  Order: class Order {},
}));

const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const VENDOR_ID = '507f1f77bcf86cd799439012';
const ORDER_ID = '507f1f77bcf86cd799439013';
const PAYMENT_ID = '507f1f77bcf86cd799439014';

function createPaymentDoc(overrides: Record<string, any> = {}) {
  const doc: any = {
    _id: PAYMENT_ID,
    customerId: { toString: () => CUSTOMER_ID },
    vendorId: { toString: () => VENDOR_ID },
    orderId: ORDER_ID,
    amount: 100,
    status: 'held',
    metadata: {},
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  doc.toObject = jest.fn(() => {
    const { save, toObject, ...fields } = doc;
    return { ...fields, metadata: fields.metadata && { ...fields.metadata } };
  });
  return doc;
}

const ADMIN = { sub: '507f1f77bcf86cd799439015', role: 'admin' };
const CUSTOMER = { sub: CUSTOMER_ID, role: 'student' };
const VENDOR = { sub: VENDOR_ID, role: 'vendor' };
const STRANGER = { sub: '507f1f77bcf86cd799439016', role: 'student' };

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentModel: any;
  let orderModel: any;
  let paystackService: jest.Mocked<PaystackService>;
  let notificationsService: { notifyAllAdmins: jest.Mock };
  let payoutsService: { reconcilePayoutByReference: jest.Mock };

  beforeEach(async () => {
    paymentModel = jest.fn().mockImplementation((data: any) => ({
      ...data,
      _id: PAYMENT_ID,
      save: jest.fn().mockResolvedValue({ ...data, _id: PAYMENT_ID }),
    }));
    paymentModel.findOne = jest.fn();
    paymentModel.findById = jest.fn();
    paymentModel.find = jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });

    orderModel = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        {
          provide: PaystackService,
          useValue: {
            initializeTransaction: jest.fn(),
            verifyTransaction: jest.fn(),
            verifyWebhookSignature: jest.fn(),
            chargeMobileMoney: jest.fn(),
            submitOtp: jest.fn(),
            refundTransaction: jest.fn(),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: NotificationsService, useValue: { notifyAllAdmins: jest.fn().mockResolvedValue(undefined) } },
        { provide: PayoutsService, useValue: { reconcilePayoutByReference: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paystackService = module.get(PaystackService);
    notificationsService = module.get(NotificationsService);
    payoutsService = module.get(PayoutsService);
  });

  describe('initializePayment', () => {
    const dto = { orderId: ORDER_ID, paymentMethod: 'card' } as any;

    it('creates a pending payment and returns the Paystack authorization data', async () => {
      const order = {
        _id: ORDER_ID,
        customerId: { toString: () => CUSTOMER_ID },
        vendorId: VENDOR_ID,
        pricing: { total: 150 },
        save: jest.fn().mockResolvedValue(true),
      };
      orderModel.findById.mockResolvedValue(order);
      paymentModel.findOne.mockResolvedValue(null);
      paystackService.initializeTransaction.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/xyz',
        access_code: 'access123',
        reference: 'ref123',
      } as any);

      const result = await service.initializePayment(CUSTOMER_ID, dto, 'buyer@campus.edu');

      expect(result).toMatchObject({ paymentMethod: 'card', authorizationUrl: 'https://paystack.com/pay/xyz' });
      expect(paystackService.initializeTransaction).toHaveBeenCalledWith(
        'buyer@campus.edu',
        15000,
        expect.any(String),
        expect.any(String),
      );
    });

    it('links the order to its payment', async () => {
      const order = {
        _id: ORDER_ID,
        customerId: { toString: () => CUSTOMER_ID },
        vendorId: VENDOR_ID,
        pricing: { total: 150 },
        save: jest.fn().mockResolvedValue(true),
      };
      orderModel.findById.mockResolvedValue(order);
      paymentModel.findOne.mockResolvedValue(null);
      paystackService.initializeTransaction.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/xyz',
        access_code: 'access123',
        reference: 'ref123',
      } as any);

      await service.initializePayment(CUSTOMER_ID, dto, 'buyer@campus.edu');

      expect((order as any).paymentId).toBe(PAYMENT_ID);
      expect(order.save).toHaveBeenCalled();
    });

    it('charges mobile money directly instead of returning a redirect URL', async () => {
      orderModel.findById.mockResolvedValue({
        _id: ORDER_ID,
        customerId: { toString: () => CUSTOMER_ID },
        vendorId: VENDOR_ID,
        pricing: { total: 150 },
        save: jest.fn().mockResolvedValue(true),
      });
      paymentModel.findOne.mockResolvedValue(null);
      paystackService.chargeMobileMoney.mockResolvedValue({
        status: 'pay_offline',
        display_text: 'Approve the payment prompt on your phone',
        reference: 'ref123',
      } as any);

      const momoDto = { orderId: ORDER_ID, paymentMethod: 'mobile_money', momoProvider: 'mtn', phone: '0551234567' } as any;
      const result = await service.initializePayment(CUSTOMER_ID, momoDto, 'buyer@campus.edu');

      expect(result).toMatchObject({
        paymentMethod: 'mobile_money',
        status: 'pay_offline',
        displayText: 'Approve the payment prompt on your phone',
      });
      expect(paystackService.chargeMobileMoney).toHaveBeenCalledWith(
        'buyer@campus.edu',
        15000,
        expect.any(String),
        '0551234567',
        'mtn',
      );
      expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
    });

    it('marks the payment failed when the mobile money charge fails immediately', async () => {
      const paymentDoc = createPaymentDoc({ status: 'pending' });
      orderModel.findById.mockResolvedValue({
        _id: ORDER_ID,
        customerId: { toString: () => CUSTOMER_ID },
        vendorId: VENDOR_ID,
        pricing: { total: 150 },
        save: jest.fn().mockResolvedValue(true),
      });
      paymentModel.findOne.mockResolvedValue(null);
      paymentModel.mockImplementationOnce((data: any) => paymentDoc);
      paystackService.chargeMobileMoney.mockResolvedValue({ status: 'failed', reference: 'ref123' } as any);

      const momoDto = { orderId: ORDER_ID, paymentMethod: 'mobile_money', momoProvider: 'mtn', phone: '0551234567' } as any;
      const result = await service.initializePayment(CUSTOMER_ID, momoDto, 'buyer@campus.edu');

      expect((result as any).status).toBe('failed');
      expect(paymentDoc.status).toBe('failed');
      expect(paymentDoc.save).toHaveBeenCalled();
    });

    it('throws NotFoundException when the order does not exist', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.initializePayment(CUSTOMER_ID, dto, 'buyer@campus.edu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the order belongs to another customer', async () => {
      orderModel.findById.mockResolvedValue({
        _id: ORDER_ID,
        customerId: { toString: () => 'someone-else' },
        pricing: { total: 150 },
      });

      await expect(service.initializePayment(CUSTOMER_ID, dto, 'buyer@campus.edu')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when the order already has an active payment', async () => {
      orderModel.findById.mockResolvedValue({
        _id: ORDER_ID,
        customerId: { toString: () => CUSTOMER_ID },
        pricing: { total: 150 },
      });
      paymentModel.findOne.mockResolvedValue(createPaymentDoc());

      await expect(service.initializePayment(CUSTOMER_ID, dto, 'buyer@campus.edu')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('handleWebhook', () => {
    it('throws UnauthorizedException when the signature is invalid', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        service.handleWebhook(Buffer.from('{}'), 'bad-sig', { event: 'charge.success' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('routes transfer events to the payouts service instead of touching payments', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);

      const result = await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'transfer.success',
        data: { reference: 'payout_abc123' },
      });

      expect(result).toEqual({ received: true });
      expect(payoutsService.reconcilePayoutByReference).toHaveBeenCalledWith('payout_abc123');
      expect(paymentModel.findOne).not.toHaveBeenCalled();
    });

    it('ignores events it does not handle', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);

      const result = await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'subscription.create',
      });

      expect(result).toEqual({ received: true });
      expect(paymentModel.findOne).not.toHaveBeenCalled();
    });

    it('returns received without throwing when the payment is not found', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      paymentModel.findOne.mockResolvedValue(null);

      const result = await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.success',
        data: { reference: 'unknown-ref' },
      });

      expect(result).toEqual({ received: true });
    });

    it('is idempotent for payments that are no longer pending', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findOne.mockResolvedValue(payment);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.success',
        data: { reference: 'ref123' },
      });

      expect(paystackService.verifyTransaction).not.toHaveBeenCalled();
      expect(payment.save).not.toHaveBeenCalled();
    });

    it('moves a pending payment to held on a verified charge.success', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'pending', amount: 150 });
      paymentModel.findOne.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'success', amount: 15000 } as any);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.success',
        data: { reference: 'ref123' },
      });

      expect(payment.status).toBe('held');
      expect(payment.save).toHaveBeenCalled();
    });

    it('marks the payment failed and notifies admins when the verified amount does not match', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'pending', amount: 150 });
      paymentModel.findOne.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'success', amount: 5000 } as any);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.success',
        data: { reference: 'ref123' },
      });

      expect(payment.status).toBe('failed');
      expect(payment.save).toHaveBeenCalled();
      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'payment',
        expect.any(String),
        expect.stringContaining(String(PAYMENT_ID)),
        expect.objectContaining({ paymentId: PAYMENT_ID, verifiedStatus: 'success', verifiedAmount: 5000 }),
      );
    });

    it('does not release funds when the verified status is not success', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'pending', amount: 150 });
      paymentModel.findOne.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'abandoned', amount: 15000 } as any);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.success',
        data: { reference: 'ref123' },
      });

      expect(payment.status).toBe('failed');
    });

    it('marks a pending payment as failed on charge.failed, verified against Paystack', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'pending' });
      paymentModel.findOne.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'failed', amount: 15000 } as any);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.failed',
        data: { reference: 'ref123' },
      });

      expect(payment.status).toBe('failed');
      expect(payment.save).toHaveBeenCalled();
    });

    it('leaves a payment pending when Paystack still reports it as in progress', async () => {
      paystackService.verifyWebhookSignature.mockReturnValue(true);
      const payment = createPaymentDoc({ status: 'pending' });
      paymentModel.findOne.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'pending', amount: 15000 } as any);

      await service.handleWebhook(Buffer.from('{}'), 'sig', {
        event: 'charge.failed',
        data: { reference: 'ref123' },
      });

      expect(payment.status).toBe('pending');
      expect(payment.save).not.toHaveBeenCalled();
    });
  });

  describe('listPayments', () => {
    it('builds a filter from the provided query fields', async () => {
      const sort = jest.fn().mockResolvedValue([]);
      const populate = jest.fn().mockReturnThis();
      paymentModel.find.mockReturnValue({ populate, sort });

      await service.listPayments({
        status: 'held',
        paymentMethod: 'card',
        customerId: CUSTOMER_ID,
        vendorId: VENDOR_ID,
        transactionId: 'ref123',
      } as any);

      expect(paymentModel.find).toHaveBeenCalledWith({
        status: 'held',
        paymentMethod: 'card',
        customerId: expect.any(Object),
        vendorId: expect.any(Object),
        transactionId: 'ref123',
      });
    });

    it('applies no filter when the query is empty', async () => {
      const sort = jest.fn().mockResolvedValue([]);
      const populate = jest.fn().mockReturnThis();
      paymentModel.find.mockReturnValue({ populate, sort });

      await service.listPayments({} as any);

      expect(paymentModel.find).toHaveBeenCalledWith({});
    });
  });

  describe('updatePayment', () => {
    it('merges the dto fields into the payment and saves it', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);

      const result = await service.updatePayment(PAYMENT_ID, { currency: 'USD' } as any);

      expect(result.currency).toBe('USD');
      expect(payment.save).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('throws BadRequestException for a malformed id', async () => {
      await expect(service.findById('not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when no payment exists', async () => {
      paymentModel.findById.mockResolvedValue(null);
      await expect(service.findById(PAYMENT_ID)).rejects.toThrow(NotFoundException);
    });

    it('returns the payment when found', async () => {
      const payment = createPaymentDoc();
      paymentModel.findById.mockResolvedValue(payment);
      await expect(service.findById(PAYMENT_ID)).resolves.toBe(payment);
    });

    it('self-heals a stuck pending payment by re-verifying with Paystack', async () => {
      const payment = createPaymentDoc({ status: 'pending', amount: 150 });
      paymentModel.findById.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockResolvedValue({ status: 'success', amount: 15000 } as any);

      const result = await service.findById(PAYMENT_ID);

      expect(paystackService.verifyTransaction).toHaveBeenCalledWith(payment.transactionId);
      expect(result.status).toBe('held');
    });

    it('returns the payment still pending if reconciliation itself fails', async () => {
      const payment = createPaymentDoc({ status: 'pending' });
      paymentModel.findById.mockResolvedValue(payment);
      paystackService.verifyTransaction.mockRejectedValue(new Error('network down'));

      const result = await service.findById(PAYMENT_ID);

      expect(result.status).toBe('pending');
    });
  });

  describe('getPaymentForActor', () => {
    it('throws ForbiddenException for a user who is not a party to the payment', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc());

      await expect(service.getPaymentForActor(PAYMENT_ID, STRANGER)).rejects.toThrow(ForbiddenException);
    });

    it('does not call Paystack for an unauthorized caller', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending' }));

      await service.getPaymentForActor(PAYMENT_ID, STRANGER).catch(() => undefined);

      expect(paystackService.verifyTransaction).not.toHaveBeenCalled();
    });

    it('returns the payment to its customer', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc());

      const result = await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(result._id).toBe(PAYMENT_ID);
    });

    it('returns the payment to its vendor', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc());

      const result = await service.getPaymentForActor(PAYMENT_ID, VENDOR);

      expect(result._id).toBe(PAYMENT_ID);
    });

    it('hides raw gateway data from a non-admin', async () => {
      paymentModel.findById.mockResolvedValue(
        createPaymentDoc({ gatewayResponse: { authorization: { last4: '4081' } } }),
      );

      const result = await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(result.gatewayResponse).toBeUndefined();
    });

    it('hides the raw Paystack refund response from a non-admin', async () => {
      paymentModel.findById.mockResolvedValue(
        createPaymentDoc({ metadata: { refundReason: 'late', refund: { transaction: {} } } }),
      );

      const result = await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(result.metadata).toEqual({ refundReason: 'late' });
    });

    it('returns raw gateway data to an admin', async () => {
      const gatewayResponse = { authorization: { last4: '4081' } };
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ gatewayResponse }));

      const result = await service.getPaymentForActor(PAYMENT_ID, ADMIN);

      expect(result.gatewayResponse).toEqual(gatewayResponse);
    });

    it('flags reconciliationPending when Paystack cannot be reached', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending' }));
      paystackService.verifyTransaction.mockRejectedValue(new Error('network down'));

      const result = await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(result.reconciliationPending).toBe(true);
    });

    it('logs a reconciliation failure as an error with the payment reference', async () => {
      const errorLog = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending', transactionId: 'ref123' }));
      paystackService.verifyTransaction.mockRejectedValue(new Error('network down'));

      await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('ref123'), expect.any(String));
    });

    it('does not flag reconciliationPending once Paystack confirms the payment', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending', amount: 150 }));
      paystackService.verifyTransaction.mockResolvedValue({ status: 'success', amount: 15000 } as any);

      const result = await service.getPaymentForActor(PAYMENT_ID, CUSTOMER);

      expect(result.reconciliationPending).toBe(false);
    });
  });

  describe('getPaymentHistory', () => {
    function givenHistoryQuery() {
      const query = { select: jest.fn().mockResolvedValue([]) };
      paymentModel.find.mockReturnValue({ sort: jest.fn().mockReturnValue(query) });
      return query;
    }

    it('filters by customerId for a student', async () => {
      givenHistoryQuery();

      await service.getPaymentHistory(CUSTOMER_ID, 'student');

      expect(paymentModel.find).toHaveBeenCalledWith({ customerId: CUSTOMER_ID });
    });

    it('filters by vendorId for a vendor', async () => {
      givenHistoryQuery();

      await service.getPaymentHistory(VENDOR_ID, 'vendor');

      expect(paymentModel.find).toHaveBeenCalledWith({ vendorId: VENDOR_ID });
    });

    it('applies no filter for an admin', async () => {
      givenHistoryQuery();

      await service.getPaymentHistory('admin-id', 'admin');

      expect(paymentModel.find).toHaveBeenCalledWith({});
    });

    it('hides raw gateway data from a non-admin', async () => {
      const query = givenHistoryQuery();

      await service.getPaymentHistory(CUSTOMER_ID, 'student');

      expect(query.select).toHaveBeenCalledWith('-gatewayResponse -metadata.refund');
    });

    it('throws ForbiddenException for a role with no payment history', async () => {
      givenHistoryQuery();

      await expect(service.getPaymentHistory('someone', 'rider')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('releasePayment', () => {
    it('splits the amount between vendor and admin commission', async () => {
      const payment = createPaymentDoc({ status: 'held', amount: 100 });
      paymentModel.findById.mockResolvedValue(payment);

      const result = await service.releasePayment(PAYMENT_ID, CUSTOMER_ID);

      expect(result.status).toBe('released');
      expect(result.adminCommission).toBeCloseTo(10);
      expect(result.vendorPayout).toBeCloseTo(90);
    });

    it('throws ForbiddenException when the actor is not the customer', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.releasePayment(PAYMENT_ID, 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not call Paystack when the actor is not the customer', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending' }));

      await service.releasePayment(PAYMENT_ID, 'someone-else').catch(() => undefined);

      expect(paystackService.verifyTransaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is not held', async () => {
      const payment = createPaymentDoc({ status: 'refunded' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.releasePayment(PAYMENT_ID, CUSTOMER_ID)).rejects.toThrow(ConflictException);
    });
  });

  describe('submitMomoOtp', () => {
    it('submits the OTP and leaves the payment pending awaiting the webhook', async () => {
      const payment = createPaymentDoc({ status: 'pending', paymentMethod: 'mobile_money' });
      paymentModel.findById.mockResolvedValue(payment);
      paystackService.submitOtp.mockResolvedValue({ status: 'send_pin' } as any);

      const result = await service.submitMomoOtp(PAYMENT_ID, '123456', CUSTOMER_ID);

      expect(result).toEqual({ status: 'send_pin' });
      expect(paystackService.submitOtp).toHaveBeenCalledWith(payment.transactionId, '123456');
      expect(payment.status).toBe('pending');
    });

    it('marks the payment failed when the OTP is rejected', async () => {
      const payment = createPaymentDoc({ status: 'pending', paymentMethod: 'mobile_money' });
      paymentModel.findById.mockResolvedValue(payment);
      paystackService.submitOtp.mockResolvedValue({ status: 'failed' } as any);

      await service.submitMomoOtp(PAYMENT_ID, '000000', CUSTOMER_ID);

      expect(payment.status).toBe('failed');
      expect(payment.save).toHaveBeenCalled();
    });

    it('throws ForbiddenException when the actor is not the paying customer', async () => {
      const payment = createPaymentDoc({ status: 'pending', paymentMethod: 'mobile_money' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.submitMomoOtp(PAYMENT_ID, '123456', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not call Paystack when the actor is not the paying customer', async () => {
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'pending', paymentMethod: 'mobile_money' }));

      await service.submitMomoOtp(PAYMENT_ID, '123456', 'someone-else').catch(() => undefined);

      expect(paystackService.verifyTransaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is not a pending mobile money charge', async () => {
      const payment = createPaymentDoc({ status: 'held', paymentMethod: 'mobile_money' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.submitMomoOtp(PAYMENT_ID, '123456', CUSTOMER_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('refundPayment', () => {
    const dto = { reason: 'item never arrived' } as any;

    beforeEach(() => {
      paystackService.refundTransaction.mockResolvedValue({ status: 'pending' } as any);
    });

    it('actually reverses the charge with Paystack before marking it refunded', async () => {
      const payment = createPaymentDoc({ status: 'held', transactionId: 'ref123' });
      paymentModel.findById.mockResolvedValue(payment);

      const result = await service.refundPayment(PAYMENT_ID, dto, CUSTOMER_ID);

      expect(paystackService.refundTransaction).toHaveBeenCalledWith('ref123');
      expect(result.status).toBe('refunded');
      expect(result.metadata?.refundReason).toBe('item never arrived');
      expect(result.metadata?.refund).toEqual({ status: 'pending' });
      expect(notificationsService.notifyAllAdmins).toHaveBeenCalledWith(
        'payment_disputed',
        expect.any(String),
        expect.stringContaining('item never arrived'),
        expect.objectContaining({ paymentId: PAYMENT_ID }),
      );
    });

    it('leaves the payment held and does not notify admins when Paystack rejects the refund', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);
      paystackService.refundTransaction.mockRejectedValue(new Error('Payment gateway error'));

      await expect(service.refundPayment(PAYMENT_ID, dto, CUSTOMER_ID)).rejects.toThrow(
        'Payment gateway error',
      );

      expect(payment.status).toBe('held');
      expect(payment.save).not.toHaveBeenCalled();
      expect(notificationsService.notifyAllAdmins).not.toHaveBeenCalled();
    });

    it('still refunds the payment when notifying admins fails', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);
      notificationsService.notifyAllAdmins.mockRejectedValueOnce(new Error('notification service down'));

      const result = await service.refundPayment(PAYMENT_ID, dto, CUSTOMER_ID);

      expect(result.status).toBe('refunded');
    });

    it('refunds a held payment when the actor is the order vendor', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);

      const result = await service.refundPayment(PAYMENT_ID, dto, VENDOR_ID);

      expect(result.status).toBe('refunded');
    });

    it('throws ForbiddenException when the actor is neither the customer nor the vendor', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.refundPayment(PAYMENT_ID, dto, 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
      expect(paystackService.refundTransaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the payment is not held', async () => {
      const payment = createPaymentDoc({ status: 'released' });
      paymentModel.findById.mockResolvedValue(payment);

      await expect(service.refundPayment(PAYMENT_ID, dto, CUSTOMER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(paystackService.refundTransaction).not.toHaveBeenCalled();
    });
  });

  describe('refundPaymentForCancelledOrder', () => {
    const dto = { reason: 'changed my mind' } as any;

    beforeEach(() => {
      paystackService.refundTransaction.mockResolvedValue({ status: 'pending' } as any);
      paymentModel.findById.mockResolvedValue(createPaymentDoc({ status: 'held', transactionId: 'ref123' }));
    });

    it('throws ConflictException while the order is still active', async () => {
      orderModel.findById.mockResolvedValue({ status: 'out_for_delivery' });

      await expect(service.refundPaymentForCancelledOrder(PAYMENT_ID, dto, CUSTOMER_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not call Paystack while the order is still active', async () => {
      orderModel.findById.mockResolvedValue({ status: 'accepted' });

      await service.refundPaymentForCancelledOrder(PAYMENT_ID, dto, CUSTOMER_ID).catch(() => undefined);

      expect(paystackService.refundTransaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the order no longer exists', async () => {
      orderModel.findById.mockResolvedValue(null);

      await expect(service.refundPaymentForCancelledOrder(PAYMENT_ID, dto, CUSTOMER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for someone who is not a party to the payment', async () => {
      orderModel.findById.mockResolvedValue({ status: 'cancelled' });

      await expect(service.refundPaymentForCancelledOrder(PAYMENT_ID, dto, 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refunds the held payment of a cancelled order', async () => {
      orderModel.findById.mockResolvedValue({ status: 'cancelled' });

      const result = await service.refundPaymentForCancelledOrder(PAYMENT_ID, dto, CUSTOMER_ID);

      expect(result.status).toBe('refunded');
    });
  });

  describe('updatePaymentStatus', () => {
    it('updates the status and persists it', async () => {
      const payment = createPaymentDoc({ status: 'held' });
      paymentModel.findById.mockResolvedValue(payment);

      const result = await service.updatePaymentStatus(PAYMENT_ID, { status: 'failed' } as any);

      expect(result.status).toBe('failed');
      expect(payment.save).toHaveBeenCalled();
    });
  });
});
