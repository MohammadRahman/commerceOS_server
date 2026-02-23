import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { PaymentProviderType } from './payment-provider-catalog.entity';

export enum ProviderStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('org_payment_providers')
@Unique('uq_org_payment_provider_org_type', ['orgId', 'type'])
export class OrgPaymentProviderEntity extends AbstractEntity<OrgPaymentProviderEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  org: OrganizationEntity;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  type: PaymentProviderType;

  @Column({ type: 'varchar', length: 20, default: ProviderStatus.INACTIVE })
  status: ProviderStatus;

  // Provider credentials/config (encrypted at app layer or via KMS later)
  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, any>;

  // For secure webhook routing later
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'webhook_key', nullable: true })
  webhookKey?: string;
}
