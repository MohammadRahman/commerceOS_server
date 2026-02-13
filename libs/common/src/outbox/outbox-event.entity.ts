import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Entity('outbox_events')
@Index(['status', 'availableAt'])
export class OutboxEventEntity extends AbstractEntity<OutboxEventEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  type: string; // e.g. "payment_link.generate"

  @Column({ type: 'jsonb' })
  payload: any;

  @Index()
  @Column({ type: 'varchar', length: 20, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError?: string;

  @Column({
    type: 'timestamp with time zone',
    name: 'available_at',
    default: () => 'now()',
  })
  availableAt: Date;
}
