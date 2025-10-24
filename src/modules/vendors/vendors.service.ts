import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  Inject,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";

import { Vendor,VendorDocument } from "./schema/vendor.schema";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { VendorLoginDto } from "./dto/vendor-login.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateBankDetailsDto } from "./dto/update-bank-details.dto";
import { UpdateBusinessHoursDto } from "./dto/update-business-hours.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { ChangePasswordDto } from "../users/dto/change-password.dto";
import { ForgotPasswordDto } from "../users/dto/forgot-password.dto";
import { ResetPasswordDto } from "../users/dto/reset-password.dto";
import { MailService } from "src/utils/mail.service";

interface CacheVendor {
  id: string;
  email: string;
}

export interface SafeVendor {
  _id: any;
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
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly mailService: MailService
  ) {}

  // ✅ REGISTER VENDOR
  async createVendor(dto: CreateVendorDto): Promise<{ vendor: SafeVendor; token: string }> {
    const email = dto.email.trim().toLowerCase();

    // 1️⃣ Check existing
    const existing = await this.vendorModel.findOne({ email }).lean();
    if (existing) throw new ConflictException("Vendor already registered");

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // 3️⃣ Create vendor
    const vendor = new this.vendorModel({
      ...dto,
      email,
      password: hashedPassword,
      role: "vendor",
    });

    const saved = await vendor.save();

    // 4️⃣ Cache vendor
    await this.cacheManager.set(`vendor:${email}`, { id: saved._id, email }, 3600);

    // 5️⃣ Generate JWT
    const payload = { sub: saved._id, email: saved.email };
    const token = await this.jwtService.signAsync(payload);

    this.logger.log(`Vendor created: ${email}`);
    return { vendor: this.excludePassword(saved), token };
  }

  // ✅ LOGIN
  async loginVendor(dto: VendorLoginDto): Promise<{ vendor: SafeVendor; token: string }> {
    const email = dto.email.trim().toLowerCase();
    const vendor = await this.vendorModel.findOne({ email });

    if (!vendor) throw new NotFoundException("Invalid email or password");

    const valid = await bcrypt.compare(dto.password, vendor.password);
    if (!valid) throw new UnauthorizedException("Invalid email or password");

    const payload = { sub: vendor._id, email: vendor.email };
    const token = await this.jwtService.signAsync(payload);

    await this.cacheManager.set(`vendor:${email}`, { id: vendor._id, email }, 3600);

    this.logger.log(`Vendor logged in: ${email}`);
    return { vendor: this.excludePassword(vendor), token };
  }

  // ✅ GET PROFILE
  async getVendorProfile(id: string): Promise<SafeVendor> {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");
    return this.excludePassword(vendor);
  }

  // ✅ UPDATE PROFILE
  async updateProfile(id: string, dto: UpdateProfileDto): Promise<SafeVendor> {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.profile = { ...vendor.profile, ...dto };
    await vendor.save();

    this.logger.log(`Vendor profile updated: ${vendor.email}`);
    return this.excludePassword(vendor);
  }

  // ✅ UPDATE LOCATION
  async updateLocation(id: string, dto: UpdateLocationDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.location = { ...vendor.location, ...dto, type: "Point" };
    await vendor.save();

    this.logger.log(`Location updated: ${vendor.email}`);
    return vendor.location;
  }

  // ✅ UPDATE BUSINESS HOURS
  async updateBusinessHours(id: string, dto: UpdateBusinessHoursDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.businessHours = dto.businessHours;
    await vendor.save();

    this.logger.log(`Business hours updated: ${vendor.email}`);
    return vendor.businessHours;
  }

  // ✅ UPDATE BANK DETAILS
  async updateBankDetails(id: string, dto: UpdateBankDetailsDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    vendor.bankDetails = { ...vendor.bankDetails, ...dto };
    await vendor.save();

    this.logger.log(`Bank details updated: ${vendor.email}`);
    return vendor.bankDetails;
  }

  // ✅ CHANGE PASSWORD
  async changePassword(id: string, dto: ChangePasswordDto) {
    const vendor = await this.vendorModel.findById(id);
    if (!vendor) throw new NotFoundException("Vendor not found");

    const valid = await bcrypt.compare(dto.oldPassword, vendor.password);
    if (!valid) throw new UnauthorizedException("Old password is incorrect");

    vendor.password = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    await vendor.save();

    this.logger.log(`Vendor password changed: ${vendor.email}`);
    return { success: true, message: "Password changed successfully" };
  }

  // ✅ FORGOT PASSWORD
  async forgotPassword(dto: ForgotPasswordDto) {
    const vendor = await this.vendorModel.findOne({ email: dto.email });
    if (!vendor) throw new NotFoundException("Vendor not found");

    const resetToken = randomBytes(32).toString("hex");
    //I will start working from here 
    await this.cacheManager.set(`vendor-reset:${resetToken}`, vendor.toString(), 900);

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

  // ✅ RESET PASSWORD
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

  // ✅ PRIVATE HELPER
  private excludePassword(vendor: VendorDocument): SafeVendor {
    const obj = vendor.toObject();
    const { password, ...rest } = obj;
    return rest as SafeVendor;
  }
}
