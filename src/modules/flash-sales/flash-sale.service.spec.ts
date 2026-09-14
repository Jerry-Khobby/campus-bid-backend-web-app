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
import { FlashSaleStatus } from './dto/enums';

describe('FlashSaleService', () => {
  let service: FlashSaleService;
  let flashSaleModel: any;
  let cacheManager: any;
  let notificationsService: any;

  const vendorId = new Types.ObjectId().toString();
  const saleId = new Types.ObjectId().toString();
  const bidderId = new Types.ObjectId().toString();
  const previousBidderId = new Types.ObjectId().toString();

  const buildSale = (overrides: Record<string, any> = {}) => ({
    _id: saleId,
    vendorId: { toString: () => vendorId },
    status: FlashSaleStatus.ACTIVE,
    currentBid: 100,
    startingBid: 50,
    minimumBidIncrement: 10,
    currentBidder: undefined,
    bids: [],
    productId: { name: 'Cool Product' },
    toObject: jest.fn().mockReturnValue({ _id: saleId, status: FlashSaleStatus.ACTIVE }),
    save: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    flashSaleModel = {
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    notificationsService = { notify: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlashSaleService,
        { provide: getModelToken(FlashSale.name), useValue: flashSaleModel },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: NotificationsGateway, useValue: {} },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<FlashSaleService>(FlashSaleService);
  });

  describe('placeBid', () => {
    it('places a bid and stores the new bidder', async () => {
      const sale = buildSale();
      sale.save.mockResolvedValue(sale);
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      const result = await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(result.currentBid).toBe(150);
    });

    it('notifies the previous bidder when they are outbid', async () => {
      const sale = buildSale({ currentBidder: { toString: () => previousBidderId } });
      sale.save.mockResolvedValue(sale);
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

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
      const sale = buildSale({ currentBidder: { toString: () => bidderId } });
      sale.save.mockResolvedValue(sale);
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      await service.placeBid(saleId, bidderId, { amount: 150 });

      expect(notificationsService.notify).not.toHaveBeenCalled();
    });

    it('rejects a bid below the minimum increment', async () => {
      const sale = buildSale();
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      await expect(service.placeBid(saleId, bidderId, { amount: 105 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects bidding on a sale that is not active', async () => {
      const sale = buildSale({ status: FlashSaleStatus.UPCOMING });
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(sale) });

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a bid while another bid is being processed', async () => {
      cacheManager.get.mockResolvedValue('locked');

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects bidding on a flash sale that does not exist', async () => {
      flashSaleModel.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });

      await expect(service.placeBid(saleId, bidderId, { amount: 150 })).rejects.toThrow(
        NotFoundException,
      );
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
        exec: jest.fn().mockResolvedValue([buildSale()]),
      });
      flashSaleModel.countDocuments.mockResolvedValue(1);

      const result = await service.getVendorFlashSales(vendorId, { status: FlashSaleStatus.ACTIVE });

      expect(result).toEqual({ items: [expect.any(Object)], total: 1, page: 1, limit: 10 });
    });
  });
});
