import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  Inject,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";

import { Vendor, VendorDocument } from "./schema/vendor.schema";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { VendorLoginDto } from "./dto/vendor-login.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateBankDetailsDto } from "./dto/update-bank-details.dto";
import { UpdateBusinessHoursDto } from "./dto/update-business-hours.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { VendorQueryDto } from "./dto/vendor-query.dto";
import { AdminVendorQueryDto } from "./dto/admin-vendor-query.dto";
import { VendorSalesAnalyticsQueryDto } from "./dto/vendor-sales-analytics-query.dto";
import { VendorProductAnalyticsQueryDto } from "./dto/vendor-product-analytics-query.dto";
import { ChangePasswordDto } from "../users/dto/change-password.dto";
import { ForgotPasswordDto } from "../users/dto/forgot-password.dto";
import { ResetPasswordDto } from "../users/dto/reset-password.dto";
import { MailService } from "../../utils/mail.service";
import * as argon2 from "argon2";
import { ConfigService } from "@nestjs/config";
import { CloudinaryService } from "../uploads/cloudinary.service";
import { Product, ProductDocument } from "../products/schema/product.schema";
import { Order, OrderDocument } from "../orders/schema/order.schema";
import { ProductsService } from "../products/products.service";
import { FlashSaleService } from "../flash-sales/flash-sale.service";
import { FlashSaleStatus } from "../flash-sales/dto/enums";
import { PayoutsService } from "../payments/payouts.service";

interface CacheVendor {
  id: string;
  email: string;
}

export interface SafeVendor {
  _id: string;
  email: string;
  role: string;
  profile: any;
  location: any;
  categories: string[];
  rating: any;
  stats: any;
  bankDetails: any;
  isVerified: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class VendorService {
  private readonly logger = new Logger(VendorService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(Vendor.name) private readonly vendorModel: Model<VendorDocument>,
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly productsService: ProductsService,
    private readonly flashSaleService: FlashSaleService,
    private readonly payoutsService: PayoutsService,
  ) {}

  // -----------------------
  // REGISTER VENDOR
  // -----------------------
  async createVendor(
    dto: CreateVendorDto,
    logo?: Express.Multer.File
  ): Promise<{ vendor: SafeVendor; accessToken: string; refreshToken: string }> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.vendorModel.findOne({ email }).lean();
    if (existing) throw new ConflictException("Vendor already registered");

    const hashedPassword = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    
  let profileImageUrl = null;

  //  Upload to Cloudinary if file was included
  if (logo) {
    const uploaded = await this.cloudinaryService.uploadImage(logo);
    profileImageUrl = uploaded.secure_url;
  }
    const vendor = new this.vendorModel({
      ...dto,
      email,
      password: hashedPassword,
      role: "vendor",
      profile: {
        ...dto.profile,
        logo: profileImageUrl || dto.profile.logo,
      },
    });

    let saved: VendorDocument;
    try {
      saved = (await vendor.save()) as VendorDocument;
    } catch (err) {
      this.logger.error("Error saving vendor", err);
      throw new InternalServerErrorException("Failed to create vendor");
    }

    const vendorId = (saved._id as Types.ObjectId).toString();

    const cacheVendor: CacheVendor = {
      id: vendorId,
      email: saved.email,
    };
    await this.cacheManager.set(`vendor:${email}`, cacheVendor, 3600);

    const { accessToken, refreshToken } = await this.getTokens(vendorId, saved.email,vendor.role);
    await this.updateRefreshToken(vendorId, refreshToken);

    this.logger.log(`Vendor created: ${email}`);
    return { vendor: this.excludePassword(saved), accessToken, refreshToken };
  }

  // -----------------------
  // LOGIN VENDOR
  // -----------------------
  async loginVendor(
    dto: VendorLoginDto
  ): Promise<{ vendor: SafeVendor; accessToken: string; refreshToken: string }> {
    const email = dto.email.trim().toLowerCase();
    const vendor = await this.vendorModel.findOne({ email });
    if (!vendor) throw new NotFoundException("Invalid email or password");

  if (!vendor.password) {
    throw new UnauthorizedException(
      `This account uses ${vendor.authProvider} OAuth. Please login via Google.`
    );
  }
    const valid = await bcrypt.compare(dto.password, vendor.password);
    if (!valid) throw new UnauthorizedException("Invalid email or password");

    const vendorId = (vendor._id as Types.ObjectId).toString();
    const { accessToken, refreshToken } = await this.getTokens(vendorId, vendor.email,vendor.role);
    await this.updateRefreshToken(vendorId, refreshToken);

    await this.cacheManager.set(`vendor:${email}`, { id: vendorId, email }, 3600);

    this.logger.log(`Vendor logged in: ${email}`);
    return { vendor: this.excludePassword(vendor), accessToken, refreshToken };
  }

