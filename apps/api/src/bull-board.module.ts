/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/bull-board.module.ts
// Registers BullMQ queues in the API app's DI context ONLY for Bull Board.
// Does NOT import WorkerModule (avoids circular deps with MetaModule,
// NotificationsModule etc. that are already in AppModule).

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@app/common/queue/queue.constants';

@Module({
  imports: [
    // Root BullMQ connection
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const parsed = new URL(url);
        return {
          connection: {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            password: parsed.password || undefined,
            username: parsed.username || undefined,
            tls: url.startsWith('rediss://') ? {} : undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    // Register all queues so app.get(getQueueToken(name)) resolves
    ...Object.values(QUEUE_NAMES).map((name) =>
      BullModule.registerQueue({ name }),
    ),
  ],
})
export class BullBoardModule {}
