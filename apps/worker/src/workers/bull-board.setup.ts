/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// apps/api/src/workers/bull-board.setup.ts
import { INestApplication, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QUEUE_NAMES } from '@app/common/queue/queue.constants';

const logger = new Logger('BullBoard');

export function setupBullBoard(app: INestApplication): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  // Collect only queues that are actually registered in the DI context.
  // Using try/catch per queue so a missing queue doesn't crash startup.
  const adapters: BullMQAdapter[] = [];

  for (const name of Object.values(QUEUE_NAMES)) {
    try {
      const queue = app.get<Queue>(getQueueToken(name));
      adapters.push(new BullMQAdapter(queue));
    } catch {
      logger.warn(
        `Queue "${name}" not found in DI context — skipping from Bull Board`,
      );
    }
  }

  if (adapters.length === 0) {
    logger.warn(
      'No queues found — Bull Board not mounted. Check WorkersModule is imported in AppModule.',
    );
    return;
  }

  createBullBoard({
    queues: adapters,
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'Xenlo Queue Monitor',
        boardLogo: { path: '/favicon.ico', width: 24, height: 24 },
      },
    },
  });

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.use('/admin/queues', serverAdapter.getRouter());

  logger.log(
    `Queue monitor mounted at /admin/queues (${adapters.length} queues)`,
  );
}
