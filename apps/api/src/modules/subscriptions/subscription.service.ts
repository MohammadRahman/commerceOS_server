/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/subscriptions/subscription.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
import { OutboxService } from '@app/common';
import {
  BillingCycle,
  SubscriptionEntity,
  SubscriptionPlan,
  SubscriptionStatus,
} from './entities/subscription.entity';
import {
  SubscriptionPaymentEntity,
  PaymentStatus,
} from './entities/subscription-payment.entity';

// ─── Plan pricing (BDT) ───────────────────────────────────────────────────────

export const PLAN_PRICING: Record<
  SubscriptionPlan,
  Record<BillingCycle, number>
> = {
  [SubscriptionPlan.FREE]: {
    [BillingCycle.MONTHLY]: 0,
    [BillingCycle.ANNUAL]: 0,
    [BillingCycle.ONE_TIME]: 0,
  },
  [SubscriptionPlan.PRO]: {
    [BillingCycle.MONTHLY]: 2999,
    [BillingCycle.ANNUAL]: 28799, // ~20% discount vs monthly
    [BillingCycle.ONE_TIME]: 2999,
  },
  [SubscriptionPlan.ENTERPRISE]: {
    [BillingCycle.MONTHLY]: 9999,
    [BillingCycle.ANNUAL]: 95990, // ~20% discount
    [BillingCycle.ONE_TIME]: 9999,
  },
};

export const TRIAL_DAYS = 7;

// ─── Detect payment mode (mirrors PaymentsService logic) ─────────────────────

