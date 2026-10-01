import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { Connection, Types } from "mongoose";
import { getAccountModelName, getAccountStatusCacheKey } from "../account-status";

// Bounds how long a suspension can lag behind for a still-valid access token.
const ACCOUNT_STATUS_CACHE_TTL_MS = 30_000;

type JwtPayload = {
  sub: string;
  email: string;
  role:string;
};

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @InjectConnection() private readonly connection: Connection,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback-access-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const isActive = await this.isAccountActive(payload);
    if (!isActive) throw new UnauthorizedException("This account is not active");
    return payload;
  }

  private async isAccountActive(payload: JwtPayload): Promise<boolean> {
    const cacheKey = getAccountStatusCacheKey(payload.role, payload.sub);
    const cachedStatus = await this.cacheManager.get<boolean>(cacheKey);
    if (typeof cachedStatus === "boolean") return cachedStatus;

    const isActive = await this.findAccountActiveStatus(payload);
    await this.cacheManager.set(cacheKey, isActive, ACCOUNT_STATUS_CACHE_TTL_MS);
    return isActive;
  }

  private async findAccountActiveStatus(payload: JwtPayload): Promise<boolean> {
    if (!Types.ObjectId.isValid(payload.sub)) return false;

    // A hydrated (non-lean) read applies each schema's isActive default to older documents.
    const account = await this.connection
      .model<{ isActive?: boolean }>(getAccountModelName(payload.role))
      .findById(payload.sub)
      .select("isActive");
    return account?.isActive === true;
  }
}
