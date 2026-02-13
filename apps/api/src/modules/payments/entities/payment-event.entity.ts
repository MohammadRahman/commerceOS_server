import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { PaymentLinkEntity } from './payment-link.entity';

@Entity('payment_events')
export class PaymentEventEntity extends AbstractEntity<PaymentEventEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'payment_link_id' })
  paymentLinkId: string;

  @ManyToOne(() => PaymentLinkEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_link_id' })
  paymentLink: PaymentLinkEntity;

  @Column({ type: 'varchar', length: 60 })
  type: string; // PAYMENT_WEBHOOK_RECEIVED, PAYMENT_PAID, etc.

  @Column({ type: 'jsonb', nullable: true })
  payload?: any;
}
