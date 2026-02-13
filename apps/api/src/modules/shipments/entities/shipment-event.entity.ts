import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { ShipmentEntity } from './shipment.entity';

@Entity('shipment_events')
export class ShipmentEventEntity extends AbstractEntity<ShipmentEventEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'shipment_id' })
  shipmentId: string;

  @ManyToOne(() => ShipmentEntity, (s) => s.events, { onDelete: 'CASCADE' })
  shipment: ShipmentEntity;

  @Column({ type: 'varchar', length: 40 })
  type: string; // SHIPMENT_BOOKED, SHIPMENT_STATUS_UPDATED, WEBHOOK_RECEIVED

  @Column({ type: 'jsonb', nullable: true })
  payload?: any;
}
