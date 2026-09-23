import { CacheModuleAsyncOptions } from "@nestjs/cache-manager";
import { ConfigModule, ConfigService } from "@nestjs/config";
import KeyvRedis from "@keyv/redis";

export const RedisOptions: CacheModuleAsyncOptions = {
  isGlobal: true,
  imports: [ConfigModule],
  useFactory: async (configService: ConfigService) => {
    const host = configService.get<string>('REDIS_HOST');
    const port = configService.get<string>('REDIS_PORT');
    return { stores: new KeyvRedis(`redis://${host}:${port}`) };
  },
  inject: [ConfigService],
};