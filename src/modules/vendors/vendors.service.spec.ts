import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

import { VendorService } from './vendors.service';
import { Vendor } from './schema/vendor.schema';
import { Product } from '../products/schema/product.schema';
import { Order } from '../orders/schema/order.schema';
import { MailService } from 'src/utils/mail.service';
import { CloudinaryService } from '../uploads/cloudinary.service';
import { ProductsService } from '../products/products.service';
import { FlashSaleService } from '../flash-sales/flash-sale.service';
import { PayoutsService } from '../payments/payouts.service';

describe('VendorService', () => {
  let service: VendorService;
  let vendorModel: any;
  let productModel: any;
  let orderModel: any;
  let cacheManager: any;
  let payoutsService: any;
  let flashSaleService: any;

  const vendorId = new Types.ObjectId().toString();

  const buildVendorDoc = (overrides: Record<string, any> = {}) => ({
    _id: { toString: () => vendorId },
    email: 'vendor@test.com',
    profile: { businessName: 'Old Name', logo: 'old-logo.png' },
    save: jest.fn(),
    toObject: jest.fn().mockReturnValue({
      _id: vendorId,
      email: 'vendor@test.com',
      profile: { businessName: 'Old Name' },
    }),
    ...overrides,
  });

  const buildPublicVendor = (overrides: Record<string, any> = {}) => ({
    _id: vendorId,
    profile: { businessName: 'Test Vendor', logo: 'logo.png' },
    categories: ['food'],
    rating: { average: 4.5, count: 10 },
    stats: { totalOrders: 12 },
    location: { type: 'Point', coordinates: [0, 0] },
    businessHours: [],
    isVerified: true,
    isActive: true,
    ...overrides,
  });

  beforeEach(async () => {
    vendorModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };
    productModel = { countDocuments: jest.fn(), find: jest.fn() };
    orderModel = { aggregate: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    payoutsService = { getVendorBalances: jest.fn() };
    flashSaleService = { getVendorFlashSales: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorService,
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: MailService, useValue: { sendEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CloudinaryService, useValue: { uploadImage: jest.fn() } },
        { provide: ProductsService, useValue: { listProducts: jest.fn() } },
        { provide: FlashSaleService, useValue: flashSaleService },
        { provide: PayoutsService, useValue: payoutsService },
      ],
    }).compile();

    service = module.get<VendorService>(VendorService);
  });

  describe('updateProfile', () => {
    it('merges the dto into the profile without touching file uploads', async () => {
      const vendor = buildVendorDoc();
      vendor.save.mockResolvedValue(vendor);
      vendorModel.findById.mockResolvedValue(vendor);

      await service.updateProfile(vendorId, { businessName: 'New Name' } as any);

      expect(vendor.profile.businessName).toBe('New Name');
    });

    it('throws NotFoundException when the vendor does not exist', async () => {
      vendorModel.findById.mockResolvedValue(null);

      await expect(service.updateProfile(vendorId, {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLogo', () => {
    it('replaces the profile logo with the uploaded url', async () => {
      const vendor = buildVendorDoc();
      vendor.save.mockResolvedValue(vendor);
      vendorModel.findById.mockResolvedValue(vendor);

      const result = await service.updateLogo(vendorId, 'https://cdn.test/logo.png');

      expect(result).toEqual({ logo: 'https://cdn.test/logo.png' });
      expect(vendor.profile.logo).toBe('https://cdn.test/logo.png');
    });
  });

  describe('updateBanner', () => {
    it('replaces the profile banner with the uploaded url', async () => {
      const vendor = buildVendorDoc();
      vendor.save.mockResolvedValue(vendor);
      vendorModel.findById.mockResolvedValue(vendor);

      const result = await service.updateBanner(vendorId, 'https://cdn.test/banner.png');

      expect(result).toEqual({ banner: 'https://cdn.test/banner.png' });
    });
  });

  describe('listVendors', () => {
    it('lists active vendors sorted by rating when no coordinates are given', async () => {
      vendorModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([buildPublicVendor()]),
      });
      vendorModel.countDocuments.mockResolvedValue(1);

      const result = await service.listVendors({ sortBy: 'rating', page: 1, limit: 10 } as any);

      expect(result.total).toBe(1);
      expect(result.items[0].profile.businessName).toBe('Test Vendor');
    });

    it('uses a $geoNear aggregation when coordinates are given', async () => {
      vendorModel.aggregate.mockResolvedValue([buildPublicVendor()]);
      vendorModel.countDocuments.mockResolvedValue(1);

      const result = await service.listVendors({
        latitude: 5.6,
        longitude: -0.2,
        page: 1,
        limit: 10,
      } as any);

      expect(vendorModel.aggregate).toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getPublicVendorById', () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    it('marks the vendor open when today\'s hours cover the current time', async () => {
      const vendor = buildPublicVendor({
        businessHours: [{ day: today, openTime: '00:00', closeTime: '23:59', isClosed: false }],
      });
      vendorModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });

      const result = await service.getPublicVendorById(vendorId);

      expect(result.isOpen).toBe(true);
    });

    it('marks the vendor closed when today is flagged as closed', async () => {
      const vendor = buildPublicVendor({
        businessHours: [{ day: today, openTime: '00:00', closeTime: '23:59', isClosed: true }],
      });
      vendorModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });

      const result = await service.getPublicVendorById(vendorId);

      expect(result.isOpen).toBe(false);
    });

    it('throws NotFoundException when the vendor does not exist', async () => {
      vendorModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      await expect(service.getPublicVendorById(vendorId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDashboard', () => {
    it('assembles stats, balances, listings and flash sale counts', async () => {
      orderModel.aggregate.mockResolvedValue([{ orders: 2, revenue: 200 }]);
      orderModel.countDocuments.mockResolvedValue(5);
      orderModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      payoutsService.getVendorBalances.mockResolvedValue({ pendingBalance: 40, availableBalance: 60 });
      productModel.countDocuments.mockResolvedValue(7);
      flashSaleService.getVendorFlashSales.mockResolvedValue({ items: [], total: 3, page: 1, limit: 10 });

      const result = await service.getDashboard(vendorId);

      expect(result.stats.today.orders).toBe(2);
      expect(result.pendingBalance).toBe(40);
      expect(result.availableBalance).toBe(60);
      expect(result.activeListings).toBe(7);
      expect(result.activeFlashSales).toBe(3);
    });
  });

  describe('getSalesAnalytics', () => {
    it('combines the summary, daily breakdown and top products', async () => {
      orderModel.aggregate
        .mockResolvedValueOnce([{ totalOrders: 4, totalRevenue: 400, completedOrders: 3, cancelledOrders: 1 }])
        .mockResolvedValueOnce([{ _id: '2026-09-01', orders: 2, revenue: 100 }])
        .mockResolvedValueOnce([{ productId: 'p1', name: 'Widget', unitsSold: 5, revenue: 250 }]);

      const result = await service.getSalesAnalytics(vendorId, { period: 'week' } as any);

      expect(result.totalOrders).toBe(4);
      expect(result.averageOrderValue).toBe(100);
      expect(result.dailyBreakdown).toHaveLength(1);
      expect(result.topProducts).toHaveLength(1);
    });
  });

  describe('getProductAnalytics', () => {
    it('paginates the vendor\'s products sorted by units sold', async () => {
      productModel.find.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ name: 'Widget' }]),
      });
      productModel.countDocuments.mockResolvedValue(1);

      const result = await service.getProductAnalytics(vendorId, { page: 1, limit: 10 } as any);

      expect(result).toEqual({ items: [{ name: 'Widget' }], total: 1, page: 1, limit: 10 });
    });
  });
});
