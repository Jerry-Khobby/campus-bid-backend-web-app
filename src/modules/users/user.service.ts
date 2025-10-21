import { CreateUserDto } from "./dto/create-user.dto";
import { Injectable, Inject, NotFoundException, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { Model } from "mongoose"; // type import
import { User } from "./schema/user.schema"; // regular import (if used in runtime)

import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager"; // type import

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}
}