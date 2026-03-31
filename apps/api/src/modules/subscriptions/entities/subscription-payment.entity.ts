// apps/api/src/modules/subscriptions/entities/subscription-payment.entity.ts
import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { SubscriptionEntity } from './subscription.entity';

export enum PaymentStatus {
  PENDING = 'PENDING', // created, waiting for confirmation
  AWAITING_CONFIRM = 'AWAITING_CONFIRM', // screenshot uploaded, manual confirm needed
  PAID = 'PAID', // confirmed / webhook received
  FAILED = 'FAILED', // payment failed
  REFUNDED = 'REFUNDED',
}

@Entity('subscription_payments')
export class SubscriptionPaymentEntity extends AbstractEntity<SubscriptionPaymentEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId: string;

  @ManyToOne(() => SubscriptionEntity, (s) => s.payments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'subscription_id' })
  subscription: SubscriptionEntity;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'BDT' })
  currency: string;

  @Column({ type: 'varchar', length: 30, name: 'payment_provider' })
  paymentProvider: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  // Provider's transaction/reference ID
  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    name: 'provider_ref',
  })
  providerRef?: string;

  // Manual transaction ID entered by user (bKash/Nagad)
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'trx_id' })
  trxId?: string;

  // Screenshot URL for manual payments
  @Column({ type: 'text', nullable: true, name: 'screenshot_url' })
  screenshotUrl?: string;

  // Which billing period this payment covers
  @Column({ type: 'timestamptz', nullable: true, name: 'period_start' })
  periodStart?: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'period_end' })
  periodEnd?: Date;

  // Who confirmed this payment (for manual confirms)
  @Column({ type: 'uuid', nullable: true, name: 'confirmed_by' })
  confirmedBy?: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'confirmed_at' })
  confirmedAt?: Date;

  // Raw webhook payload for debugging
  @Column({ type: 'jsonb', nullable: true, name: 'raw_payload' })
  rawPayload?: Record<string, any>;

  // Failure reason if status = FAILED
  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason?: string;
}
