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
import { ChangePasswordDto } from "../users/dto/change-password.dto";
import { ForgotPasswordDto } from "../users/dto/forgot-password.dto";
import { ResetPasswordDto } from "../users/dto/reset-password.dto";
import { MailService } from "src/utils/mail.service";
import * as argon2 from "argon2";
import { ConfigService } from "@nestjs/config";
import { CloudinaryService } from "../uploads/cloudinary.service";

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
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
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
async updateProfile(
  id: string,
  dto: UpdateProfileDto,
  logo?: Express.Multer.File
): Promise<SafeVendor> {
  const vendor = await this.vendorModel.findById(id);
  if (!vendor) throw new NotFoundException("Vendor not found");

  // 1️⃣ CLOUDINARY UPLOAD
  let uploadedLogoUrl = null;

  if (logo) {
    const uploaded = await this.cloudinaryService.uploadImage(logo);
    uploadedLogoUrl = uploaded.secure_url;
  }

  // 2️⃣ MERGE OTHER PROFILE FIELDS
  if (dto) {
    vendor.profile = {
      ...vendor.profile,
      ...dto,
    };
  }

  // 3️⃣ REPLACE LOGO ONLY IF NEW FILE WAS UPLOADED
  if (uploadedLogoUrl) {
    vendor.profile.logo = uploadedLogoUrl;
  }

  // 4️⃣ SAVE CHANGES
  await vendor.save();

  // 5️⃣ UPDATE CACHE
  const vendorId = vendor._id.toString();
  await this.cacheManager.set(
    `vendor:${vendor.email}`,
    { id: vendorId, email: vendor.email },
    3600
  );

  this.logger.log(`Vendor profile updated: ${vendor.email}`);

  return this.excludePassword(vendor);
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

  // -----------------------
  // PRIVATE HELPER
  // -----------------------
  private excludePassword(vendor: VendorDocument): SafeVendor {
    const obj = vendor.toObject();
    const { password, refreshToken, ...rest } = obj;
    return { ...rest, _id: (vendor._id as Types.ObjectId).toString() } as SafeVendor;
  }
}
