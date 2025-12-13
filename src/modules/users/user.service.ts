import {
  Injectable,
  Inject,
  ConflictException,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
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
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { CloudinaryService } from "../uploads/cloudinary.service";

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



//I will come and work on the user's profile image later 
//where the user will be able to update their profile image 
// I will first pass the image through cloudinary 
// and store the url in the database 

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  // ✅ CREATE USER (Signup)
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

  // 👇 Upload to Cloudinary if file was included
  if (uploadImage) {
    const uploaded = await this.cloudinaryService.uploadImage(uploadImage);
    profileImageUrl = uploaded.secure_url;
  }
    // Save user
    const newUser = new this.userModel({
      ...createUserDto,
      email,
      password: hashedPassword,
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
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    // Generate tokens
    const tokens = await this.getTokens(savedUser._id.toString(), savedUser.email,savedUser.role);
    await this.updateRefreshToken(savedUser._id.toString(), tokens.refreshToken);

    const safeUser = this.excludePassword(savedUser);

    this.logger.log(`User created & tokens generated: ${savedUser.email}`);
    return { user: safeUser, ...tokens };
  }

  // ✅ LOGIN
  async loginUser(
    loginDto: LoginDto
  ): Promise<{ user: SafeUser; accessToken: string; refreshToken: string }> {
    const email = loginDto.email.trim().toLowerCase();
    const password = loginDto.password;

    // Try cache first
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    let user: UserDocument | null = null;

    if (cachedUser) {
      user = await this.userModel.findById(cachedUser.id);
    } else {
      user = await this.userModel.findOne({ email });
    }

    // Validate
    if (!user) throw new NotFoundException("Invalid email or password");
    if (!user.password) {
  throw new UnauthorizedException("User does not have a password. Please login with Google.");
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new UnauthorizedException("Invalid email or password");

    // Generate tokens
    const tokens = await this.getTokens(user._id.toString(), user.email,user.role);
    await this.updateRefreshToken(user._id.toString(), tokens.refreshToken);

    // Cache for future
    const cacheUser: CacheUser = {
      id: user._id.toString(),
      email: user.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    const safeUser = this.excludePassword(user);

    this.logger.log(`User logged in successfully: ${email}`);
    return { user: safeUser, ...tokens };
  }

  // ✅ UPDATE PROFILE
async updateUser(
  userId: string,
  updateProfileDto: UpdateProfileDto,
  profileImage?: Express.Multer.File
): Promise<SafeUser> {
  const user = await this.userModel.findById(userId);
  if (!user) throw new NotFoundException("User not found");

  // 1️⃣ Upload image to Cloudinary if provided
  let uploadedImageUrl = null;

  if (profileImage) {
    const uploaded = await this.cloudinaryService.uploadImage(profileImage);
    uploadedImageUrl = uploaded.secure_url;
  }

  // 2️⃣ Merge profile fields
  if (updateProfileDto.profile) {
    user.profile = {
      ...user.profile,
      ...updateProfileDto.profile,
    };
  }

  // 3️⃣ Only add/replace profileImage if a new one was uploaded
  if (uploadedImageUrl) {
    user.profile.profileImage = uploadedImageUrl;
  }

  // 4️⃣ Save changes
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



    if (!user.password) {
  throw new UnauthorizedException("User does not have a password. Please login with Google.");
}

    const match = await bcrypt.compare(dto.oldPassword, user.password);
    if (!match) throw new UnauthorizedException("Old password is incorrect");

    const hashed = await bcrypt.hash(dto.newPassword, this.SALT_ROUNDS);
    user.password = hashed;
    await user.save();

    this.logger.log(`Password changed for ${user.email}`);
    return { success: true, message: "Password updated successfully" };
  }

  // ✅ FORGOT PASSWORD
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user) throw new NotFoundException("No account found for this email");

    const resetToken = randomBytes(32).toString("hex");
    await this.cacheManager.set(`reset:${resetToken}`, user._id.toString(), 900); // 15min

    const resetLink = `https://your-frontend-app.com/reset-password?token=${resetToken}`;
    const html = `
      <p>Hello ${user.profile?.firstName || "User"},</p>
      <p>You requested a password reset. Click below to set a new password:</p>
      <a href="${resetLink}" target="_blank">${resetLink}</a>
      <p>This link will expire in 15 minutes.</p>
    `;

    try {
      await this.mailService.sendEmail(email, "Reset your password", html);
    } catch (err) {
      this.logger.error(`Error sending reset email: ${err.message}`);
      throw new InternalServerErrorException("Could not send reset email");
    }

    this.logger.log(`Password reset link sent to ${email}`);
    return {
      success: true,
      message: "Password reset link sent to your email",
      resetToken, // remove in production
    };
  }

  // ✅ RESET PASSWORD
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

  // ✅ GET USER PROFILE
  async getUserProfile(userId: string): Promise<SafeUser> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("User not found");
    return this.excludePassword(user);
  }

  // ✅ VALIDATE USER (for auth guards)
  async validateUser(payload: any): Promise<SafeUser> {
    const user = await this.userModel.findById(payload.sub);
    if (!user) throw new UnauthorizedException("User not found");
    return this.excludePassword(user);
  }

  // ✅ LOGOUT
  async logOut(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { refreshToken: null });
    return { success: true, message: "User logged out successfully" };
  }

  // ✅ TOKEN HELPERS
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

    const refreshTokenMatches = await argon2.verify(
      user.refreshToken,
      refreshToken
    );

    if (!refreshTokenMatches) throw new ForbiddenException("Access Denied");

    const tokens = await this.getTokens(user.id, user.email,user.role);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  // ✅ Helper: exclude password field
  private excludePassword(user: UserDocument): SafeUser {
    const userObj = user.toObject ? user.toObject() : user;
    const { password, ...rest } = userObj;
    return rest as SafeUser;
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

  // 4️⃣ Issue JWTs (REUSE existing logic)
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
