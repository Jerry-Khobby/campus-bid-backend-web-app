import { CacheModuleAsyncOptions } from "@nestjs/cache-manager";
import { ConfigModule, ConfigService } from "@nestjs/config";
import KeyvRedis from "@keyv/redis";

export const RedisOptions: CacheModuleAsyncOptions = {
  isGlobal: true,
  imports: [ConfigModule],
  useFactory: async (configService: ConfigService) => {
    // Hosted Redis providers (Upstash, Redis Cloud, etc.) issue one
    // password-and-TLS-bearing connection string (rediss://...) rather than
    // separate host/port — REDIS_URL takes priority when set. REDIS_HOST/PORT
    // stays as the local-dev fallback for an unauthenticated Redis instance.
    const url = configService.get<string>('REDIS_URL');
    if (url) return { stores: new KeyvRedis(url) };

    const host = configService.get<string>('REDIS_HOST');
    const port = configService.get<string>('REDIS_PORT');
    return { stores: new KeyvRedis(`redis://${host}:${port}`) };
  },
  inject: [ConfigService],
};