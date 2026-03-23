// apps/api/src/modules/storefront/entities/order-item.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrderEntity } from '../../orders/entities/order.entity';

@Entity('order_items')
export class OrderItemEntity extends AbstractEntity<OrderItemEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ type: 'uuid', name: 'product_id', nullable: true })
  productId?: string;

  // Snapshot at time of order — product name/price may change later
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'integer' })
  price: number;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Column({ type: 'integer' })
  total: number;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl?: string;
}
