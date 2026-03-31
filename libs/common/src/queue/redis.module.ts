/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// libs/common/src/queue/redis.module.ts
// Shared module that provides:
//  - Redis connection (ioredis) as REDIS_CLIENT token
//  - BullMQ queue instances for all 7 queues
//  - Shared queue config (retry, backoff, concurrency defaults)
//
// Import RedisModule in any NestJS module that needs queue access.

import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from './queue.constants';

export const REDIS_CLIENT = 'REDIS_CLIENT';

// ─── Default job options per queue ───────────────────────────────────────────

export const QUEUE_DEFAULT_JOB_OPTIONS = {
  [QUEUE_NAMES.NOTIFICATIONS]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
  [QUEUE_NAMES.WEBHOOKS]: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 1000 },
  },
  [QUEUE_NAMES.SUBSCRIPTIONS]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
  [QUEUE_NAMES.COMMENTS]: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
  [QUEUE_NAMES.LIVE_SALES]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 500 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
  [QUEUE_NAMES.ARCHIVAL]: {
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 30000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
  [QUEUE_NAMES.ANALYTICS]: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
};

// ─── Redis provider factory ───────────────────────────────────────────────────

const RedisProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');
    const client = new Redis(url, {
      maxRetriesPerRequest: null, // required for BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });

    client.on('connect', () => console.log('[Redis] Connected'));
    client.on('error', (err) => console.error('[Redis] Error:', err.message));

    return client;
  },
};

// ─── BullMQ module registration ───────────────────────────────────────────────

const BullMQRootModule = BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    connection: {
      host: new URL(config.getOrThrow<string>('REDIS_URL')).hostname,
      port:
        Number(new URL(config.getOrThrow<string>('REDIS_URL')).port) || 6379,
      password:
        new URL(config.getOrThrow<string>('REDIS_URL')).password || undefined,
      tls: config.getOrThrow<string>('REDIS_URL').startsWith('rediss://')
        ? {}
        : undefined,
      maxRetriesPerRequest: null,
    },
  }),
});

// Register all 7 queues
const RegisteredQueues = Object.values(QUEUE_NAMES).map((name) =>
  BullModule.registerQueue({
    name,
    defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS[name],
  }),
);

@Global()
@Module({
  imports: [ConfigModule, BullMQRootModule, ...RegisteredQueues],
  providers: [RedisProvider],
  exports: [REDIS_CLIENT, BullMQRootModule, ...RegisteredQueues],
})
export class RedisModule {}
