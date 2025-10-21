import { CreateUserDto } from "./dto/create-user.dto";
import {
  Injectable,
  Inject,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "./schema/user.schema"; // 👈 import UserDocument

import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";

interface CacheUser {
  id: string;
  email: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>, // 👈 use UserDocument
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService
  ) {}

  /** Create a new user with secure password hashing and redis caching */
  async createUser(createUserDto: CreateUserDto): Promise<Partial<User>> {
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
      id: savedUser._id.toString(), // ✅ convert ObjectId safely
      email: savedUser.email,
    };
    await this.cacheManager.set(`user:${email}`, cacheUser, 3600);

    // 6️⃣ Remove password before returning
    const safeUser = savedUser.toObject();
    delete safeUser.password;

    return safeUser;
  }
}
