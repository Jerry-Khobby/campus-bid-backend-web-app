import {
  Injectable,
  Inject,
  ConflictException,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { randomBytes } from "crypto";
import { User, UserDocument } from "./schema/user.schema";
import { Order, OrderDocument } from "../orders/schema/order.schema";
import { CreateUserDto } from "./dto/create-user.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";
import { CreatePaymentMethodDto } from "./dto/create-payment-method.dto";
import { AdminUserQueryDto } from "./dto/admin-user-query.dto";
import { CreateAdminDto } from "./dto/create-admin.dto";
import { MailService } from "../../utils/mail.service";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { CloudinaryService } from "../uploads/cloudinary.service";
import { getAccountStatusCacheKey } from "../../common/guards/account-status";
import { isPasswordCorrect } from "./password-check";

interface CacheUser {
  id: string;
  email: string;
}

export interface SafeUser {
  _id: any;
  email: string;
  role: string;
  profile: any;
  addresses: any[];
  paymentMethods: any[];
  isVerified: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: "If an account exists for this email, a password reset link has been sent",
};

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
const SUSPENDED_ACCOUNT_MESSAGE = "This account has been suspended";
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const USER_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  //CREATE USER (Signup)
  async createUser(
    createUserDto: CreateUserDto,
    uploadImage?: Express.Multer.File,
  ): Promise<{ user: SafeUser; accessToken: string; refreshToken: string }> {
    const email = createUserDto.email.trim().toLowerCase();

    // Check cache or DB for existing user
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    if (cachedUser) throw new ConflictException("User already exists");

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) throw new ConflictException("Email already registered");

    // Hash password
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      this.SALT_ROUNDS
    );

  let profileImageUrl = null;

  // Upload to Cloudinary if file was included
  if (uploadImage) {
    const uploaded = await this.cloudinaryService.uploadImage(uploadImage);
    profileImageUrl = uploaded.secure_url;
  }
    // Save user — role is intentionally never taken from the client; every
    // self-registration is a student, matching the schema default.
    const newUser = new this.userModel({
      email,
      password: hashedPassword,
      addresses: createUserDto.addresses,
      profile:{
        ...createUserDto.profile,
        profileImage: profileImageUrl||null,
      }
    });

    let savedUser: UserDocument;
    try {
      savedUser = await newUser.save();
    } catch (err) {
      this.logger.error("Error saving new user", err);
      throw new InternalServerErrorException("Failed to create user");
    }

    // Cache minimal user info
    const cacheUser: CacheUser = {
      id: savedUser._id.toString(),
      email: savedUser.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3_600_000);

    // Generate tokens
    const tokens = await this.getTokens(savedUser._id.toString(), savedUser.email,savedUser.role);
    await this.updateRefreshToken(savedUser._id.toString(), tokens.refreshToken);

    const safeUser = this.excludePassword(savedUser);

    this.logger.log(`User created & tokens generated: ${savedUser.email}`);
    return { user: safeUser, ...tokens };
  }

  // ✅ CREATE ADMIN (admin-only) — the in-app replacement for the
  // create-admin CLI script: an existing admin sets a temp password for the
  // new one directly, who changes it after their first login.
  async createAdmin(dto: CreateAdminDto): Promise<SafeUser> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) throw new ConflictException("Email already registered");

    const hashedPassword = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    const newAdmin = new this.userModel({
      email,
      password: hashedPassword,
      role: "admin",
      isVerified: true,
      profile: { firstName: dto.firstName, lastName: dto.lastName },
    });

    const savedAdmin = await newAdmin.save();
    this.logger.log(`Admin account created: ${savedAdmin.email}`);
    return this.excludePassword(savedAdmin);
  }

  // ✅ LOGIN
  async loginUser(
    loginDto: LoginDto
  ): Promise<{ user: SafeUser; accessToken: string; refreshToken: string }> {
    const email = loginDto.email.trim().toLowerCase();
    const user = await this.findUserForLogin(email);

    // One message for unknown emails, Google-only accounts and wrong passwords, so login can't enumerate accounts.
    const isMatch = await isPasswordCorrect(user?.password, loginDto.password, this.SALT_ROUNDS);
    if (!user || !isMatch) throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    this.assertAccountActive(user);

    // Generate tokens
    const tokens = await this.getTokens(user._id.toString(), user.email,user.role);
    await this.updateRefreshToken(user._id.toString(), tokens.refreshToken);

    // Cache for future
    const cacheUser: CacheUser = {
      id: user._id.toString(),
      email: user.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, USER_CACHE_TTL_MS);

    const safeUser = this.excludePassword(user);

    this.logger.log(`User logged in successfully: ${email}`);
    return { user: safeUser, ...tokens };
  }

  private async findUserForLogin(email: string): Promise<UserDocument | null> {
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    if (cachedUser) return this.userModel.findById(cachedUser.id);
    return this.userModel.findOne({ email });
  }

  private assertAccountActive(user: UserDocument): void {
    if (!user.isActive) throw new ForbiddenException(SUSPENDED_ACCOUNT_MESSAGE);
  }

  //UPDATE PROFILE
  async updateUser(
    userId: string,
    updateProfileDto: UpdateProfileDto
  ): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (updateProfileDto.profile) {
      user.profile = {
        ...user.profile,
        ...updateProfileDto.profile,
      };
    }

    await user.save();
    this.logger.log(`User ${user.email} updated profile successfully`);

    return this.excludePassword(user);
  }

  // UPDATE PROFILE IMAGE
  async updateProfileImage(userId: string, imageUrl: string): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    user.profile.profileImage = imageUrl;
    await user.save();

    this.logger.log(`Profile image updated for ${user.email}`);
    return this.excludePassword(user);
  }

  // GET ADDRESSES
  async getAddresses(userId: string) {
    const user = await this.userModel.findById(userId).select("addresses");
    if (!user) throw new NotFoundException("User not found");
    return user.addresses;
  }

  // ADD ADDRESS
  async addAddress(userId: string, dto: CreateAddressDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (dto.isDefault) await this.clearDefaultAddresses(userId);

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $push: { addresses: this.buildAddress(dto) } },
      { new: true }
    );
    if (!updated) throw new NotFoundException("User not found");

    this.logger.log(`Address added for ${user.email}`);
    return updated.addresses;
  }

  // UPDATE ADDRESS
  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    this.assertValidId(addressId, "address");

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const address = this.addressArray(user).id(addressId);
    if (!address) throw new NotFoundException("Address not found");

    if (dto.isDefault) this.unsetOtherDefaultAddresses(user, addressId);
    this.mergeAddressFields(address, dto);

    await user.save();
    this.logger.log(`Address ${addressId} updated for ${user.email}`);
    return user.addresses;
  }

  // DELETE ADDRESS
  async deleteAddress(userId: string, addressId: string) {
    this.assertValidId(addressId, "address");

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (!this.addressArray(user).id(addressId))
      throw new NotFoundException("Address not found");

    this.addressArray(user).pull(addressId);
    await user.save();

    this.logger.log(`Address ${addressId} deleted for ${user.email}`);
    return user.addresses;
  }

  // GET PAYMENT METHODS
  async getPaymentMethods(userId: string) {
    const user = await this.userModel.findById(userId).select("paymentMethods");
    if (!user) throw new NotFoundException("User not found");
    return user.paymentMethods;
  }

  // ADD PAYMENT METHOD
  async addPaymentMethod(userId: string, dto: CreatePaymentMethodDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (dto.isDefault) await this.clearDefaultPaymentMethods(userId);

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $push: { paymentMethods: dto } },
      { new: true }
    );
    if (!updated) throw new NotFoundException("User not found");

    this.logger.log(`Payment method added for ${user.email}`);
    return updated.paymentMethods;
  }

  // DELETE PAYMENT METHOD
  async deletePaymentMethod(userId: string, paymentMethodId: string) {
    this.assertValidId(paymentMethodId, "payment method");

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (!this.paymentMethodArray(user).id(paymentMethodId))
      throw new NotFoundException("Payment method not found");

    this.paymentMethodArray(user).pull(paymentMethodId);
    await user.save();

    this.logger.log(`Payment method ${paymentMethodId} deleted for ${user.email}`);
    return user.paymentMethods;
  }

  //  Helper: validate a Mongo ObjectId path parameter
  private assertValidId(id: string, label: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(`Invalid ${label} id`);
  }

  //  Helper: expose addresses as a Mongoose subdocument array (adds .id()/.pull())
  private addressArray(user: UserDocument): Types.DocumentArray<any> {
    return user.addresses as unknown as Types.DocumentArray<any>;
  }

  //  Helper: expose paymentMethods as a Mongoose subdocument array
  private paymentMethodArray(user: UserDocument): Types.DocumentArray<any> {
    return user.paymentMethods as unknown as Types.DocumentArray<any>;
  }

  //  Helper: build an address subdocument from a CreateAddressDto
  private buildAddress(dto: CreateAddressDto) {
    return {
      label: dto.label,
      building: dto.building,
      room: dto.room,
      location: { type: "Point", coordinates: [dto.longitude, dto.latitude] },
      instructions: dto.instructions,
      isDefault: dto.isDefault,
    };
  }

  //  Helper: merge partial fields into an existing address subdocument
  private mergeAddressFields(address: any, dto: UpdateAddressDto) {
    const { latitude, longitude, ...fields } = dto;
    Object.assign(address, fields);

    if (latitude !== undefined || longitude !== undefined) {
      address.location = {
        type: "Point",
        coordinates: [
          longitude ?? address.location.coordinates[0],
          latitude ?? address.location.coordinates[1],
        ],
      };
    }
  }

  //  Helper: unset isDefault on every address except the one being updated
  private unsetOtherDefaultAddresses(user: UserDocument, exceptId: string) {
    for (const address of user.addresses as any[]) {
      if (address._id.toString() !== exceptId) address.isDefault = false;
    }
  }

  //  Helper: unset isDefault on all addresses via a direct update
  private async clearDefaultAddresses(userId: string) {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { "addresses.$[].isDefault": false } }
    );
  }

  //  Helper: unset isDefault on all payment methods via a direct update
  private async clearDefaultPaymentMethods(userId: string) {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { "paymentMethods.$[].isDefault": false } }
    );
  }

  // CHANGE PASSWORD
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");



    if (!user.password) {
  throw new UnauthorizedException("User does not have a password. Please login with Google.");
}

    const match = await bcrypt.compare(dto.oldPassword, user.password);
    if (!match) throw new UnauthorizedException("Old password is incorrect");

    user.password = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    this.revokeRefreshToken(user);
    await user.save();

    this.logger.log(`Password changed for ${user.email}`);
    return { success: true, message: "Password updated successfully" };
  }

  // FORGOT PASSWORD
  // Same response whether or not the account exists, so this endpoint can't be used to enumerate emails.
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (user) await this.startPasswordReset(user);

    return FORGOT_PASSWORD_RESPONSE;
  }

  private async startPasswordReset(user: UserDocument): Promise<void> {
    const resetToken = randomBytes(RESET_TOKEN_BYTES).toString("hex");
    await this.cacheManager.set(`reset:${resetToken}`, user._id.toString(), RESET_TOKEN_TTL_MS);

    // Not awaited: waiting on the mail server would make known emails measurably slower than unknown ones.
    void this.sendResetEmail(user, resetToken);
  }

  private async sendResetEmail(user: UserDocument, resetToken: string): Promise<void> {
    const resetLink = `${this.getResetPasswordUrl(user.role)}?token=${resetToken}`;
    const html = `
      <p>Hello ${user.profile?.firstName || "User"},</p>
      <p>You requested a password reset. Click below to set a new password:</p>
      <a href="${resetLink}" target="_blank">${resetLink}</a>
      <p>This link will expire in 15 minutes.</p>
    `;

    try {
      await this.mailService.sendEmail(user.email, "Reset your password", html);
      this.logger.log(`Password reset link sent to ${user.email}`);
    } catch (err) {
      // The requester already has the generic reply; the unused token simply expires.
      this.logger.error(`Password reset email to ${user.email} failed: ${err.message}`, err.stack);
    }
  }

  private getResetPasswordUrl(role: string): string {
    if (role === "admin") {
      return `${this.configService.get<string>("ADMIN_APP_URL")}/admin/reset-password`;
    }
    return `${this.configService.get<string>("APP_URL")}/reset-password`;
  }

  // RESET PASSWORD
  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.cacheManager.get<string>(`reset:${dto.token}`);
    if (!userId) throw new UnauthorizedException("Invalid or expired reset token");

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    user.password = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    this.revokeRefreshToken(user);
    await user.save();

    await this.cacheManager.del(`reset:${dto.token}`);
    this.logger.log(`Password reset successful for ${user.email}`);

    return { success: true, message: "Password has been reset successfully" };
  }

  // A new password must end every existing session, including any an attacker holds.
  private revokeRefreshToken(user: UserDocument): void {
    user.refreshToken = undefined;
  }

  // GET USER PROFILE
  async getUserProfile(userId: string): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");
    return this.excludePassword(user);
  }

  //  VALIDATE USER (for auth guards)
  async validateUser(payload: any): Promise<SafeUser> {
    const user = await this.userModel.findById(payload.sub);
    if (!user) throw new UnauthorizedException("User not found");
    return this.excludePassword(user);
  }

  // LOGOUT
  async logOut(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { refreshToken: null });
    return { success: true, message: "User logged out successfully" };
  }

  //  TOKEN HELPERS
  hashData(data: string) {
    return argon2.hash(data);
  }

  async updateRefreshToken(userId: string, refreshToken: string,) {
    const hashedToken = await this.hashData(refreshToken);
    await this.userModel.findByIdAndUpdate(userId, { refreshToken: hashedToken });
  }

  async getTokens(userId: string, email: string,role:string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email,role },
        {
          secret: this.configService.get<string>("JWT_SECRET"),
          expiresIn: "15m",
        }
      ),
      this.jwtService.signAsync(
        { sub: userId, email,role },
        {
          secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
          expiresIn: "7d",
        }
      ),
    ]);

    return { accessToken, refreshToken };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.userModel.findById(userId);
    if (!user || !user.refreshToken)
      throw new ForbiddenException("Access Denied");
    this.assertAccountActive(user);

    const refreshTokenMatches = await argon2.verify(
      user.refreshToken,
      refreshToken
    );

    if (!refreshTokenMatches) throw new ForbiddenException("Access Denied");

    const tokens = await this.getTokens(user.id, user.email,user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  //  Helper: strip the password and refresh-token hashes from every response
  private excludePassword(user: UserDocument): SafeUser {
    const userObj = user.toObject ? user.toObject() : user;
    const { password, refreshToken, ...rest } = userObj;
    return rest as SafeUser;
  }

  // =========================================================
  // ADMIN
  // =========================================================

  /** Every student account, with order totals merged in — the admin "Customers" list. */
  async listAllUsersForAdmin(query: AdminUserQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { role: "student" };
    if (query.search) {
      filter.$or = [
        { "profile.firstName": { $regex: query.search, $options: "i" } },
        { "profile.lastName": { $regex: query.search, $options: "i" } },
        { email: { $regex: query.search, $options: "i" } },
        { "profile.university": { $regex: query.search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      this.userModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.userModel.countDocuments(filter),
    ]);

    const orderTotals = await this.getOrderTotalsByCustomer(users.map((user) => user._id as Types.ObjectId));

    const items = users.map((user) => ({
      ...this.excludePassword(user),
      ...(orderTotals.get(user._id.toString()) ?? { totalOrders: 0, totalSpent: 0 }),
    }));

    return { items, total, page, limit };
  }

  private async getOrderTotalsByCustomer(
    customerIds: Types.ObjectId[],
  ): Promise<Map<string, { totalOrders: number; totalSpent: number }>> {
    if (customerIds.length === 0) return new Map();

    const results = await this.orderModel.aggregate([
      { $match: { customerId: { $in: customerIds } } },
      { $group: { _id: "$customerId", totalOrders: { $sum: 1 }, totalSpent: { $sum: "$pricing.total" } } },
    ]);

    return new Map(
      results.map((result) => [
        result._id.toString(),
        { totalOrders: result.totalOrders, totalSpent: result.totalSpent },
      ]),
    );
  }

  async approveUser(id: string): Promise<SafeUser> {
    return this.setUserActive(id, true);
  }

  async suspendUser(id: string): Promise<SafeUser> {
    return this.setUserActive(id, false);
  }

  private async setUserActive(id: string, isActive: boolean): Promise<SafeUser> {
    const user = await this.userModel.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!user) throw new NotFoundException("User not found");

    await this.cacheManager.del(getAccountStatusCacheKey(user.role, id));
    return this.excludePassword(user);
  }


  //the service that handles the login with google 
  async handleGoogleLogin(googleUser:{
    googleId:string;
    email:string;
    firstName:string;
    lastName:string;
    profileImage?:string;
  }){
    if(!googleUser.email){
          throw new InternalServerErrorException('Google account does not provide email');}
      const email = googleUser.email.toLowerCase();

  let user = await this.userModel.findOne({ email });

  if (user) {
    this.assertAccountActive(user);
    if (!user.oauth?.googleId) {
      user.oauth = { googleId: googleUser.googleId };
      user.authProvider = 'google';
      await user.save();
    }
  }

  // If user does NOT exist, create OAuth user
  if (!user) {
    user = await this.userModel.create({
      email,
      password: null,
      authProvider: 'google',
      isVerified: true,
      oauth: { googleId: googleUser.googleId },
      profile: {
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        profileImage: googleUser.profileImage,
      },
      role: 'student',
    });
  }

  // Issue JWTs (REUSE existing logic)
  const tokens = await this.getTokens(
    user._id.toString(),
    user.email,
    user.role,
  );

  await this.updateRefreshToken(user._id.toString(), tokens.refreshToken);

  return {
    success: true,
    user: this.excludePassword(user),
    ...tokens,
  };
  }
}
