import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { CourierProviderType } from './courier-provider-catalog.entity';
import { ProviderStatus } from './org-payment-provider.entity';

@Entity('org_courier_providers')
@Unique('uq_org_courier_provider_org_type', ['orgId', 'type'])
export class OrgCourierProviderEntity extends AbstractEntity<OrgCourierProviderEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  org: OrganizationEntity;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  type: CourierProviderType;

  @Column({ type: 'varchar', length: 20, default: ProviderStatus.INACTIVE })
  status: ProviderStatus;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, any>;

  // Webhook key for receiving delivery status callbacks
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'webhook_key',
  })
  webhookKey?: string;
}
