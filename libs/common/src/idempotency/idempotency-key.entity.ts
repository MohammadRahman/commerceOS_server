import { Column, Entity, Index, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

@Entity('idempotency_keys')
@Unique('uq_idem_org_scope_key', ['orgId', 'scope', 'key'])
export class IdempotencyKeyEntity extends AbstractEntity<IdempotencyKeyEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  scope: string; // e.g. "webhook:meta", "webhook:payments:sslcommerz"

  @Column({ type: 'varchar', length: 200 })
  key: string; // e.g. message id, event id, txn id

  @Column({
    type: 'varchar',
    length: 100,
    name: 'request_hash',
    nullable: true,
  })
  requestHash?: string;

  @Index()
  @Column({
    type: 'timestamp with time zone',
    name: 'expires_at',
    nullable: true,
  })
  expiresAt?: Date;
}
