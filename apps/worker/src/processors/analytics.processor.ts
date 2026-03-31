/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/workers/analytics.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { QUEUE_NAMES, ANALYTICS_JOBS } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import Redis from 'ioredis';
import { InjectRedis } from '@app/common/queue/redis.decorators';

// Analytics strategy:
//  - Every hour: roll up messages, orders, revenue per org into analytics_hourly
//  - Every day at 1 AM: roll up hourly into analytics_daily
//  - Real-time counters live in Redis (TTL 25h for hourly, 8d for daily)

@Processor(QUEUE_NAMES.ANALYTICS, { concurrency: 3 })
@Injectable()
export class AnalyticsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: QueueService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ANALYTICS_JOBS.ROLLUP_HOURLY:
        return this.handleHourlyRollup(job.data);
      case ANALYTICS_JOBS.ROLLUP_DAILY:
        return this.handleDailyRollup(job.data);
      case ANALYTICS_JOBS.ROLLUP_ORG:
        return this.handleOrgRollup(job.data);
      default:
        this.logger.warn(`[Analytics] Unknown job: ${job.name}`);
    }
  }

  // ── Cron: hourly rollup ──────────────────────────────────────────────────
  @Cron('0 * * * *') // every hour on the hour
  async scheduleHourlyRollup() {
    this.logger.log('[Analytics] Scheduling hourly rollup');
    await this.queue.analytics(ANALYTICS_JOBS.ROLLUP_HOURLY, {
      hour: new Date().toISOString(),
    });
  }

  // ── Cron: daily rollup at 1 AM ───────────────────────────────────────────
  @Cron('0 1 * * *')
  async scheduleDailyRollup() {
    this.logger.log('[Analytics] Scheduling daily rollup');
    await this.queue.analytics(ANALYTICS_JOBS.ROLLUP_DAILY, {
      date: new Date().toISOString(),
    });
  }

  private async handleHourlyRollup(data: { hour: string }) {
    const hourStart = new Date(data.hour);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 3600 * 1000);

    // Aggregate orders per org for this hour
    const orderStats = await this.dataSource.query(
      `
      SELECT
        org_id,
        COUNT(*)::int          AS order_count,
        COALESCE(SUM(total), 0) AS revenue
      FROM orders
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY org_id
    `,
      [hourStart, hourEnd],
    );

    // Aggregate messages per org for this hour
    const messageStats = await this.dataSource.query(
      `
      SELECT org_id, COUNT(*)::int AS message_count
      FROM messages
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY org_id
    `,
      [hourStart, hourEnd],
    );

    const msgMap = new Map(
      messageStats.map((r: any) => [r.org_id, r.message_count]),
    );

    // Upsert into analytics_hourly
    for (const row of orderStats) {
      await this.dataSource.query(
        `
        INSERT INTO analytics_hourly
          (org_id, hour_start, order_count, revenue, message_count, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (org_id, hour_start) DO UPDATE
          SET order_count   = EXCLUDED.order_count,
              revenue       = EXCLUDED.revenue,
              message_count = EXCLUDED.message_count
      `,
        [
          row.org_id,
          hourStart,
          row.order_count,
          row.revenue,
          msgMap.get(row.org_id) ?? 0,
        ],
      );

      // Also cache in Redis for real-time dashboard (TTL 25h)
      const redisKey = `analytics:hourly:${row.org_id}:${hourStart.toISOString()}`;
      await this.redis.setex(
        redisKey,
        90000, // 25 hours
        JSON.stringify({
          orderCount: row.order_count,
          revenue: row.revenue,
          messageCount: msgMap.get(row.org_id) ?? 0,
        }),
      );
    }

    this.logger.log(
      `[Analytics] Hourly rollup complete for ${orderStats.length} orgs`,
    );
  }

  private async handleDailyRollup(data: { date: string }) {
    const dayStart = new Date(data.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400 * 1000);

    // Roll up hourly → daily
    await this.dataSource.query(
      `
      INSERT INTO analytics_daily
        (org_id, date, order_count, revenue, message_count, created_at)
      SELECT
        org_id,
        $1::date,
        SUM(order_count)::int,
        SUM(revenue),
        SUM(message_count)::int,
        now()
      FROM analytics_hourly
      WHERE hour_start >= $1 AND hour_start < $2
      GROUP BY org_id
      ON CONFLICT (org_id, date) DO UPDATE
        SET order_count   = EXCLUDED.order_count,
            revenue       = EXCLUDED.revenue,
            message_count = EXCLUDED.message_count
    `,
      [dayStart, dayEnd],
    );

    this.logger.log(
      `[Analytics] Daily rollup complete for ${dayStart.toDateString()}`,
    );
  }

  private async handleOrgRollup(data: { orgId: string }) {
    // On-demand rollup for a single org (triggered after order/message events)
    this.logger.log(`[Analytics] On-demand rollup for org ${data.orgId}`);
  }
}