  // -----------------------
  // GET PROFILE
  // -----------------------
  async getVendorProfile(id: string): Promise<SafeVendor> {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");
    return this.excludePassword(vendor);
  }

  // -----------------------
  // UPDATE PROFILE
  // -----------------------
async updateProfile(id: string, dto: UpdateProfileDto): Promise<SafeVendor> {
  const vendor = await this.vendorModel.findById(id);
  if (!vendor) throw new NotFoundException("Vendor not found");

  vendor.profile = { ...vendor.profile, ...dto };
  await vendor.save();
  await this.refreshVendorCache(vendor);

  this.logger.log(`Vendor profile updated: ${vendor.email}`);
  return this.excludePassword(vendor);
}

  // -----------------------
  // UPDATE LOGO
  // -----------------------
  async updateLogo(id: string, url: string): Promise<{ logo: string }> {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.profile.logo = url;
    await vendor.save();

    this.logger.log(`Vendor logo updated: ${vendor.email}`);
    return { logo: url };
  }

  // -----------------------
  // UPDATE BANNER
  // -----------------------
  async updateBanner(id: string, url: string): Promise<{ banner: string }> {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.profile.banner = url;
    await vendor.save();

    this.logger.log(`Vendor banner updated: ${vendor.email}`);
    return { banner: url };
  }

  private async refreshVendorCache(vendor: VendorDocument) {
    const vendorId = vendor._id.toString();
    await this.cacheManager.set(
      `vendor:${vendor.email}`,
      { id: vendorId, email: vendor.email },
      3600
    );
  }


  // -----------------------
  // UPDATE LOCATION
  // -----------------------
  async updateLocation(id: string, dto: UpdateLocationDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.location = { ...vendor.location, ...dto, type: "Point" };
    await vendor.save();

    const vendorId = (vendor._id as Types.ObjectId).toString();
    await this.cacheManager.set(`vendor:${vendor.email}`, { id: vendorId, email: vendor.email }, 3600);

    this.logger.log(`Location updated: ${vendor.email}`);
    return vendor.location;
  }

  // -----------------------
  // UPDATE BUSINESS HOURS
  // -----------------------
  async updateBusinessHours(id: string, dto: UpdateBusinessHoursDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.businessHours = dto.businessHours;
    await vendor.save();

    const vendorId = (vendor._id as Types.ObjectId).toString();
    await this.cacheManager.set(`vendor:${vendor.email}`, { id: vendorId, email: vendor.email }, 3600);

    this.logger.log(`Business hours updated: ${vendor.email}`);
    return vendor.businessHours;
  }

  // -----------------------
  // UPDATE BANK DETAILS
  // -----------------------
  async updateBankDetails(id: string, dto: UpdateBankDetailsDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.bankDetails = { ...vendor.bankDetails, ...dto };
    await vendor.save();

    const vendorId = (vendor._id as Types.ObjectId).toString();
    await this.cacheManager.set(`vendor:${vendor.email}`, { id: vendorId, email: vendor.email }, 3600);

    this.logger.log(`Bank details updated: ${vendor.email}`);
    return vendor.bankDetails;
  }

  // -----------------------
  // CHANGE PASSWORD
  // -----------------------
  async changePassword(id: string, dto: ChangePasswordDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    if (!vendor.password) {
  throw new UnauthorizedException("Cannot change password for OAuth user.");
}
    const valid = await bcrypt.compare(dto.oldPassword, vendor.password);
    if (!valid) throw new UnauthorizedException("Old password is incorrect");

    vendor.password = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    await vendor.save();

    this.logger.log(`Vendor password changed: ${vendor.email}`);
    return { success: true, message: "Password changed successfully" };
  }

