/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// libs/common/src/throttler/throttler.module.ts
//
// Usage in any module:
//   imports: [AppThrottlerModule]
//
// Usage on a controller/handler:
//   @UseGuards(ThrottlerGuard)
//   @Throttle({ default: { limit: 5, ttl: 60000 } })
//
// Or use the named presets below:
//   @Throttle(THROTTLE_AUTH)     — login/register: 5 req/15min
//   @Throttle(THROTTLE_INVITE)   — invites: 10 req/hour
//   @Throttle(THROTTLE_API)      — general API: 100 req/min

import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// ── Named rate-limit presets ──────────────────────────────────────────────────

export const THROTTLE_AUTH = {
  auth: { limit: 25, ttl: 15 * 60 * 1000 }, // 25 attempts per 15 minutes
};

export const THROTTLE_INVITE = {
  invite: { limit: 10, ttl: 60 * 60 * 1000 }, // 10 invites per hour
};

export const THROTTLE_API = {
  api: { limit: 100, ttl: 60 * 1000 }, // 100 requests per minute
};

// ── Module ────────────────────────────────────────────────────────────────────

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          // Default fallback if no @Throttle decorator used
          { name: 'default', limit: 200, ttl: 60_000 },
          // Auth endpoints — tight limit
          { name: 'auth', limit: 25, ttl: 15 * 60_000 },
          // Invite endpoints
          { name: 'invite', limit: 10, ttl: 60 * 60_000 },
          // General API
          { name: 'api', limit: 100, ttl: 60_000 },
        ],
        // Redis-backed storage so limits work across multiple API instances
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get<string>('REDIS_PASSWORD'),
            keyPrefix: 'throttle:',
          }),
        ),
        // Use real IP — works behind Nginx/ALB with X-Forwarded-For
        getTracker: (req: Record<string, any>) => {
          const forwarded = req.headers?.['x-forwarded-for'] as string;
          return forwarded
            ? forwarded.split(',')[0].trim()
            : (req.ip as string);
        },
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
