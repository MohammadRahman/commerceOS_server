import { Column, Entity, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrderEntity } from '../../orders/entities/order.entity';

@Entity('payment_links')
@Unique('uq_payment_provider_ref', ['provider', 'providerRef'])
export class PaymentLinkEntity extends AbstractEntity<PaymentLinkEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' }) // ✅ forces relation to use order_id
  order: OrderEntity;

  @Column({ type: 'varchar', length: 40 })
  provider: string;

  @Column({ type: 'int' })
  amount: number;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'CREATED' })
  status: string;

  @Column({ type: 'text', nullable: true })
  url?: string;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'provider_ref',
    nullable: true,
  })
  providerRef?: string;
}