  // -----------------------
  // FORGOT PASSWORD
  // -----------------------
  async forgotPassword(dto: ForgotPasswordDto) {
    const vendor = await this.vendorModel.findOne({ email: dto.email.toLowerCase() });
    if (!vendor) throw new NotFoundException("Vendor not found");

    const resetToken = randomBytes(32).toString("hex");
    const vendorId = (vendor._id as Types.ObjectId).toString();

    await this.cacheManager.set(`vendor-reset:${resetToken}`, vendorId, 900);

    const resetLink = `https://your-vendor-dashboard.com/reset-password?token=${resetToken}`;
    const html = `
      <p>Hello ${vendor.profile?.businessName || "Vendor"},</p>
      <p>Click below to reset your password:</p>
      <a href="${resetLink}" target="_blank">${resetLink}</a>
      <p>This link expires in 15 minutes.</p>
    `;

    try {
      await this.mailService.sendEmail(vendor.email, "Reset your password", html);
    } catch (err) {
      this.logger.error(`Failed to send vendor reset email: ${err.message}`);
      throw new InternalServerErrorException("Email failed to send");
    }

    this.logger.log(`Vendor reset link sent: ${vendor.email}`);
    return { success: true, message: "Password reset link sent", resetToken };
  }

  // -----------------------
  // RESET PASSWORD
  // -----------------------
  async resetPassword(dto: ResetPasswordDto) {
    const vendorId = await this.cacheManager.get<string>(`vendor-reset:${dto.token}`);
    if (!vendorId) throw new UnauthorizedException("Invalid or expired reset token");

    const vendor = await this.vendorModel.findById(vendorId);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.password = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    await vendor.save();

    await this.cacheManager.del(`vendor-reset:${dto.token}`);
    this.logger.log(`Vendor password reset: ${vendor.email}`);

    return { success: true, message: "Password reset successfully" };
  }

  // -----------------------
  // LOGOUT
  // -----------------------
  async logOut(id: string) {
    await this.vendorModel.findByIdAndUpdate(id, { refreshToken: null });
    return { success: true, message: "User logged out successfully" };
  }

  // -----------------------
  // TOKEN HELPERS
  // -----------------------
  hashData(data: string) {
    return argon2.hash(data);
  }

  async updateRefreshToken(id: string, refreshToken: string) {
    const hashed = await argon2.hash(refreshToken);
    await this.vendorModel.findByIdAndUpdate(id, { refreshToken: hashed });
  }

  async getTokens(id: string, email: string,role:string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ sub: id, email,role }, {
        secret: this.configService.get<string>("JWT_SECRET"),
        expiresIn: "15m",
      }),
      this.jwtService.signAsync({ sub: id, email,role }, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: "7d",
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async refreshTokens(id: string, refreshToken: string) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor || !vendor.refreshToken) throw new ForbiddenException("Access Denied");

    const matches = await argon2.verify(vendor.refreshToken, refreshToken);
    if (!matches) throw new ForbiddenException("Access Denied");

    const vendorId = (vendor._id as Types.ObjectId).toString();
    const tokens = await this.getTokens(vendorId, vendor.email,vendor.role);
    await this.updateRefreshToken(vendorId, tokens.refreshToken);
    return tokens;
  }

  //private helper for password
  private excludePassword(vendor: VendorDocument): SafeVendor {
    const obj = vendor.toObject();
    const { password, refreshToken, ...rest } = obj;
    return { ...rest, _id: (vendor._id as Types.ObjectId).toString() } as SafeVendor;
  }

