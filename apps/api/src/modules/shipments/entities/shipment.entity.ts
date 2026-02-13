import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { ShipmentEventEntity } from './shipment-event.entity';

export enum ShipmentStatus {
  CREATED = 'CREATED',
  BOOKED = 'BOOKED',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  RETURNED = 'RETURNED',
  CANCELLED = 'CANCELLED',
}

@Entity('shipments')
@Unique('uq_shipment_provider_consignment', [
  'courierProvider',
  'consignmentId',
])
export class ShipmentEntity extends AbstractEntity<ShipmentEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ type: 'varchar', length: 40, name: 'courier_provider' })
  courierProvider: string; // "steadfast", "redx", etc.

  @Index()
  @Column({
    type: 'varchar',
    length: 120,
    name: 'consignment_id',
    nullable: true,
  })
  consignmentId?: string;

  @Column({ type: 'text', name: 'tracking_url', nullable: true })
  trackingUrl?: string;

  @Index()
  @Column({ type: 'varchar', length: 30, default: ShipmentStatus.CREATED })
  status: ShipmentStatus;

  @Column({
    type: 'timestamp with time zone',
    name: 'last_update_at',
    nullable: true,
  })
  lastUpdateAt?: Date;

  @OneToMany(() => ShipmentEventEntity, (e) => e.shipment)
  events: ShipmentEventEntity[];
}
