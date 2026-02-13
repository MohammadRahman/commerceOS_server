import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { CustomerEntity } from './customer.entity';
import { ChannelEntity } from './channel.entity';

@Entity('customer_identities')
@Unique('uq_customer_identity_channel_external', [
  'channelId',
  'externalUserId',
])
export class CustomerIdentityEntity extends AbstractEntity<CustomerIdentityEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'customer_id' })
  customerId: string;

  @ManyToOne(() => CustomerEntity, (c) => c.identities, { onDelete: 'CASCADE' })
  customer: CustomerEntity;

  @Index()
  @Column({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @ManyToOne(() => ChannelEntity, { onDelete: 'CASCADE' })
  channel: ChannelEntity;

  @Column({ type: 'varchar', length: 120, name: 'external_user_id' })
  externalUserId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;
}
