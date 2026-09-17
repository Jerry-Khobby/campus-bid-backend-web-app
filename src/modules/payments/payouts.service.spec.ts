import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { Payment } from './schema/payment.schema';
import { Payout } from './schema/payout.schema';
import { Vendor } from '../vendors/schema/vendor.schema';

const VENDOR_ID = '507f1f77bcf86cd799439012';

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

  beforeEach(async () => {
    paymentModel = {
      aggregate: jest.fn(),
      find: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    payoutModel = {
      create: jest.fn(),
      find: jest.fn(),
    };
    vendorModel = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Payout.name), useValue: payoutModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
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
    it('throws BadRequestException when there is no available balance', async () => {
      paymentModel.find.mockResolvedValue([]);

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the vendor cannot be found', async () => {
      paymentModel.find.mockResolvedValue([{ _id: 'p1', vendorPayout: 90 }]);
      vendorModel.findById.mockResolvedValue(null);

      await expect(service.requestPayout(VENDOR_ID)).rejects.toThrow(NotFoundException);
    });

    it('creates a payout snapshotting bank details and claims the released payments', async () => {
      const releasedPayments = [
        { _id: 'p1', vendorPayout: 90 },
        { _id: 'p2', vendorPayout: 45 },
      ];
      paymentModel.find.mockResolvedValue(releasedPayments);
      vendorModel.findById.mockResolvedValue({ bankDetails: { bankName: 'Test Bank' } });
      const createdPayout = { _id: 'payout1', amount: 135 };
      payoutModel.create.mockResolvedValue(createdPayout);

      const result = await service.requestPayout(VENDOR_ID);

      expect(result).toBe(createdPayout);
      expect(payoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 135,
          paymentIds: ['p1', 'p2'],
          bankSnapshot: { bankName: 'Test Bank' },
        }),
      );
      expect(paymentModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['p1', 'p2'] }, payoutId: null },
        { payoutId: 'payout1' },
      );
    });
  });

  describe('listPayouts', () => {
    it('returns payouts sorted by most recent', async () => {
      payoutModel.find.mockReturnValue(withSort([{ _id: 'payout1' }]));

      const result = await service.listPayouts(VENDOR_ID);

      expect(result).toEqual([{ _id: 'payout1' }]);
    });
  });
});
