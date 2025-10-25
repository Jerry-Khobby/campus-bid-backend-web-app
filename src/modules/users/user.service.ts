import {
  Injectable,
  Inject,
  ConflictException,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { randomBytes } from "crypto";

import { User, UserDocument } from "./schema/user.schema";
import { CreateUserDto } from "./dto/create-user.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";
import { UpdatePaymentMethodDto } from "./dto/update-payment-method.dto";
import { MailService } from "src/utils/mail.service";

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

// We are supposed to take care of handling the image 
// the user's image , and how it is been stored in the database 
// We would first , have an account in cloudinary , 
// host all images first there and 
// store the url of those image in our database 
// 

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService
  ) {}

  // ✅ CREATE USER (Signup)
  async createUser(
    createUserDto: CreateUserDto
  ): Promise<{ user: SafeUser; token: string }> {
    const email = createUserDto.email.trim().toLowerCase();

    // 1️⃣ Check cache or DB for existing user
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    if (cachedUser) throw new ConflictException("User already exists");

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) throw new ConflictException("Email already registered");

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      this.SALT_ROUNDS
    );

    // 3️⃣ Save user
    const newUser = new this.userModel({
      ...createUserDto,
      email,
      password: hashedPassword,
    });

    let savedUser: UserDocument;
    try {
      savedUser = await newUser.save();
    } catch (err) {
      this.logger.error("Error saving new user", err);
      throw new InternalServerErrorException("Failed to create user");
    }

    // 4️⃣ Cache minimal user info
    const cacheUser: CacheUser = {
      id: savedUser._id.toString(),
      email: savedUser.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    // 5️⃣ Generate JWT immediately (auto login after signup)
    const payload = { sub: savedUser._id, email: savedUser.email };
    const token = await this.jwtService.signAsync(payload);

    const safeUser = this.excludePassword(savedUser);

    this.logger.log(`User created & JWT generated: ${savedUser.email}`);
    return { user: safeUser, token };
  }

  // ✅ LOGIN
  async loginUser(loginDto: LoginDto): Promise<{ user: SafeUser; token: string }> {
    const email = loginDto.email.trim().toLowerCase();
    const password = loginDto.password;

    // 1️⃣ Try cache first
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    let user: UserDocument | null = null;

    if (cachedUser) {
      this.logger.log(`User found in cache: ${email}`);
      user = await this.userModel.findById(cachedUser.id);
    } else {
      user = await this.userModel.findOne({ email });
    }

    // 2️⃣ Validate
    if (!user) throw new NotFoundException("Invalid email or password");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException("Invalid email or password");

    // 3️⃣ JWT
    const payload = { sub: user._id, email: user.email };
    const token = await this.jwtService.signAsync(payload);

    // 4️⃣ Cache for future
    const cacheUser: CacheUser = {
      id: user._id.toString(),
      email: user.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    const safeUser = this.excludePassword(user);

    this.logger.log(`User logged in successfully: ${email}`);
    return { user: safeUser, token };
  }

  // ✅ UPDATE PROFILE
  async updateUser(userId: string, updateProfileDto: UpdateProfileDto): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    if (updateProfileDto.profile) {
      user.profile = { ...user.profile, ...updateProfileDto.profile };
    }

    await user.save();
    const safeUser = this.excludePassword(user);

    this.logger.log(`User ${user.email} updated profile successfully`);
    return safeUser;
  }

  // ✅ UPDATE ADDRESS
  async updateAddress(userId: string, addressDto: UpdateAddressDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const existing = user.addresses.find(
      (a) => a.label === addressDto.label
    );

    if (existing) Object.assign(existing, addressDto);
    else user.addresses.push(addressDto as any);

    await user.save();
    this.logger.log(`Address updated for ${user.email}`);
    return user.addresses;
  }

  // ✅ UPDATE PAYMENT METHOD
  async updatePaymentMethod(userId: string, paymentDto: UpdatePaymentMethodDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const existing = user.paymentMethods.find(
      (p) => p.last4 === paymentDto.last4
    );

    if (existing) Object.assign(existing, paymentDto);
    else user.paymentMethods.push(paymentDto as any);

    await user.save();
    this.logger.log(`Payment method updated for ${user.email}`);
    return user.paymentMethods;
  }

  // ✅ CHANGE PASSWORD
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const match = await bcrypt.compare(dto.oldPassword, user.password);
    if (!match) throw new UnauthorizedException("Old password is incorrect");

    const hashed = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    user.password = hashed;
    await user.save();

    this.logger.log(`Password changed for ${user.email}`);
    return { success: true, message: "Password updated successfully" };
  }

  // ✅ FORGOT PASSWORD (Generate Reset Token)
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user) throw new NotFoundException("No account found for this email");

    const resetToken = randomBytes(32).toString("hex");
    await this.cacheManager.set(`reset:${resetToken}`, user._id.toString(), 900); // 15min

    // 📧 Send reset link (mock or integrate with mail service)
    const resetLink = `https://your-frontend-app.com/reset-password?token=${resetToken}`;

  const html = `
    <p>Hello ${user.profile?.firstName || "User"},</p>
    <p>You requested a password reset. Click below to set a new password:</p>
    <a href="${resetLink}" target="_blank">${resetLink}</a>
    <p>This link will expire in 15 minutes.</p>
  `;
  try{
    await this.mailService.sendEmail(email, "Reset your password", html);

  }catch(err){
    this.logger.error(`Error sending reset email: ${err.message}`);
    throw new InternalServerErrorException("Could not send reset email")
  }
  this.logger.log(`Password reset link sent to ${email}`);
    return {
      success: true,
      message: "Password reset link sent to your email",
      resetToken, // remove in prod, only for testing
    };
  }

  // ✅ RESET PASSWORD (with token)
  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.cacheManager.get<string>(`reset:${dto.token}`);
    if (!userId) throw new UnauthorizedException("Invalid or expired reset token");

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    const hashed = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    user.password = hashed;
    await user.save();

    await this.cacheManager.del(`reset:${dto.token}`);
    this.logger.log(`Password reset successful for ${user.email}`);

    return { success: true, message: "Password has been reset successfully" };
  }

  // ✅ GET USER PROFILE (without password)
  async getUserProfile(userId: string): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");

    return this.excludePassword(user);
  }

  // ✅ PRIVATE HELPER: Exclude password from user object
  private excludePassword(user: UserDocument): SafeUser {
    const userObj = user.toObject ? user.toObject() : user;
    
    // Create a new object without the password field
    const { password, ...userWithoutPassword } = userObj;
    
    return userWithoutPassword as SafeUser;
  }

  // ✅ VALIDATE USER (for auth guards)
  async validateUser(payload: any): Promise<SafeUser> {
    const user = await this.userModel.findById(payload.sub);
    if (!user) throw new UnauthorizedException("User not found");
    
    return this.excludePassword(user);
  }



  //I want to Log out a user 
  async logOut(){

  }
}