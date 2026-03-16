import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { CustomerEntity } from '../../inbox/entities/customer.entity';
import { ConversationEntity } from '../../inbox/entities/conversation.entity';
import { OrderEventEntity } from './order-event.entity';

export enum OrderStatus {
  NEW = 'NEW',
  CONFIRMED = 'CONFIRMED',
  PACKED = 'PACKED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
  FAILED_DELIVERY = 'FAILED_DELIVERY',
}

@Entity('orders')
export class OrderEntity extends AbstractEntity<OrderEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => CustomerEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: CustomerEntity;

  @Index()
  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId?: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL', nullable: true })
  conversation?: ConversationEntity;

  @Index()
  @Column({ type: 'varchar', length: 20, default: OrderStatus.NEW })
  status: OrderStatus;

  // store money in minor units: BDT -> poisha (or keep as integer BDT if you prefer)
  @Column({ type: 'int', default: 0 })
  subtotal: number;

  @Column({ type: 'int', name: 'delivery_fee', default: 0 })
  deliveryFee: number;

  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 5, default: 'BDT' })
  currency: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 100,
    name: 'campaign_tag',
    nullable: true,
  })
  campaignTag?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @OneToMany(() => OrderEventEntity, (e) => e.order)
  events: OrderEventEntity[];

  @Column({ type: 'int', name: 'paid_amount', default: 0 })
  paidAmount: number;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'payment_status',
    default: 'UNPAID',
  })
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';

  @Column({ type: 'int', name: 'balance_due', default: 0 })
  balanceDue: number;
}
