/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
// apps/api/src/workers/bull-board.setup.ts
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QUEUE_NAMES } from '@app/common/queue/queue.constants';

export function setupBullBoard(app: INestApplication): void {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const queues = Object.values(QUEUE_NAMES).map((name) => {
    const queue = app.get<Queue>(getQueueToken(name));
    return new BullMQAdapter(queue);
  });

  createBullBoard({
    queues,
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

  console.log('[BullBoard] Queue monitor available at /admin/queues');
}

// ── main.ts ───────────────────────────────────────────────────────────────────
// import { setupBullBoard } from './workers/bull-board.setup';
//
// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);
//   setupBullBoard(app);
//   await app.listen(3000);
// }
