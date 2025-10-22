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
import { User, UserDocument } from "./schema/user.schema";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { CreateUserDto } from "./dto/create-user.dto";
import { LoginDto } from "./dto/login.dto";

interface CacheUser {
  id: string;
  email: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService
  ) {}

  // ✅ Create User (already correct)
  async createUser(
    createUserDto: CreateUserDto
  ): Promise<{ user: any; token: string }> {
    const email = createUserDto.email.trim().toLowerCase();

    // 1️⃣ Check cache for existing user
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    if (cachedUser) {
      this.logger.warn(`User found in cache: ${email}`);
      throw new ConflictException("User already exists");
    }

    // 2️⃣ Check database
    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    // 3️⃣ Hash password securely
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      this.SALT_ROUNDS
    );

    // 4️⃣ Create and save user
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

    // 5️⃣ Cache safe user data
    const cacheUser: CacheUser = {
      id: savedUser._id.toString(),
      email: savedUser.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    // 6️⃣ Remove password before returning
    const safeUser = savedUser.toObject();
    delete safeUser.password;

    // 7️⃣ Generate JWT token
    const payload = { sub: savedUser._id, email: savedUser.email };
    const token = await this.jwtService.signAsync(payload);
    this.logger.log(`JWT generated for: ${savedUser.email}`);

    return { user: safeUser, token };
  }

  // ✅ LOGIN FUNCTION
  async loginUser(loginDto: LoginDto): Promise<{ user: any; token: string }> {
    const email = loginDto.email.trim().toLowerCase();
    const password = loginDto.password;

    // 1️⃣ Try fetching from cache first
    const cachedUser = await this.cacheManager.get<CacheUser>(`user:${email}`);
    let user: UserDocument | null = null;

    if (cachedUser) {
      this.logger.log(`User found in cache: ${email}`);
      // fetch from DB for password verification
      user = await this.userModel.findById(cachedUser.id);
    } else {
      // fallback to DB
      user = await this.userModel.findOne({ email });
    }

    // 2️⃣ If user not found
    if (!user) {
      this.logger.warn(`Login failed: user not found (${email})`);
      throw new NotFoundException("Invalid email or password");
    }

    // 3️⃣ Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      this.logger.warn(`Invalid password for user: ${email}`);
      throw new UnauthorizedException("Invalid email or password");
    }

    // 4️⃣ Generate JWT
    const payload = { sub: user._id, email: user.email };
    const token = await this.jwtService.signAsync(payload);

    // 5️⃣ Cache user info for future
    const cacheUser: CacheUser = {
      id: user._id.toString(),
      email: user.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    // 6️⃣ Remove password before sending
    const safeUser = user.toObject();
    delete safeUser.password;

    this.logger.log(`User logged in successfully: ${email}`);
    return { user: safeUser, token };
  }
}
