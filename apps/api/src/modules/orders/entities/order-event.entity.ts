import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrderEntity } from './order.entity';

@Entity('order_events')
export class OrderEventEntity extends AbstractEntity<OrderEventEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @ManyToOne(() => OrderEntity, (o) => o.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ type: 'varchar', length: 60 })
  type: string; // e.g. ORDER_CREATED, STATUS_CHANGED

  @Column({ type: 'jsonb', nullable: true })
  data?: any;
}
