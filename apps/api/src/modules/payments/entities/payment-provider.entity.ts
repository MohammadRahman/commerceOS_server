import { AbstractEntity } from '@app/common';
import { Entity, Unique, Index, Column } from 'typeorm';

// payment-provider.entity.ts
@Entity('payment_providers')
@Unique('uq_payment_provider_org_type', ['orgId', 'type'])
export class PaymentProviderEntity extends AbstractEntity<PaymentProviderEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Column({ type: 'varchar', length: 40 })
  type: 'bkash' | 'nagad' | 'rocket' | 'sslcommerz';

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'inactive' })
  status: 'active' | 'inactive';

  // optional future config fields
  @Column({ type: 'jsonb', nullable: true })
  config?: any;
}
