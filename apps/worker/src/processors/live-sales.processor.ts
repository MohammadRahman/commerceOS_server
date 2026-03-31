// apps/api/src/workers/live-sales.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QUEUE_NAMES, LIVE_SALE_JOBS } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import Redis from 'ioredis';
import { InjectRedis } from '@app/common/queue/redis.decorators';

@Processor(QUEUE_NAMES.LIVE_SALES, {
  concurrency: 50, // High concurrency for live volume
})
@Injectable()
export class LiveSalesProcessor extends WorkerHost {
  private readonly logger = new Logger(LiveSalesProcessor.name);

  constructor(
    private readonly queue: QueueService,
    @InjectRedis() private readonly redis: Redis,
  ) { super(); }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case LIVE_SALE_JOBS.PROCESS_COMMENT:
        return this.handleComment(job.data);
      case LIVE_SALE_JOBS.CREATE_ORDER:
        return this.handleCreateOrder(job.data);
      case LIVE_SALE_JOBS.SEND_PAYMENT_LINK:
        return this.handleSendPaymentLink(job.data);
      case LIVE_SALE_JOBS.UPDATE_COUNTERS:
        return this.handleUpdateCounters(job.data);
      default:
        this.logger.warn(`[LiveSales] Unknown job: ${job.name}`);
    }
  }

  private async handleComment(data: {
    liveSaleId: string;
    orgId: string;
    commentId: string;
    senderId: string;
    senderName: string;
    text: string;
    platform: string;
  }) {
    // Use Redis for deduplication (faster than DB for high-volume live events)
    const dedupKey = `live:comment:${data.liveSaleId}:${data.commentId}`;
    const alreadyProcessed = await this.redis.set(
      dedupKey, '1', 'EX', 3600, 'NX', // TTL 1hr, only set if not exists
    );
    if (!alreadyProcessed) {
      this.logger.debug(`[LiveSales] Duplicate comment ${data.commentId} skipped`);
      return;
    }

    // Check trigger keywords
    const triggerKeywords = ['WANT', 'want', 'ORDER', 'order', 'চাই', 'অর্ডার'];
    const hasIntent = triggerKeywords.some((k) => data.text.includes(k));

    if (hasIntent) {
      await this.queue.liveSale(LIVE_SALE_JOBS.CREATE_ORDER, data);
    }

    // Update live counters in Redis (atomic, no DB write needed for real-time display)
    await this.queue.liveSale(LIVE_SALE_JOBS.UPDATE_COUNTERS, {
      liveSaleId: data.liveSaleId,
      orgId: data.orgId,
      hasIntent,
    });
  }

  private async handleCreateOrder(data: {
    liveSaleId: string;
    orgId: string;
    senderId: string;
    senderName: string;
    platform: string;
  }) {
    this.logger.log(
      `[LiveSales] Creating order for ${data.senderName} in live ${data.liveSaleId}`,
    );
    // TODO: create order + enqueue payment link
    await this.queue.liveSale(LIVE_SALE_JOBS.SEND_PAYMENT_LINK, {
      liveSaleId: data.liveSaleId,
      orgId: data.orgId,
      senderId: data.senderId,
    });
  }

  private async handleSendPaymentLink(data: {
    liveSaleId: string;
    orgId: string;
    senderId: string;
    orderId?: string;
  }) {
    this.logger.log(
      `[LiveSales] Sending payment link for order ${data.orderId} in live ${data.liveSaleId}`,
    );
    // TODO: trigger auto-message with payment link
  }

  private async handleUpdateCounters(data: {
    liveSaleId: string;
    orgId: string;
    hasIntent: boolean;
  }) {
    const pipe = this.redis.pipeline();
    // Increment total comments
    pipe.incr(`live:${data.liveSaleId}:comments`);
    // Expire after 24h
    pipe.expire(`live:${data.liveSaleId}:comments`, 86400);
    if (data.hasIntent) {
      pipe.incr(`live:${data.liveSaleId}:orders`);
      pipe.expire(`live:${data.liveSaleId}:orders`, 86400);
    }
    await pipe.exec();
  }
}
