/* eslint-disable @typescript-eslint/no-unsafe-return */
// apps/api/src/modules/health/health.module.ts
// Uses direct ioredis connection for Redis check — no extra module needed.
// @nestjs/terminus handles Postgres + memory + disk checks natively.

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import Redis from 'ioredis';

// Provide a Redis client scoped to health module only
// This avoids needing @nestjs-modules/ioredis globally
const RedisProvider = {
  provide: 'HEALTH_REDIS',
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD'),
      lazyConnect: true, // don't fail at startup if Redis is briefly down
      maxRetriesPerRequest: 1,
    }),
};

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [RedisProvider],
})
export class HealthModule {}
