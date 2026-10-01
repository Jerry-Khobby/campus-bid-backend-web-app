import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PaystackService } from './paystack.service';
import { Payment } from './schema/payment.schema';
import { Payout } from './schema/payout.schema';
import { Vendor } from '../vendors/schema/vendor.schema';

const VENDOR_ID = '507f1f77bcf86cd799439012';
const PAYOUT_ID = '507f1f77bcf86cd799439099';
const ADMIN_ID = '507f1f77bcf86cd799439088';

function createPayoutDoc(overrides: Record<string, any> = {}) {
  const doc: any = {
    _id: PAYOUT_ID,
    vendorId: { toString: () => VENDOR_ID },
    amount: 100,
    paymentIds: ['p1', 'p2'],
    status: 'requested',
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

function withSort<T>(docs: T[]) {
  const result: any = [...docs];
  result.sort = jest.fn().mockResolvedValue(docs);
  return result;
}

function withSortAndPopulate<T>(docs: T[]) {
  const result: any = [...docs];
  result.sort = jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue(docs) });
  return result;
}

describe('PayoutsService', () => {
  let service: PayoutsService;
  let paymentModel: any;
  let payoutModel: any;
  let vendorModel: any;
  let paystackService: jest.Mocked<PaystackService>;

  beforeEach(async () => {
    paymentModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    payoutModel = {
      create: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({}),
      exists: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    vendorModel = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Payout.name), useValue: payoutModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        {
          provide: PaystackService,
          useValue: {
            createTransferRecipient: jest.fn(),
            initiateTransfer: jest.fn(),
            verifyTransfer: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
    paystackService = module.get(PaystackService);
  });

  describe('getVendorBalances', () => {
    it('sums held payments as pending and released/unclaimed payments as available', async () => {
      paymentModel.aggregate.mockImplementation((pipeline: any[]) => {
        const { status } = pipeline[0].$match;
        if (status === 'held') return Promise.resolve([{ _id: null, total: 300 }]);
        if (status === 'released') return Promise.resolve([{ _id: null, total: 150 }]);
        return Promise.resolve([]);
      });

      const result = await service.getVendorBalances(VENDOR_ID);

      expect(result).toEqual({ pendingBalance: 300, availableBalance: 150 });
    });

    it('returns zero balances when there are no matching payments', async () => {
      paymentModel.aggregate.mockResolvedValue([]);

      const result = await service.getVendorBalances(VENDOR_ID);

      expect(result).toEqual({ pendingBalance: 0, availableBalance: 0 });
    });
  });

  describe('getHeldPayments', () => {
    it('returns the held payments and their total', async () => {
      paymentModel.find.mockReturnValue(withSortAndPopulate([{ amount: 40 }, { amount: 60 }]));

      const result = await service.getHeldPayments(VENDOR_ID);

      expect(result.totalHeld).toBe(100);
      expect(result.payments).toHaveLength(2);
    });
  });

  describe('requestPayout', () => {
    const VENDOR_WITH_BANK = { bankDetails: { bankName: 'Test Bank' } };

    function givenNewPayout() {
      const payout = createPayoutDoc({ amount: 0, paymentIds: [] });
      vendorModel.findById.mockResolvedValue(VENDOR_WITH_BANK);
      payoutModel.exists.mockResolvedValue(null);
      payoutModel.create.mockResolvedValue(payout);
      return payout;
    }

    it('throws NotFoundException when the vendor cannot be found', async () => {
      vendorModel.findById.mockResolvedValue(null);

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the vendor already has an open payout', async () => {
      vendorModel.findById.mockResolvedValue(VENDOR_WITH_BANK);
      payoutModel.exists.mockResolvedValue({ _id: 'open-payout' });

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when a concurrent request wins the unique open-payout index', async () => {
      vendorModel.findById.mockResolvedValue(VENDOR_WITH_BANK);
      payoutModel.exists.mockResolvedValue(null);
      payoutModel.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(ConflictException);
    });

    it('claims released payments with the new payout id before summing them', async () => {
      givenNewPayout();
      paymentModel.find.mockResolvedValue([{ _id: 'p1', vendorPayout: 90 }]);

      await service.requestPayout(VENDOR_ID);

      expect(paymentModel.updateMany).toHaveBeenCalledWith(
        { vendorId: expect.anything(), status: 'released', payoutId: null },
        { payoutId: PAYOUT_ID },
      );
    });

    it('computes the amount only from the payments this request claimed', async () => {
      givenNewPayout();
      paymentModel.find.mockResolvedValue([
        { _id: 'p1', vendorPayout: 90 },
        { _id: 'p2', vendorPayout: 45 },
      ]);

      const result = await service.requestPayout(VENDOR_ID);

      expect(result).toEqual(expect.objectContaining({ amount: 135, paymentIds: ['p1', 'p2'] }));
    });

    it('throws BadRequestException when no payments were claimed', async () => {
      givenNewPayout();
      paymentModel.find.mockResolvedValue([]);

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(BadRequestException);
    });

    it('deletes the empty payout when no payments were claimed', async () => {
      givenNewPayout();
      paymentModel.find.mockResolvedValue([]);

      await service.requestPayout(VENDOR_ID).catch(() => undefined);

      expect(payoutModel.deleteOne).toHaveBeenCalledWith({ _id: PAYOUT_ID });
    });
  });

  describe('listPayouts', () => {
    it('returns payouts sorted by most recent', async () => {
      payoutModel.find.mockReturnValue(withSort([{ _id: 'payout1' }]));

      const result = await service.listPayouts(VENDOR_ID);

      expect(result).toEqual([{ _id: 'payout1' }]);
    });
  });

  describe('listAllPayouts', () => {
    it('reconciles any still-processing payout against Paystack before returning', async () => {
      const processing = createPayoutDoc({ status: 'processing', transferReference: 'ref1' });
      const completed = createPayoutDoc({ status: 'completed' });
      payoutModel.find.mockReturnValue(withSortAndPopulate([processing, completed]));
      paystackService.verifyTransfer.mockResolvedValue({ status: 'success' } as any);

      const result = await service.listAllPayouts();

      expect(paystackService.verifyTransfer).toHaveBeenCalledWith('ref1');
      expect(processing.status).toBe('completed');
      expect(result).toEqual([processing, completed]);
    });

    it('filters by status when given', async () => {
      payoutModel.find.mockReturnValue(withSortAndPopulate([]));

      await service.listAllPayouts('requested');

      expect(payoutModel.find).toHaveBeenCalledWith({ status: 'requested' });
    });
  });

  describe('approvePayout', () => {
    it('throws ConflictException when the payout is not awaiting approval', async () => {
      payoutModel.findById.mockResolvedValue(createPayoutDoc());
      payoutModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.approvePayout(PAYOUT_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException and reverts the claim when the vendor has no payout details', async () => {
      const claimed = createPayoutDoc({ status: 'processing', transferReference: 'ref1' });
      payoutModel.findById.mockResolvedValue(createPayoutDoc());
      payoutModel.findOneAndUpdate.mockResolvedValue(claimed);
      vendorModel.findById.mockResolvedValue({ bankDetails: {} });

      await expect(service.approvePayout(PAYOUT_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);

      expect(claimed.status).toBe('requested');
      expect(claimed.failureReason).toBeTruthy();
      expect(paystackService.createTransferRecipient).not.toHaveBeenCalled();
    });

    it('creates a recipient and sends the transfer for a vendor with valid payout details', async () => {
      const claimed = createPayoutDoc({ status: 'processing', transferReference: 'ref1', amount: 90 });
      payoutModel.findById.mockResolvedValue(createPayoutDoc());
      payoutModel.findOneAndUpdate.mockResolvedValue(claimed);
      vendorModel.findById.mockResolvedValue({
        bankDetails: { accountName: 'Jane Vendor', accountNumber: '0551234987', momoProvider: 'mtn' },
      });
      paystackService.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_1' } as any);
      paystackService.initiateTransfer.mockResolvedValue({
        status: 'pending',
        transfer_code: 'TRF_1',
        reference: 'ref1',
      } as any);

      const result = await service.approvePayout(PAYOUT_ID, ADMIN_ID);

      expect(paystackService.createTransferRecipient).toHaveBeenCalledWith('Jane Vendor', '0551234987', 'mtn');
      expect(paystackService.initiateTransfer).toHaveBeenCalledWith('RCP_1', 9000, 'ref1', expect.any(String));
      expect(result.recipientCode).toBe('RCP_1');
      expect(result.transferCode).toBe('TRF_1');
      expect(result.status).toBe('processing');
    });

    it('marks the payout completed immediately when Paystack confirms success right away', async () => {
      const claimed = createPayoutDoc({ status: 'processing', transferReference: 'ref1' });
      payoutModel.findById.mockResolvedValue(createPayoutDoc());
      payoutModel.findOneAndUpdate.mockResolvedValue(claimed);
      vendorModel.findById.mockResolvedValue({
        bankDetails: { accountName: 'Jane Vendor', accountNumber: '0551234987', momoProvider: 'mtn' },
      });
      paystackService.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_1' } as any);
      paystackService.initiateTransfer.mockResolvedValue({ status: 'success', transfer_code: 'TRF_1' } as any);

      const result = await service.approvePayout(PAYOUT_ID, ADMIN_ID);

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('reverts to requested and records the failure reason when Paystack rejects the transfer', async () => {
      const claimed = createPayoutDoc({ status: 'processing', transferReference: 'ref1' });
      payoutModel.findById.mockResolvedValue(createPayoutDoc());
      payoutModel.findOneAndUpdate.mockResolvedValue(claimed);
      vendorModel.findById.mockResolvedValue({
        bankDetails: { accountName: 'Jane Vendor', accountNumber: '0551234987', momoProvider: 'mtn' },
      });
      paystackService.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_1' } as any);
      paystackService.initiateTransfer.mockRejectedValue(new Error('Insufficient balance'));

      await expect(service.approvePayout(PAYOUT_ID, ADMIN_ID)).rejects.toThrow('Insufficient balance');

      expect(claimed.status).toBe('requested');
      expect(claimed.failureReason).toBe('Insufficient balance');
    });

    it('reuses the same transferReference on a retry after a reverted attempt', async () => {
      const existing = createPayoutDoc({ status: 'requested', transferReference: 'payout_existing_ref' });
      const claimed = createPayoutDoc({ status: 'processing', transferReference: 'payout_existing_ref' });
      payoutModel.findById.mockResolvedValue(existing);
      payoutModel.findOneAndUpdate.mockResolvedValue(claimed);
      vendorModel.findById.mockResolvedValue({
        bankDetails: { accountName: 'Jane Vendor', accountNumber: '0551234987', momoProvider: 'mtn' },
      });
      paystackService.createTransferRecipient.mockResolvedValue({ recipient_code: 'RCP_1' } as any);
      paystackService.initiateTransfer.mockResolvedValue({ status: 'pending', transfer_code: 'TRF_1' } as any);

      await service.approvePayout(PAYOUT_ID, ADMIN_ID);

      expect(payoutModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: PAYOUT_ID, status: 'requested', amount: { $gt: 0 } },
        { status: 'processing', transferReference: 'payout_existing_ref' },
        { new: true },
      );
      expect(paystackService.initiateTransfer).toHaveBeenCalledWith(
        'RCP_1',
        expect.any(Number),
        'payout_existing_ref',
        expect.any(String),
      );
    });
  });

  describe('rejectPayout', () => {
    it('throws ConflictException when the payout is not awaiting approval', async () => {
      payoutModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.rejectPayout(PAYOUT_ID, ADMIN_ID, 'suspicious')).rejects.toThrow(ConflictException);
      expect(paymentModel.updateMany).not.toHaveBeenCalled();
    });

    it('marks the payout failed and releases its claimed payments back for retry', async () => {
      const rejected = createPayoutDoc({ status: 'failed', paymentIds: ['p1', 'p2'] });
      payoutModel.findOneAndUpdate.mockResolvedValue(rejected);

      const result = await service.rejectPayout(PAYOUT_ID, ADMIN_ID, 'bad bank details');

      expect(result).toBe(rejected);
      expect(paymentModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['p1', 'p2'] }, payoutId: PAYOUT_ID },
        { payoutId: null },
      );
    });
  });

  describe('reconcilePayoutByReference', () => {
    it('does nothing when no payout matches the reference', async () => {
      payoutModel.findOne.mockResolvedValue(null);

      await service.reconcilePayoutByReference('unknown-ref');

      expect(paystackService.verifyTransfer).not.toHaveBeenCalled();
    });

    it('marks the payout failed and releases its payments when Paystack reports the transfer reversed', async () => {
      const payout = createPayoutDoc({ status: 'processing', transferReference: 'ref1', paymentIds: ['p1'] });
      payoutModel.findOne.mockResolvedValue(payout);
      paystackService.verifyTransfer.mockResolvedValue({ status: 'reversed' } as any);

      await service.reconcilePayoutByReference('ref1');

      expect(payout.status).toBe('failed');
      expect(paymentModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['p1'] }, payoutId: PAYOUT_ID },
        { payoutId: null },
      );
    });

    it('does nothing for a payout that is not currently processing', async () => {
      const payout = createPayoutDoc({ status: 'completed', transferReference: 'ref1' });
      payoutModel.findOne.mockResolvedValue(payout);

      await service.reconcilePayoutByReference('ref1');

      expect(paystackService.verifyTransfer).not.toHaveBeenCalled();
    });
  });
});
