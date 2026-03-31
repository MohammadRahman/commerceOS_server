/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/workers/subscriptions.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  QUEUE_NAMES,
  SUBSCRIPTION_JOBS,
} from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import { OrgPaymentProviderEntity } from 'apps/api/src/modules/providers/entities/org-payment-provider.entity';
import {
  SubscriptionPaymentEntity,
  PaymentStatus,
} from 'apps/api/src/modules/subscriptions/entities/subscription-payment.entity';
import { SubscriptionService } from 'apps/api/src/modules/subscriptions/subscription.service';

const SSL_SANDBOX_URL = 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
const SSL_LIVE_URL = 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';

@Processor(QUEUE_NAMES.SUBSCRIPTIONS, { concurrency: 5 })
@Injectable()
export class SubscriptionsProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionsProcessor.name);

  constructor(
    private readonly service: SubscriptionService,
    private readonly queue: QueueService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(SubscriptionPaymentEntity)
    private readonly payments: Repository<SubscriptionPaymentEntity>,
    @InjectRepository(OrgPaymentProviderEntity)
    private readonly orgProviders: Repository<OrgPaymentProviderEntity>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`[Subscriptions] Processing ${job.name} id=${job.id}`);

    switch (job.name) {
      case SUBSCRIPTION_JOBS.CHECK_TRIAL_EXPIRIES:
        return this.handleCheckTrialExpiries();
      case SUBSCRIPTION_JOBS.ACTIVATE_PLAN:
        return this.handleActivatePlan(job.data);
      case SUBSCRIPTION_JOBS.GENERATE_CHECKOUT:
        return this.handleGenerateCheckout(job.data);
      default:
        this.logger.warn(`[Subscriptions] Unknown job: ${job.name}`);
    }
  }

  // ─── Trial expiry check ────────────────────────────────────────────────────

  private async handleCheckTrialExpiries() {
    await this.service.checkTrialExpiries();
  }

  // ─── Activate plan ─────────────────────────────────────────────────────────

  private async handleActivatePlan(data: {
    subscriptionPaymentId: string;
    orgId: string;
  }) {
    this.logger.log(`[Subscriptions] Activating plan for org ${data.orgId}`);
    await this.service.confirmPayment(
      data.orgId,
      data.subscriptionPaymentId,
      'system',
    );
  }

  // ─── Generate checkout URL ─────────────────────────────────────────────────
  // Routes to the correct gateway based on provider.
  // SSLCommerz: calls init API, stores GatewayPageURL on the payment record.
  // Frontend polls GET /v1/subscription until checkoutUrl appears, then redirects.

  private async handleGenerateCheckout(data: {
    subscriptionPaymentId: string;
    plan: string;
    billingCycle: string;
    amount: number;
    provider: string;
  }) {
    const { subscriptionPaymentId, plan, billingCycle, amount, provider } =
      data;
    this.logger.log(
      `[Subscriptions] Generating ${provider} checkout for payment ${subscriptionPaymentId}`,
    );

    const payment = await this.payments.findOne({
      where: { id: subscriptionPaymentId } as any,
      relations: ['subscription'],
    });

    if (!payment) {
      this.logger.warn(
        `[Subscriptions] Payment ${subscriptionPaymentId} not found`,
      );
      return;
    }

    switch (provider) {
      case 'sslcommerz':
        await this.generateSSLCommerzCheckout(
          payment,
          plan,
          billingCycle,
          amount,
        );
        break;
      default:
        this.logger.warn(
          `[Subscriptions] Provider "${provider}" checkout not yet implemented — use bKash/Nagad manual flow`,
        );
    }
  }

  // ─── SSLCommerz checkout ───────────────────────────────────────────────────
  // Uses org's own SSLCommerz credentials if configured (merchant mode),
  // falls back to platform-wide env vars (SSLCOMMERZ_STORE_ID / STORE_PASS).

  private async generateSSLCommerzCheckout(
    payment: SubscriptionPaymentEntity,
    plan: string,
    billingCycle: string,
    amount: number,
  ): Promise<void> {
    const orgId = payment.orgId;

    // Load org's SSLCommerz provider config
    const orgProvider = await this.orgProviders.findOne({
      where: { orgId, type: 'sslcommerz' as any } as any,
    });

    // Credentials: org config → platform env vars
    const storeId =
      orgProvider?.config?.storeId ??
      this.config.get<string>('SSLCOMMERZ_STORE_ID');
    const storePass =
      orgProvider?.config?.storePass ??
      orgProvider?.config?.storePassword ??
      this.config.get<string>('SSLCOMMERZ_STORE_PASS');

    if (!storeId || !storePass) {
      this.logger.error(
        `[Subscriptions] No SSLCommerz credentials for org ${orgId}`,
      );
      await this.payments.update(
        { id: payment.id } as any,
        {
          status: PaymentStatus.FAILED,
          failureReason: 'SSLCommerz credentials not configured',
        } as any,
      );
      return;
    }

    const isSandbox = this.config.get<string>('NODE_ENV') !== 'production';
    const sslUrl = isSandbox ? SSL_SANDBOX_URL : SSL_LIVE_URL;
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    const apiUrl = this.config.get<string>('API_URL') ?? frontendUrl;

    // Short reference — used in webhook to re-identify the payment
    const tranId = `SUB-${payment.id.slice(0, 8).toUpperCase()}`;

    const params = new URLSearchParams({
      store_id: storeId,
      store_passwd: storePass,
      total_amount: String(amount),
      currency: 'BDT',
      tran_id: tranId,
      product_name: `${plan} Plan (${billingCycle})`,
      product_category: 'SaaS Subscription',
      product_profile: 'non-physical-goods',
      // Minimal customer info required by SSLCommerz
      cus_name: 'Subscriber',
      cus_email: 'subscriber@xenlo.app',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      cus_phone: '01700000000',
      // Gateway redirects
      success_url: `${apiUrl}/v1/webhooks/subscription/sslcommerz?status=success&payment_id=${payment.id}`,
      fail_url: `${apiUrl}/v1/webhooks/subscription/sslcommerz?status=failed&payment_id=${payment.id}`,
      cancel_url: `${frontendUrl}/subscription?cancelled=1`,
      ipn_url: `${apiUrl}/v1/webhooks/subscription/sslcommerz`,
      // Custom fields — passed back verbatim in webhook for easy lookup
      value_a: payment.id,
      value_b: orgId,
      value_c: plan,
      value_d: billingCycle,
    });

    try {
      const { data: sslRes } = await firstValueFrom(
        this.http.post(sslUrl, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000,
        }),
      );

      if (sslRes?.status !== 'SUCCESS' || !sslRes?.GatewayPageURL) {
        throw new Error(
          sslRes?.failedreason ?? 'SSLCommerz: no GatewayPageURL in response',
        );
      }

      const checkoutUrl: string = sslRes.GatewayPageURL;

      // Store the checkout URL so the frontend can redirect to it.
      // We reuse rawPayload to store the full SSL response for debugging.
      await this.payments.update(
        { id: payment.id } as any,
        {
          providerRef: tranId,
          rawPayload: {
            checkoutUrl,
            sessionKey: sslRes.sessionkey ?? '',
            tranId,
            generatedAt: new Date().toISOString(),
          },
        } as any,
      );

      this.logger.log(
        `[Subscriptions] SSLCommerz checkout ready for ${payment.id}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[Subscriptions] SSLCommerz init failed for ${payment.id}: ${err?.message}`,
      );
      await this.payments.update(
        { id: payment.id } as any,
        {
          status: PaymentStatus.FAILED,
          failureReason: err?.message ?? 'SSLCommerz init error',
        } as any,
      );
    }
  }

  // ─── Cron: daily trial expiry check ───────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async scheduleTrialExpiries() {
    this.logger.log('[Subscriptions] Scheduling daily trial expiry check');
    await this.queue.subscription(SUBSCRIPTION_JOBS.CHECK_TRIAL_EXPIRIES, {});
  }
}
