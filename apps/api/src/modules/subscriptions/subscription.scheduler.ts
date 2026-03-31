/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/subscriptions/subscription.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionScheduler {
  private readonly logger = new Logger(SubscriptionScheduler.name);

  constructor(private readonly service: SubscriptionService) {}

  // Run every day at 9 AM UTC to check trial expiries
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleTrialExpiries() {
    this.logger.log('[Scheduler] Checking trial expiries...');
    try {
      await this.service.checkTrialExpiries();
    } catch (err: any) {
      this.logger.error('[Scheduler] Trial expiry check failed:', err?.message);
    }
  }
}
