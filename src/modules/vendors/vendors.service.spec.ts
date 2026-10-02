import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

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
  let jwtService: any;
  let mailService: any;

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
    vendorModel = Object.assign(jest.fn(), {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    });
    productModel = { countDocuments: jest.fn(), find: jest.fn() };
    orderModel = { aggregate: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };
    cacheManager = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    payoutsService = { getVendorBalances: jest.fn() };
    flashSaleService = { getVendorFlashSales: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
    mailService = { sendEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorService,
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: JwtService, useValue: jwtService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://vendor.test') } },
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

  describe('handleGoogleLogin', () => {
    const googleUser = {
      googleId: 'google-123',
      email: 'Vendor@Test.com',
      firstName: 'Jane',
      lastName: 'Doe',
      profileImage: 'https://example.com/photo.jpg',
    };

    it('rejects sign-in when no vendor account exists for the email', async () => {
      vendorModel.findOne.mockResolvedValue(null);

      await expect(service.handleGoogleLogin(googleUser)).rejects.toThrow(NotFoundException);
      expect(vendorModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('links the Google account to an existing vendor on first OAuth login', async () => {
      const vendor = buildVendorDoc({ oauth: undefined, isActive: true, save: jest.fn().mockResolvedValue(undefined) });
      vendorModel.findOne.mockResolvedValue(vendor);
      vendorModel.findByIdAndUpdate.mockResolvedValue(vendor);

      const result = await service.handleGoogleLogin(googleUser);

      expect((vendor as any).oauth).toEqual({ googleId: 'google-123' });
      expect((vendor as any).authProvider).toBe('google');
      expect(vendor.save).toHaveBeenCalled();
      expect(result.vendor).toBeDefined();
      expect(result.accessToken).toBe('signed-token');
    });

    it('logs in without re-linking when the vendor already has this Google account', async () => {
      const vendor = buildVendorDoc({ oauth: { googleId: 'google-123' }, isActive: true, save: jest.fn() });
      vendorModel.findOne.mockResolvedValue(vendor);
      vendorModel.findByIdAndUpdate.mockResolvedValue(vendor);

      await service.handleGoogleLogin(googleUser);

      expect(vendor.save).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('never returns the reset token in the response', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc());

      const result = await service.forgotPassword({ email: 'vendor@test.com' });

      expect(result).not.toHaveProperty('resetToken');
    });

    it('returns the same response for an unknown email without sending mail', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc());
      const knownEmailResult = await service.forgotPassword({ email: 'vendor@test.com' });
      mailService.sendEmail.mockClear();
      vendorModel.findOne.mockResolvedValue(null);

      const unknownEmailResult = await service.forgotPassword({ email: 'nobody@test.com' });

      expect(unknownEmailResult).toEqual(knownEmailResult);
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('links vendors to the vendor app reset page', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc());

      await service.forgotPassword({ email: 'vendor@test.com' });

      expect(mailService.sendEmail.mock.calls[0][2]).toContain(
        'http://vendor.test/vendor/reset-password?token=',
      );
    });
  });

  describe('forgotPassword delivery', () => {
    it('responds without waiting for the email to be sent', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc());
      mailService.sendEmail.mockReturnValue(new Promise(() => undefined));

      await expect(service.forgotPassword({ email: 'vendor@test.com' })).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    });

    it('still returns the generic response when the email fails to send', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc());
      mailService.sendEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(service.forgotPassword({ email: 'vendor@test.com' })).resolves.toEqual(
        expect.objectContaining({ success: true }),
      );
    });
  });

  describe('createVendor', () => {
    const dto = {
      email: 'New@Vendor.com',
      password: 'StrongPass1!',
      profile: { businessName: 'New Shop', phoneNumber: '0200000000' },
    };

    beforeEach(() => {
      vendorModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    });

    it('issues no tokens, since a new vendor must be approved before signing in', async () => {
      vendorModel.mockImplementation(() => buildVendorDoc({ save: jest.fn().mockResolvedValue(buildVendorDoc()) }));

      const result = await service.createVendor(dto);

      expect(Object.keys(result)).toEqual(['vendor']);
    });
  });

  describe('loginVendor', () => {
    const PASSWORD = 'StrongPass1!';
    const TEST_SALT_ROUNDS = 4;
    let passwordHash: string;

    beforeAll(async () => {
      passwordHash = await bcrypt.hash(PASSWORD, TEST_SALT_ROUNDS);
    });

    it('rejects an unknown email with the generic 401', async () => {
      vendorModel.findOne.mockResolvedValue(null);

      await expect(service.loginVendor({ email: 'nobody@test.com', password: PASSWORD })).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects a wrong password with the same generic 401', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc({ password: passwordHash, isActive: true }));

      await expect(service.loginVendor({ email: 'vendor@test.com', password: 'Wrong1!pass' })).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects a Google-only vendor with the same generic 401', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc({ password: undefined, isActive: true }));

      await expect(service.loginVendor({ email: 'vendor@test.com', password: PASSWORD })).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects a pending or suspended vendor that knows its password', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc({ password: passwordHash, isActive: false }));

      await expect(service.loginVendor({ email: 'vendor@test.com', password: PASSWORD })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('signs in an active vendor', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc({ password: passwordHash, isActive: true }));

      const result = await service.loginVendor({ email: 'vendor@test.com', password: PASSWORD });

      expect(result.accessToken).toBe('signed-token');
    });
  });

  describe('password changes revoke sessions', () => {
    it('clears the stored refresh token on password reset', async () => {
      const vendor = buildVendorDoc({ refreshToken: 'stored-refresh-hash' });
      cacheManager.get.mockResolvedValue(vendorId);
      vendorModel.findById.mockResolvedValue(vendor);

      await service.resetPassword({ token: 'reset-token', newPassword: 'NewStrong1!' });

      expect((vendor as any).refreshToken).toBeUndefined();
    });

    it('clears the stored refresh token on password change', async () => {
      const vendor = buildVendorDoc({
        password: await bcrypt.hash('OldStrong1!', 4),
        refreshToken: 'stored-refresh-hash',
      });
      vendorModel.findById.mockResolvedValue(vendor);

      await service.changePassword(vendorId, { oldPassword: 'OldStrong1!', newPassword: 'NewStrong1!' });

      expect((vendor as any).refreshToken).toBeUndefined();
    });
  });

  describe('inactive vendors', () => {
    it('cannot refresh tokens', async () => {
      vendorModel.findById.mockResolvedValue(buildVendorDoc({ refreshToken: 'hash', isActive: false }));

      await expect(service.refreshTokens(vendorId, 'refresh-token')).rejects.toThrow(ForbiddenException);
    });

    it('cannot sign in with Google', async () => {
      vendorModel.findOne.mockResolvedValue(buildVendorDoc({ oauth: { googleId: 'g-1' }, isActive: false }));

      await expect(
        service.handleGoogleLogin({ googleId: 'g-1', email: 'vendor@test.com', firstName: 'A', lastName: 'B' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lose live access-token sessions as soon as they are suspended', async () => {
      vendorModel.findByIdAndUpdate.mockResolvedValue(buildVendorDoc({ role: 'vendor', isActive: false }));

      await service.suspendVendor(vendorId);

      expect(cacheManager.del).toHaveBeenCalledWith(`account-active:Vendor:${vendorId}`);
    });
  });
});