async handleGoogleLogin(googleUser: {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  profileImage?: string;
}) {
  if (!googleUser.email) {
    throw new InternalServerErrorException(
      "Google account does not provide email"
    );
  }

  const email = googleUser.email.toLowerCase();

  //Check if vendor already exists
  let vendor = await this.vendorModel.findOne({ email });

  if (vendor) {
    if (!vendor.oauth?.googleId) {
      vendor.oauth = { googleId: googleUser.googleId };
      vendor.authProvider = "google";
      await vendor.save();
    }
  }

  // If vendor does NOT exist, create a new OAuth vendor
  if (!vendor) {
    vendor = await this.vendorModel.create({
      email,
      password: null, // OAuth users don’t need a password
      authProvider: "google",
      isVerified: true,
      oauth: { googleId: googleUser.googleId },
      profile: {
        businessName: googleUser.firstName + " " + googleUser.lastName,
        logo: googleUser.profileImage || null,
        phoneNumber: "",
      },
      role: "vendor",
    });
  }
}

  // =========================================================
  // PUBLIC DISCOVERY
  // =========================================================

  async listVendors(query: VendorQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);

    return query.latitude != null && query.longitude != null
      ? this.listVendorsByDistance(query, page, limit)
      : this.listVendorsBySort(query, page, limit);
  }

  private buildVendorDiscoveryFilter(category?: string) {
    return { isActive: true, ...(category && { categories: category }) };
  }

  private async listVendorsByDistance(query: VendorQueryDto, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const matchFilter = this.buildVendorDiscoveryFilter(query.category);

    const pipeline: any[] = [
      {
        $geoNear: {
          near: { type: "Point", coordinates: [query.longitude, query.latitude] },
          distanceField: "distance",
          spherical: true,
          query: matchFilter,
          ...(query.maxDistance && { maxDistance: query.maxDistance }),
        },
      },
      { $skip: skip },
      { $limit: limit },
    ];

    const [items, total] = await Promise.all([
      this.vendorModel.aggregate(pipeline),
      this.vendorModel.countDocuments(matchFilter),
    ]);

    return { items: items.map((v) => this.toPublicVendor(v)), total, page, limit };
  }

  private async listVendorsBySort(query: VendorQueryDto, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const filter = this.buildVendorDiscoveryFilter(query.category);
    const sort = this.resolveVendorSort(query.sortBy);

    const [items, total] = await Promise.all([
      this.vendorModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      this.vendorModel.countDocuments(filter),
    ]);

    return { items: items.map((v) => this.toPublicVendor(v)), total, page, limit };
  }

  private resolveVendorSort(sortBy?: string): Record<string, 1 | -1> {
    if (sortBy === "rating") return { "rating.average": -1 };
    if (sortBy === "name") return { "profile.businessName": 1 };
    return { createdAt: -1 };
  }

  async getPublicVendorById(id: string) {
    const vendor = await this.vendorModel.findOne({ _id: id, isActive: true }).lean();
    if (!vendor) throw new NotFoundException("Vendor not found");

    return { ...this.toPublicVendor(vendor), isOpen: this.isVendorOpenNow(vendor.businessHours) };
  }

  // =========================================================
  // ADMIN
  // =========================================================

  /** Every vendor regardless of isActive/isVerified — the public list/lookup above deliberately excludes these. */
  async listAllVendorsForAdmin(query: AdminVendorQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = query.search
      ? {
          $or: [
            { "profile.businessName": { $regex: query.search, $options: "i" } },
            { email: { $regex: query.search, $options: "i" } },
          ],
        }
      : {};

    const [vendors, total] = await Promise.all([
      this.vendorModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.vendorModel.countDocuments(filter),
    ]);

    return { items: vendors.map((vendor) => this.excludePassword(vendor)), total, page, limit };
  }

  async approveVendor(id: string): Promise<SafeVendor> {
    return this.setVendorActive(id, true);
  }

  async suspendVendor(id: string): Promise<SafeVendor> {
    return this.setVendorActive(id, false);
  }

  private async setVendorActive(id: string, isActive: boolean): Promise<SafeVendor> {
    const vendor = await this.vendorModel.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!vendor) throw new NotFoundException("Vendor not found");

    return this.excludePassword(vendor);
  }

  private isVendorOpenNow(businessHours: { day: string; openTime?: string; closeTime?: string; isClosed?: boolean }[] = []): boolean {
    const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const todayHours = businessHours.find((h) => h.day === today);
    if (!todayHours || todayHours.isClosed || !todayHours.openTime || !todayHours.closeTime) return false;

    const currentTime = new Date().toTimeString().slice(0, 5);
    return currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
  }

  private toPublicVendor(vendor: any) {
    return {
      _id: vendor._id.toString(),
      profile: { businessName: vendor.profile?.businessName, logo: vendor.profile?.logo },
      categories: vendor.categories ?? [],
      rating: vendor.rating ?? { average: 0, count: 0 },
      stats: { totalOrders: vendor.stats?.totalOrders ?? 0 },
      location: vendor.location,
      businessHours: vendor.businessHours ?? [],
      isVerified: !!vendor.isVerified,
    };
  }

  // =========================================================
  // DASHBOARD
  // =========================================================

  async getDashboard(vendorId: string) {
    const [today, thisWeek, thisMonth, allTime] = await Promise.all([
      this.aggregateOrders(vendorId, this.startOfToday()),
      this.aggregateOrders(vendorId, this.daysAgo(7)),
      this.aggregateOrders(vendorId, this.daysAgo(30)),
      this.aggregateAllTimeOrders(vendorId),
    ]);

    const [pendingOrders, balances, activeListings, activeFlashSales, recentOrders] = await Promise.all([
      this.orderModel.countDocuments({ vendorId, status: "pending", createdAt: { $gte: this.startOfToday() } }),
      this.payoutsService.getVendorBalances(vendorId),
      this.productModel.countDocuments({ vendorId, isAvailable: true }),
      this.flashSaleService.getVendorFlashSales(vendorId, { status: FlashSaleStatus.ACTIVE }),
      this.getRecentOrders(vendorId),
    ]);

    return {
      stats: { today, thisWeek, thisMonth, allTime },
      pendingOrders,
      pendingBalance: balances.pendingBalance,
      availableBalance: balances.availableBalance,
      activeListings,
      activeFlashSales: activeFlashSales.total,
      recentOrders,
    };
  }

  private startOfToday(): Date {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return start;
  }

  private daysAgo(days: number): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private async aggregateOrders(vendorId: string, since: Date) {
    const [result] = await this.orderModel.aggregate([
      { $match: { vendorId: new Types.ObjectId(vendorId), createdAt: { $gte: since } } },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$pricing.total" } } },
    ]);
    return { orders: result?.orders ?? 0, revenue: result?.revenue ?? 0 };
  }

  private async aggregateAllTimeOrders(vendorId: string) {
    const base = await this.aggregateOrders(vendorId, new Date(0));
    const completedOrders = await this.orderModel.countDocuments({ vendorId, status: "completed" });
    return { ...base, completedOrders };
  }

  private async getRecentOrders(vendorId: string) {
    const orders = await this.orderModel
      .find({ vendorId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("customerId", "email profile.firstName profile.lastName")
      .lean();

    return orders.map((order) => ({
      orderNumber: order.orderNumber,
      customer: order.customerId,
      total: order.pricing?.total ?? 0,
      status: order.status,
      createdAt: (order as any).createdAt,
    }));
  }

  // =========================================================
  // ANALYTICS
  // =========================================================

  async getSalesAnalytics(vendorId: string, query: VendorSalesAnalyticsQueryDto) {
    const { start, end } = this.resolveAnalyticsRange(query);
    const [summary, dailyBreakdown, topProducts] = await Promise.all([
      this.getOrderSummary(vendorId, start, end),
      this.getDailyBreakdown(vendorId, start, end),
      this.getTopProducts(vendorId, start, end),
    ]);

    return { ...summary, dailyBreakdown, topProducts };
  }

  private resolveAnalyticsRange(query: VendorSalesAnalyticsQueryDto): { start: Date; end: Date } {
    const end = query.endDate ? new Date(query.endDate) : new Date();
    if (query.period === "custom" && query.startDate) return { start: new Date(query.startDate), end };
    return { start: this.periodStart(query.period), end };
  }

  private periodStart(period?: string): Date {
    if (period === "week") return this.daysAgo(7);
    if (period === "month") return this.daysAgo(30);
    if (period === "year") return this.daysAgo(365);
    return this.startOfToday();
  }

  private buildDateMatch(vendorId: string, start: Date, end: Date) {
    return { vendorId: new Types.ObjectId(vendorId), createdAt: { $gte: start, $lte: end } };
  }

  private async getOrderSummary(vendorId: string, start: Date, end: Date) {
    const [result] = await this.orderModel.aggregate([
      { $match: this.buildDateMatch(vendorId, start, end) },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$pricing.total" },
          completedOrders: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          cancelledOrders: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        },
      },
    ]);

    const totalOrders = result?.totalOrders ?? 0;
    const totalRevenue = result?.totalRevenue ?? 0;
    return {
      totalOrders,
      completedOrders: result?.completedOrders ?? 0,
      cancelledOrders: result?.cancelledOrders ?? 0,
      totalRevenue,
      averageOrderValue: totalOrders ? Number((totalRevenue / totalOrders).toFixed(2)) : 0,
    };
  }

  private getDailyBreakdown(vendorId: string, start: Date, end: Date) {
    return this.orderModel.aggregate([
      { $match: this.buildDateMatch(vendorId, start, end) },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          orders: { $sum: 1 },
          revenue: { $sum: "$pricing.total" },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }

  private getTopProducts(vendorId: string, start: Date, end: Date) {
    return this.orderModel.aggregate([
      { $match: this.buildDateMatch(vendorId, start, end) },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          unitsSold: { $sum: "$items.quantity" },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      { $project: { productId: "$_id", name: "$product.name", unitsSold: 1, revenue: 1, _id: 0 } },
    ]);
  }

  async getProductAnalytics(vendorId: string, query: VendorProductAnalyticsQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.productModel
        .find({ vendorId })
        .select("name views soldCount rating")
        .sort({ soldCount: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.productModel.countDocuments({ vendorId }),
    ]);

    return { items, total, page, limit };
  }

}
