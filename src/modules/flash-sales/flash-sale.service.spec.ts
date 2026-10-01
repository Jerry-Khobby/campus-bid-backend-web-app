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

import { FlashSaleService } from './flash-sale.service';
import { FlashSale } from './schema/flash-sale.schema';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';
import { FlashSaleReason, FlashSaleStatus } from './dto/enums';

const ONE_HOUR_MS = 60 * 60 * 1000;
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

describe('FlashSaleService', () => {
  let service: FlashSaleService;
  let flashSaleModel: any;
  let cacheManager: any;
  let notificationsService: any;
  let productsService: { assertVendorOwnsProduct: jest.Mock };

  const vendorId = new Types.ObjectId().toString();
  const saleId = new Types.ObjectId().toString();
  const bidderId = new Types.ObjectId().toString();
  const previousBidderId = new Types.ObjectId().toString();

  const hoursFromNow = (hours: number) => new Date(Date.now() + hours * ONE_HOUR_MS);

  const buildSale = (overrides: Record<string, any> = {}) => ({
    _id: saleId,
    vendorId: { toString: () => vendorId },
    status: FlashSaleStatus.ACTIVE,
    currentBid: 100,
    startingBid: 50,
    minimumBidIncrement: 10,
    currentBidder: undefined,
    startTime: hoursFromNow(-1),
    endTime: hoursFromNow(1),
    bids: [],
    productId: { name: 'Cool Product' },
    toObject: jest.fn().mockReturnValue({ _id: saleId, status: FlashSaleStatus.ACTIVE }),
    save: jest.fn(),
    ...overrides,
  });

  const mockBidWrite = (saleBeforeBid: any) =>
    flashSaleModel.findOneAndUpdate.mockReturnValue({
      populate: jest.fn().mockResolvedValue(saleBeforeBid),
    });

  beforeEach(async () => {
    flashSaleModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue({ ...doc, _id: saleId }),
    }));
    flashSaleModel.findById = jest.fn();
    flashSaleModel.find = jest.fn();
    flashSaleModel.findOneAndUpdate = jest.fn();
    flashSaleModel.updateMany = jest.fn();
    flashSaleModel.countDocuments = jest.fn();
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    notificationsService = { notify: jest.fn().mockResolvedValue({}) };
    productsService = { assertVendorOwnsProduct: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlashSaleService,
        { provide: getModelToken(FlashSale.name), useValue: flashSaleModel },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: NotificationsGateway, useValue: {} },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: ProductsService, useValue: productsService },
      ],
    }).compile();

    service = module.get<FlashSaleService>(FlashSaleService);
  });

  describe('scheduled jobs', () => {
    it('schedules the auto-start job', () => {
      const cron = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, service.autoStartFlashSalesJob);

      expect(cron).toBeDefined();
    });

    it('schedules the auto-end job', () => {
      const cron = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, service.autoEndFlashSalesJob);

      expect(cron).toBeDefined();
    });
  });

  describe('createFlashSale', () => {
    const baseDto = {
      productId: new Types.ObjectId() as any,
      originalPrice: 100,
      startingBid: 50,
    };

    it('creates an upcoming sale with a valid schedule', async () => {
      const result = await service.createFlashSale(vendorId, {
        ...baseDto,
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(2),
      });

      expect(result.status).toBe(FlashSaleStatus.UPCOMING);
    });

    it('rejects a sale whose start is not before its end', async () => {
      await expect(
        service.createFlashSale(vendorId, { ...baseDto, startTime: hoursFromNow(2), endTime: hoursFromNow(1) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a sale for a product the vendor does not own', async () => {
      productsService.assertVendorOwnsProduct.mockRejectedValue(new ForbiddenException());

      await expect(
        service.createFlashSale(vendorId, { ...baseDto, startTime: hoursFromNow(1), endTime: hoursFromNow(2) }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a sale whose end is already in the past', async () => {
      await expect(
        service.createFlashSale(vendorId, { ...baseDto, startTime: hoursFromNow(-2), endTime: hoursFromNow(-1) }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateFlashSale', () => {
    it('updates an upcoming sale owned by the requesting vendor', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.UPCOMING }));
      flashSaleModel.findOneAndUpdate.mockResolvedValue({ _id: saleId, startingBid: 75 });

      const result = await service.updateFlashSale(saleId, vendorId, { startingBid: 75 });

      expect(result.startingBid).toBe(75);
    });

    it('only writes while the sale is still upcoming', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.UPCOMING }));
      flashSaleModel.findOneAndUpdate.mockResolvedValue({ _id: saleId });

      await service.updateFlashSale(saleId, vendorId, { startingBid: 75 });

      expect(flashSaleModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: saleId, status: FlashSaleStatus.UPCOMING },
        { $set: { startingBid: 75 } },
        { new: true },
      );
    });

    it('rejects an update by a vendor who does not own the sale', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.UPCOMING }));

      await expect(service.updateFlashSale(saleId, 'someone-else', { startingBid: 75 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects editing a sale that is no longer upcoming', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.ACTIVE }));

      await expect(service.updateFlashSale(saleId, vendorId, { startingBid: 75 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a new end time that falls before the existing start time', async () => {
      flashSaleModel.findById.mockResolvedValue(
        buildSale({ status: FlashSaleStatus.UPCOMING, startTime: hoursFromNow(3), endTime: hoursFromNow(4) }),
      );

      await expect(service.updateFlashSale(saleId, vendorId, { endTime: hoursFromNow(2) })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects the update when the sale starts between the read and the write', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.UPCOMING }));
      flashSaleModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.updateFlashSale(saleId, vendorId, { startingBid: 75 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects updating a flash sale that does not exist', async () => {
      flashSaleModel.findById.mockResolvedValue(null);

      await expect(service.updateFlashSale(saleId, vendorId, { startingBid: 75 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('placeBid', () => {
    it('places a bid and stores the new bidder', async () => {
      const sale = buildSale();
      flashSaleModel.findById.mockResolvedValue(sale);
      mockBidWrite(buildSale());

      const result = await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(result.currentBid).toBe(150);
    });

    it('writes the bid with a single conditional update guarded by status, window and minimum', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());
      mockBidWrite(buildSale());

      await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(flashSaleModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: saleId,
          status: FlashSaleStatus.ACTIVE,
          startTime: { $lte: expect.any(Date) },
          endTime: { $gt: expect.any(Date) },
          $expr: { $lte: [expect.any(Object), 150] },
        }),
        expect.objectContaining({ $set: { currentBid: 150, currentBidder: expect.any(Types.ObjectId) } }),
        { new: false },
      );
    });

    it('rejects the bid when a concurrent higher bid wins the conditional update', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());
      mockBidWrite(null);

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(ConflictException);
    });

    it('notifies the bidder that this bid displaced', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());
      mockBidWrite(buildSale({ currentBidder: { toString: () => previousBidderId } }));

      await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(notificationsService.notify).toHaveBeenCalledWith(
        previousBidderId,
        'customer',
        'flash_sale_alert',
        'Outbid!',
        expect.stringContaining('Cool Product'),
        expect.objectContaining({ flashSaleId: saleId, currentBid: 150, yourBid: 100 }),
      );
    });

    it('does not notify when the same user raises their own bid', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());
      mockBidWrite(buildSale({ currentBidder: { toString: () => bidderId } }));

      await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('evicts the cached sale after a bid', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());
      mockBidWrite(buildSale());

      await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(cacheManager.del).toHaveBeenCalledWith(`flash-sale:${saleId}`);
    });

    it('rejects a bid below the minimum increment', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale());

      await expect(service.placeBid(saleId, bidderId, { amount: 105 })).rejects.toThrow(BadRequestException);
    });

    it('uses the starting bid as the floor when there is no bid yet', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ currentBid: undefined }));

      await expect(service.placeBid(saleId, bidderId, { amount: 55 })).rejects.toThrow(BadRequestException);
    });

    it('rejects bidding on a sale that is not active', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ status: FlashSaleStatus.UPCOMING }));

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(BadRequestException);
    });

    it('rejects a bid placed before the start time even when the status says active', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ startTime: hoursFromNow(1), endTime: hoursFromNow(2) }));

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(BadRequestException);
    });

    it('rejects a bid placed after the end time even when the status is still active', async () => {
      flashSaleModel.findById.mockResolvedValue(buildSale({ startTime: hoursFromNow(-2), endTime: hoursFromNow(-1) }));

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(BadRequestException);
    });

    it('rejects bidding on a flash sale that does not exist', async () => {
      flashSaleModel.findById.mockResolvedValue(null);

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelFlashSale', () => {
    it('cancels a sale owned by the requesting vendor', async () => {
      const sale = buildSale();
      sale.save.mockResolvedValue(sale);
      flashSaleModel.findById.mockResolvedValue(sale);

      const result = await service.cancelFlashSale(saleId, vendorId, {
        reason: 'expiring_stock' as any,
      });

      expect(result.status).toBe(FlashSaleStatus.CANCELLED);
    });

    it('rejects cancellation by a vendor who does not own the sale', async () => {
      const sale = buildSale();
      flashSaleModel.findById.mockResolvedValue(sale);

      await expect(
        service.cancelFlashSale(saleId, 'someone-else', { reason: 'expiring_stock' as any }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects cancelling an already completed sale', async () => {
      const sale = buildSale({ status: FlashSaleStatus.COMPLETED });
      flashSaleModel.findById.mockResolvedValue(sale);

      await expect(
        service.cancelFlashSale(saleId, vendorId, { reason: 'expiring_stock' as any }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('completeFlashSale', () => {
    it('marks the sale completed and notifies the winner', async () => {
      const sale = buildSale();
      sale.save.mockResolvedValue(sale);
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      const result = await service.completeFlashSale(vendorId, {
        flashSaleId: saleId as any,
        winner: bidderId as any,
        finalBid: 200,
      });

      expect(result.status).toBe(FlashSaleStatus.COMPLETED);
      expect(notificationsService.notify).toHaveBeenCalledWith(
        bidderId,
        'customer',
        'flash_sale_won',
        'You won!',
        expect.any(String),
        expect.objectContaining({ flashSaleId: saleId, winningBid: 200 }),
      );
    });

    it('rejects completing a sale twice', async () => {
      const sale = buildSale({ status: FlashSaleStatus.COMPLETED });
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      await expect(
        service.completeFlashSale(vendorId, {
          flashSaleId: saleId as any,
          winner: bidderId as any,
          finalBid: 200,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('autoStartFlashSales', () => {
    const mockDueSales = (sales: any[]) =>
      flashSaleModel.find.mockReturnValue({ select: jest.fn().mockResolvedValue(sales) });

    it('activates upcoming sales whose start time has passed', async () => {
      mockDueSales([{ _id: new Types.ObjectId(saleId) }]);
      flashSaleModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const count = await service.autoStartFlashSales();

      expect(count).toBe(1);
    });

    it('only activates sales that are still upcoming at write time', async () => {
      mockDueSales([{ _id: new Types.ObjectId(saleId) }]);
      flashSaleModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      await service.autoStartFlashSales();

      expect(flashSaleModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [expect.any(Types.ObjectId)] }, status: FlashSaleStatus.UPCOMING },
        { $set: { status: FlashSaleStatus.ACTIVE } },
      );
    });

    it('skips the write when no sale is due', async () => {
      mockDueSales([]);

      await service.autoStartFlashSales();

      expect(flashSaleModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('autoEndExpiredSales', () => {
    it('completes an expired sale with the highest bidder as winner', async () => {
      const highestBidder = new Types.ObjectId(bidderId);
      flashSaleModel.find.mockResolvedValue([buildSale({ currentBidder: highestBidder })]);
      flashSaleModel.findOneAndUpdate.mockResolvedValue(buildSale({ winner: highestBidder }));

      await service.autoEndExpiredSales();

      expect(flashSaleModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: saleId, status: FlashSaleStatus.ACTIVE },
        {
          $set: {
            status: FlashSaleStatus.COMPLETED,
            reason: FlashSaleReason.CLOSING_TIME,
            winner: highestBidder,
          },
        },
        { new: true },
      );
    });

    it('notifies the winner of an auto-ended sale', async () => {
      const highestBidder = new Types.ObjectId(bidderId);
      flashSaleModel.find.mockResolvedValue([buildSale({ currentBidder: highestBidder })]);
      flashSaleModel.findOneAndUpdate.mockResolvedValue(buildSale({ winner: highestBidder }));

      await service.autoEndExpiredSales();

      expect(notificationsService.notify).toHaveBeenCalledWith(
        bidderId,
        'customer',
        'flash_sale_won',
        'You won!',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('does not count a sale that another run already ended', async () => {
      flashSaleModel.find.mockResolvedValue([buildSale()]);
      flashSaleModel.findOneAndUpdate.mockResolvedValue(null);

      const count = await service.autoEndExpiredSales();

      expect(count).toBe(0);
    });
  });

  describe('getMyBids', () => {
    it('classifies an active sale the user bid on as active', async () => {
      const sale = buildSale();
      sale.toObject.mockReturnValue({ _id: saleId, status: FlashSaleStatus.ACTIVE });
      flashSaleModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sale]),
      });

      const result = await service.getMyBids(bidderId);

      expect(result[0].bidStatus).toBe('active');
    });

    it('classifies a completed sale won by the user as won', async () => {
      const sale = buildSale({ status: FlashSaleStatus.COMPLETED, winner: { toString: () => bidderId } });
      sale.toObject.mockReturnValue({ _id: saleId, status: FlashSaleStatus.COMPLETED });
      flashSaleModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sale]),
      });

      const result = await service.getMyBids(bidderId);

      expect(result[0].bidStatus).toBe('won');
    });

    it('filters results down to the requested status', async () => {
      const activeSale = buildSale();
      const wonSale = buildSale({ status: FlashSaleStatus.COMPLETED, winner: { toString: () => bidderId } });
      flashSaleModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([activeSale, wonSale]),
      });

      const result = await service.getMyBids(bidderId, 'won');

      expect(result).toHaveLength(1);
    });
  });

  describe('getVendorFlashSales', () => {
    it('paginates a vendor\'s flash sales', async () => {
      flashSaleModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([buildSale()]),
      });
      flashSaleModel.countDocuments.mockResolvedValue(1);

      const result = await service.getVendorFlashSales(vendorId, { status: FlashSaleStatus.ACTIVE });

      expect(result).toEqual({ items: [expect.any(Object)], total: 1, page: 1, limit: 10 });
    });
  });
});
