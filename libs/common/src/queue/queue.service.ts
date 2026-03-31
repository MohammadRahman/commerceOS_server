/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// libs/common/src/queue/queue.service.ts
// Drop-in replacement for OutboxService.
// Enqueues jobs to BullMQ instead of writing to Postgres.
// OutboxService can delegate to this once migration is complete.

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { QUEUE_NAMES, QueueName } from './queue.constants';
import { QUEUE_DEFAULT_JOB_OPTIONS } from './redis.module';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues: Map<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private notifQ: Queue,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) private webhookQ: Queue,
    @InjectQueue(QUEUE_NAMES.SUBSCRIPTIONS) private subQ: Queue,
    @InjectQueue(QUEUE_NAMES.COMMENTS) private commentQ: Queue,
    @InjectQueue(QUEUE_NAMES.LIVE_SALES) private liveQ: Queue,
    @InjectQueue(QUEUE_NAMES.ARCHIVAL) private archivalQ: Queue,
    @InjectQueue(QUEUE_NAMES.ANALYTICS) private analyticsQ: Queue,
  ) {
    this.queues = new Map([
      [QUEUE_NAMES.NOTIFICATIONS, notifQ],
      [QUEUE_NAMES.WEBHOOKS, webhookQ],
      [QUEUE_NAMES.SUBSCRIPTIONS, subQ],
      [QUEUE_NAMES.COMMENTS, commentQ],
      [QUEUE_NAMES.LIVE_SALES, liveQ],
      [QUEUE_NAMES.ARCHIVAL, archivalQ],
      [QUEUE_NAMES.ANALYTICS, analyticsQ],
    ]);
  }

  // ─── Core enqueue ─────────────────────────────────────────────────────────

  async enqueue<T = any>(
    queue: QueueName,
    jobName: string,
    data: T,
    options?: JobsOptions,
  ): Promise<string> {
    const q = this.queues.get(queue);
    if (!q) throw new Error(`Unknown queue: ${queue}`);

    const job = await q.add(jobName, data, {
      ...QUEUE_DEFAULT_JOB_OPTIONS[queue],
      ...options,
    });

    this.logger.debug(`[Queue] Enqueued ${queue}:${jobName} job=${job.id}`);
    return job.id!;
  }

  // ─── Delayed job (schedule at exact time) ─────────────────────────────────

  async enqueueAt<T = any>(
    queue: QueueName,
    jobName: string,
    data: T,
    runAt: Date,
  ): Promise<string> {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    return this.enqueue(queue, jobName, data, { delay });
  }

  // ─── Bulk enqueue (for batch operations) ─────────────────────────────────

  async enqueueBulk<T = any>(
    queue: QueueName,
    jobs: { name: string; data: T; options?: JobsOptions }[],
  ): Promise<void> {
    const q = this.queues.get(queue);
    if (!q) throw new Error(`Unknown queue: ${queue}`);

    const defaults = QUEUE_DEFAULT_JOB_OPTIONS[queue];
    await q.addBulk(
      jobs.map((j) => ({
        name: j.name,
        data: j.data,
        opts: { ...defaults, ...j.options },
      })),
    );

    this.logger.debug(`[Queue] Bulk enqueued ${jobs.length} jobs to ${queue}`);
  }

  // ─── Convenience shortcuts ─────────────────────────────────────────────────

  async notify(jobName: string, data: any, options?: JobsOptions) {
    return this.enqueue(QUEUE_NAMES.NOTIFICATIONS, jobName, data, options);
  }

  async webhook(jobName: string, data: any) {
    return this.enqueue(QUEUE_NAMES.WEBHOOKS, jobName, data, { priority: 1 });
  }

  async subscription(jobName: string, data: any, runAt?: Date) {
    if (runAt)
      return this.enqueueAt(QUEUE_NAMES.SUBSCRIPTIONS, jobName, data, runAt);
    return this.enqueue(QUEUE_NAMES.SUBSCRIPTIONS, jobName, data);
  }

  async comment(jobName: string, data: any) {
    return this.enqueue(QUEUE_NAMES.COMMENTS, jobName, data);
  }

  async liveSale(jobName: string, data: any) {
    // Live sale jobs get high priority
    return this.enqueue(QUEUE_NAMES.LIVE_SALES, jobName, data, { priority: 1 });
  }

  async archive(jobName: string, data: any) {
    return this.enqueue(QUEUE_NAMES.ARCHIVAL, jobName, data, { priority: 10 });
  }

  async analytics(jobName: string, data: any) {
    return this.enqueue(QUEUE_NAMES.ANALYTICS, jobName, data, { priority: 5 });
  }

  // ─── Queue stats (for Bull Board / admin) ─────────────────────────────────

  async getStats() {
    const stats: Record<string, any> = {};
    for (const [name, q] of this.queues) {
      const counts = await q.getJobCounts(
        'active',
        'waiting',
        'completed',
        'failed',
        'delayed',
      );
      stats[name] = counts;
    }
    return stats;
  }
}
