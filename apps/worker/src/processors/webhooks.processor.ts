/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/workers/webhooks.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QUEUE_NAMES, WEBHOOK_JOBS } from '@app/common/queue/queue.constants';
import { MetaService } from 'apps/api/src/integrations/meta/services/meta.service';
import { SubscriptionService } from 'apps/api/src/modules/subscriptions/subscription.service';

@Processor(QUEUE_NAMES.WEBHOOKS, { concurrency: 20 })
@Injectable()
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    private readonly meta: MetaService,
    private readonly subscriptions: SubscriptionService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`[Webhooks] Processing ${job.name} id=${job.id}`);

    switch (job.name) {
      case WEBHOOK_JOBS.PROCESS_META:
        return this.handleMeta(job.data);
      case WEBHOOK_JOBS.PROCESS_PAYMENT:
        return this.handlePayment(job.data);
      case WEBHOOK_JOBS.PROCESS_SUBSCRIPTION:
        return this.handleSubscriptionWebhook(job.data);
      default:
        this.logger.warn(`[Webhooks] Unknown job: ${job.name}`);
    }
  }

  private async handleMeta(data: { body: any }) {
    await this.meta.ingestWebhook(data.body);
  }

  private async handlePayment(data: {
    provider: string;
    orgId: string;
    payload: any;
  }) {
    // Handled by PaymentsService.handleProviderWebhook
    // Import PaymentsService here if needed
    this.logger.log(
      `[Webhooks] Payment webhook from ${data.provider} for org ${data.orgId}`,
    );
  }

  private async handleSubscriptionWebhook(data: {
    provider: string;
    payload: any;
  }) {
    await this.subscriptions.handleWebhook(data.provider, data.payload);
  }
}
