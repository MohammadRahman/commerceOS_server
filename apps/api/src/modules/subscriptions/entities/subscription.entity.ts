// apps/api/src/modules/subscriptions/entities/subscription.entity.ts
import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { SubscriptionPaymentEntity } from './subscription-payment.entity';

export enum SubscriptionPlan {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE', // payment failed, grace period
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
  ONE_TIME = 'ONE_TIME',
}

@Entity('subscriptions')
export class SubscriptionEntity extends AbstractEntity<SubscriptionEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id', unique: true })
  orgId: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionPlan.FREE,
  })
  plan: SubscriptionPlan;

  @Column({
    type: 'varchar',
    length: 20,
    default: SubscriptionStatus.TRIAL,
  })
  status: SubscriptionStatus;

  @Column({
    type: 'varchar',
    length: 20,
    default: BillingCycle.MONTHLY,
    name: 'billing_cycle',
  })
  billingCycle: BillingCycle;

  // Amount in BDT (or smallest currency unit for Stripe)
  @Column({ type: 'integer', default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'BDT' })
  currency: string;

  // Payment provider used for this subscription
  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
    name: 'payment_provider',
  })
  paymentProvider?: string;

  // External subscription/customer ID from payment gateway
  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    name: 'provider_subscription_id',
  })
  providerSubscriptionId?: string;

  // When trial started — used with TRIAL_DAYS to compute expiry
  @Column({ type: 'timestamptz', nullable: true, name: 'trial_started_at' })
  trialStartedAt?: Date;

  // When current billing period started
  @Column({ type: 'timestamptz', nullable: true, name: 'current_period_start' })
  currentPeriodStart?: Date;

  // When current billing period ends / next charge date
  @Column({ type: 'timestamptz', nullable: true, name: 'current_period_end' })
  currentPeriodEnd?: Date;

  // When subscription was cancelled (if applicable)
  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt?: Date;

  // Auto-renew flag — user can turn off
  @Column({ type: 'boolean', default: true, name: 'auto_renew' })
  autoRenew: boolean;

  // Pending plan change (upgrade/downgrade takes effect at period end)
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'pending_plan' })
  pendingPlan?: string;

  @OneToMany(() => SubscriptionPaymentEntity, (p) => p.subscription)
  payments: SubscriptionPaymentEntity[];
}