function detectPaymentMode(config: any): 'merchant' | 'personal' {
  if (!config) return 'personal';
  return config.apiKey || config.storeId || config.merchantId
    ? 'merchant'
    : 'personal';
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(SubscriptionEntity)
    private subs: Repository<SubscriptionEntity>,
    @InjectRepository(SubscriptionPaymentEntity)
    private payments: Repository<SubscriptionPaymentEntity>,
    @InjectRepository(OrganizationEntity)
    private orgs: Repository<OrganizationEntity>,
    @InjectRepository(OrgPaymentProviderEntity)
    private orgProviders: Repository<OrgPaymentProviderEntity>,
    private dataSource: DataSource,
    private outbox: OutboxService,
    private config: ConfigService,
  ) {}

  // ─── Get or create subscription for org ────────────────────────────────────

  async getOrCreate(orgId: string): Promise<SubscriptionEntity> {
    let sub: SubscriptionEntity | null = await this.subs.findOne({
      where: { orgId } as any,
      relations: ['payments'],
    });

    if (!sub) {
      const org = await this.orgs.findOne({ where: { id: orgId } as any });
      const trialStart =
        (org as any)?.trialStartedAt ?? org?.createdAt ?? new Date();

      sub = (await this.subs.save(
        this.subs.create({
          orgId,
          plan: SubscriptionPlan.FREE,
          status: SubscriptionStatus.TRIAL,
          billingCycle: BillingCycle.MONTHLY,
          amount: 0,
          trialStartedAt: trialStart,
          autoRenew: true,
          payments: [],
        } as any),
      )) as unknown as SubscriptionEntity;
    }

    return sub;
  }

  // ─── Get subscription with payment history ──────────────────────────────────

  async getSubscription(orgId: string) {
    const sub = await this.getOrCreate(orgId);
    const payments = await this.payments.find({
      where: { subscriptionId: sub.id } as any,
      order: { createdAt: 'DESC' } as any,
      take: 20,
    });

    const trialDaysRemaining = this.getTrialDaysRemaining(sub.trialStartedAt);
    const isTrialActive =
      trialDaysRemaining > 0 && sub.status === SubscriptionStatus.TRIAL;

    return {
      ...sub,
      payments,
      trialDaysRemaining,
      isTrialActive,
      isTrialExpired:
        sub.status === SubscriptionStatus.TRIAL && trialDaysRemaining <= 0,
    };
  }

  // ─── Initiate plan change (creates pending payment) ─────────────────────────

  async initiatePlanChange(
    orgId: string,
    plan: SubscriptionPlan,
    billingCycle: BillingCycle,
    paymentProvider: string,
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot purchase free plan');
    }

    const sub = await this.getOrCreate(orgId);
    const amount = PLAN_PRICING[plan][billingCycle];

    if (amount === 0) {
      throw new BadRequestException('Invalid plan/cycle combination');
    }

    // Check if provider is configured for this org
    const orgProvider = await this.orgProviders.findOne({
      where: { orgId, type: paymentProvider as any } as any,
    });

    const mode = detectPaymentMode(orgProvider?.config);

    // Calculate billing period
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === BillingCycle.MONTHLY) {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else if (billingCycle === BillingCycle.ANNUAL) {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      // ONE_TIME — no renewal
      periodEnd.setFullYear(periodEnd.getFullYear() + 100);
    }

    // Create pending payment record
    const payment = (await this.payments.save(
      this.payments.create({
        orgId,
        subscriptionId: sub.id,
        amount,
        currency: 'BDT',
        paymentProvider,
        status: PaymentStatus.PENDING,
        periodStart: now,
        periodEnd,
      } as any),
    )) as unknown as SubscriptionPaymentEntity;

    // Generate payment instructions for personal mode (bKash/Nagad personal)
    let instruction: any = null;
    if (mode === 'personal' && orgProvider?.config) {
      const phoneNumber =
        orgProvider.config.phoneNumber ??
        orgProvider.config.accountNumber ??
        orgProvider.config.merchantMobile ??
        '';
      const accountName =
        orgProvider.config.accountName ??
        orgProvider.config.merchantName ??
        paymentProvider;

      instruction = {
        phoneNumber,
        accountName,
        provider: paymentProvider,
        amount,
        reference: `SUB-${payment.id.slice(0, 8).toUpperCase()}`,
        steps: [
          `Open your ${paymentProvider.toUpperCase()} app`,
          `Tap "Send Money"`,
          `Enter the number: ${phoneNumber}`,
          `Enter amount: ৳${amount.toLocaleString()}`,
          `Use reference: SUB-${payment.id.slice(0, 8).toUpperCase()}`,
          `Complete payment and save your Transaction ID`,
        ],
      };
    }

    // For merchant mode (SSLCommerz etc.) — enqueue payment link generation
    const checkoutUrl: string | null = null;
    if (mode === 'merchant') {
      await this.outbox.enqueue(orgId, 'subscription.generate_checkout', {
        subscriptionPaymentId: payment.id,
        plan,
        billingCycle,
        amount,
        provider: paymentProvider,
      });
    }

    // Mark subscription as pending the new plan
    await this.subs.update(
      { id: sub.id } as any,
      {
        pendingPlan: plan,
        paymentProvider,
        billingCycle,
      } as any,
    );

    return {
      paymentId: payment.id,
      subscriptionId: sub.id,
      plan,
      billingCycle,
      amount,
      currency: 'BDT',
      provider: paymentProvider,
      mode,
      instruction,
      checkoutUrl,
      reference: `SUB-${payment.id.slice(0, 8).toUpperCase()}`,
    };
  }

  // ─── Submit manual payment proof (screenshot + trxId) ─────────────────────

  async submitPaymentProof(
    orgId: string,
    paymentId: string,
    screenshotUrl: string | null,
    trxId?: string,
  ) {
    const payment = await this.payments.findOne({
      where: { id: paymentId, orgId } as any,
    });
    if (!payment) throw new NotFoundException('Payment not found');

    await this.payments.update(
      { id: paymentId } as any,
      {
        status: PaymentStatus.AWAITING_CONFIRM,
        screenshotUrl: screenshotUrl ?? payment.screenshotUrl,
        trxId: trxId ?? payment.trxId,
      } as any,
    );

    // Notify platform admins that a subscription payment needs confirmation
    await this.outbox.enqueue(orgId, 'subscription.payment_proof_submitted', {
      subscriptionPaymentId: paymentId,
      orgId,
      trxId,
      screenshotUrl,
    });

    return {
      ok: true,
      message: 'Payment proof submitted. Awaiting confirmation.',
    };
  }

  // ─── Manually confirm payment (platform admin or org owner) ───────────────

  async confirmPayment(
    orgId: string,
    paymentId: string,
    confirmedBy: string,
    trxId?: string,
  ) {
    const payment = await this.payments.findOne({
      where: { id: paymentId, orgId } as any,
      relations: ['subscription'],
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Already confirmed');
    }

    const sub = payment.subscription;

    await this.dataSource.transaction(async (em) => {
      // Mark payment as paid
      await em.update(SubscriptionPaymentEntity, { id: paymentId }, {
        status: PaymentStatus.PAID,
        confirmedBy,
        confirmedAt: new Date(),
        trxId: trxId ?? payment.trxId,
      } as any);

      // Activate the subscription
      await this.activateSubscription(em, sub, payment);
    });

    // Notify org
    await this.outbox.enqueue(orgId, 'subscription.activated', {
      subscriptionId: sub.id,
      plan: sub.pendingPlan ?? sub.plan,
      paymentId,
    });

    return { ok: true, activated: true };
  }

  // ─── Handle gateway webhook (SSLCommerz, Stripe etc.) ─────────────────────

  async handleWebhook(provider: string, payload: any) {
    const reference =
      payload?.val_id ||
      payload?.tran_id ||
      payload?.transactionId ||
      payload?.metadata?.subscription_payment_id;

    if (!reference) return { ok: true, ignored: 'no_reference' };

    // Find payment by providerRef or by extracting SUB- prefix from reference
    let payment = await this.payments.findOne({
      where: { providerRef: String(reference) } as any,
      relations: ['subscription'],
    });

    // Fallback: look up by raw reference pattern
    if (!payment && String(reference).startsWith('SUB-')) {
      const shortId = reference.replace('SUB-', '').toLowerCase();
      const all = await this.payments.find({
        where: { status: PaymentStatus.PENDING } as any,
        relations: ['subscription'],
        take: 100,
      });
      payment = all.find((p) => p.id.startsWith(shortId)) ?? null;
    }

    if (!payment) return { ok: true, ignored: 'unknown_reference' };

    const statusStr = (
      payload?.status ||
      payload?.payment_status ||
      payload?.statusCode ||
      ''
    ).toLowerCase();

    const isPaid =
      statusStr === 'paid' ||
      statusStr === 'success' ||
      statusStr === 'valid' ||
      statusStr === '0000';

    const isFailed =
      statusStr === 'failed' ||
      statusStr === 'cancelled' ||
      statusStr === 'declined';

    if (isPaid) {
      await this.dataSource.transaction(async (em) => {
        await em.update(SubscriptionPaymentEntity, { id: payment!.id }, {
          status: PaymentStatus.PAID,
          providerRef: String(reference),
          rawPayload: payload,
          confirmedAt: new Date(),
        } as any);
        await this.activateSubscription(em, payment!.subscription, payment!);
      });

      await this.outbox.enqueue(payment.orgId, 'subscription.activated', {
        subscriptionId: payment.subscriptionId,
        paymentId: payment.id,
        provider,
      });
    } else if (isFailed) {
      await this.payments.update(
        { id: payment.id } as any,
        {
          status: PaymentStatus.FAILED,
          failureReason: statusStr,
          rawPayload: payload,
        } as any,
      );

      await this.outbox.enqueue(payment.orgId, 'subscription.payment_failed', {
        subscriptionId: payment.subscriptionId,
        paymentId: payment.id,
        reason: statusStr,
      });
    }

    return { ok: true };
  }

  // ─── Cancel subscription ───────────────────────────────────────────────────

  async cancelSubscription(orgId: string, immediately = false) {
    const sub = await this.subs.findOne({ where: { orgId } as any });
    if (!sub) throw new NotFoundException('No subscription found');

    if (immediately) {
      await this.subs.update(
        { id: sub.id } as any,
        {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          autoRenew: false,
        } as any,
      );
      // Downgrade org plan to FREE
      await this.orgs.update({ id: orgId } as any, { plan: 'FREE' } as any);
    } else {
      // Cancel at period end — set autoRenew = false
      await this.subs.update(
        { id: sub.id } as any,
        { autoRenew: false } as any,
      );
    }

    await this.outbox.enqueue(orgId, 'subscription.cancelled', {
      subscriptionId: sub.id,
      immediately,
    });

    return {
      ok: true,
      cancelledAt: immediately ? new Date() : sub.currentPeriodEnd,
    };
  }

  // ─── Toggle auto-renew ─────────────────────────────────────────────────────

  async setAutoRenew(orgId: string, autoRenew: boolean) {
    await this.subs.update({ orgId } as any, { autoRenew } as any);
    return { ok: true, autoRenew };
  }

  // ─── Get payment history ───────────────────────────────────────────────────

  async getPaymentHistory(orgId: string, page = 1, limit = 20) {
    const sub = await this.subs.findOne({ where: { orgId } as any });
    if (!sub) return { data: [], total: 0 };

    const [data, total] = await this.payments.findAndCount({
      where: { subscriptionId: sub.id } as any,
      order: { createdAt: 'DESC' } as any,
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  // ─── Admin: list all subscriptions ─────────────────────────────────────────

  async adminListSubscriptions(page = 1, limit = 20) {
    const [data, total] = await this.subs.findAndCount({
      order: { createdAt: 'DESC' } as any,
      skip: (page - 1) * limit,
      take: limit,
    });

    // Enrich with org names
    const enriched = await Promise.all(
      data.map(async (s) => {
        const org = await this.orgs.findOne({ where: { id: s.orgId } as any });
        const lastPayment = await this.payments.findOne({
          where: { subscriptionId: s.id, status: PaymentStatus.PAID } as any,
          order: { createdAt: 'DESC' } as any,
        });
        return {
          ...s,
          orgName: org?.name ?? s.orgId,
          lastPaidAt: lastPayment?.createdAt ?? null,
          lastPaidAmount: lastPayment?.amount ?? null,
        };
      }),
    );

    return { data: enriched, total, page, limit };
  }

  // ─── Admin: confirm payment ────────────────────────────────────────────────

  async adminConfirmPayment(
    paymentId: string,
    adminId: string,
    trxId?: string,
  ) {
    const payment = await this.payments.findOne({
      where: { id: paymentId } as any,
      relations: ['subscription'],
    });
    if (!payment) throw new NotFoundException('Payment not found');

    return this.confirmPayment(payment.orgId, paymentId, adminId, trxId);
  }

  // ─── Trial expiry check (called by scheduler) ──────────────────────────────

  async checkTrialExpiries() {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const trialSubs = await this.subs.find({
      where: { status: SubscriptionStatus.TRIAL } as any,
    });

    for (const sub of trialSubs) {
      if (!sub.trialStartedAt) continue;

      const trialEnd = new Date(sub.trialStartedAt);
      trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

      const now = new Date();
      const daysLeft = Math.ceil(
        (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Send alert at 3 days and 1 day remaining
      if (daysLeft === 3 || daysLeft === 1) {
        await this.outbox.enqueue(sub.orgId, 'subscription.trial_expiring', {
          subscriptionId: sub.id,
          daysLeft,
          trialEndsAt: trialEnd.toISOString(),
        });
        this.logger.log(
          `[Subscription] Trial expiring in ${daysLeft}d for org ${sub.orgId}`,
        );
      }

      // Expire trial
      if (daysLeft <= 0 && sub.status === SubscriptionStatus.TRIAL) {
        await this.subs.update(
          { id: sub.id } as any,
          { status: SubscriptionStatus.EXPIRED } as any,
        );
        await this.outbox.enqueue(sub.orgId, 'subscription.trial_expired', {
          subscriptionId: sub.id,
        });
        this.logger.log(`[Subscription] Trial expired for org ${sub.orgId}`);
      }
    }
  }

  // ─── Private: activate subscription after confirmed payment ───────────────

  private async activateSubscription(
    em: any,
    sub: SubscriptionEntity,
    payment: SubscriptionPaymentEntity,
  ) {
    const newPlan = (sub.pendingPlan as SubscriptionPlan) ?? sub.plan;
    const now = new Date();

    await em.update(SubscriptionEntity, { id: sub.id }, {
      plan: newPlan,
      status: SubscriptionStatus.ACTIVE,
      pendingPlan: null,
      currentPeriodStart: payment.periodStart ?? now,
      currentPeriodEnd: payment.periodEnd,
      amount: payment.amount,
      paymentProvider: payment.paymentProvider,
    } as any);

    // Update org plan so feature flags resolve correctly
    await em.update(OrganizationEntity, { id: sub.orgId }, {
      plan: newPlan,
    } as any);

    this.logger.log(`[Subscription] Activated ${newPlan} for org ${sub.orgId}`);
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private getTrialDaysRemaining(trialStartedAt?: Date): number {
    if (!trialStartedAt) return 0;
    const end = new Date(trialStartedAt);
    end.setDate(end.getDate() + TRIAL_DAYS);
    const diff = end.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }
}
