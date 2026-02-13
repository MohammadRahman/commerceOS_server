import { Column, Entity, Index, OneToMany, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { ConversationEntity } from './conversation.entity';

export enum ChannelType {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  WHATSAPP = 'WHATSAPP',
}

@Entity('channels')
@Unique('uq_channels_org_type_external', ['orgId', 'type', 'externalAccountId'])
export class ChannelEntity extends AbstractEntity<ChannelEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  type: ChannelType;

  // Meta: page id or IG business id, etc.
  @Column({
    type: 'varchar',
    length: 100,
    name: 'external_account_id',
    nullable: true,
  })
  externalAccountId?: string;

  @Column({ type: 'varchar', length: 100, name: 'page_id', nullable: true })
  pageId?: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'ig_business_id',
    nullable: true,
  })
  igBusinessId?: string;

  // store encrypted token (later)
  @Column({ type: 'text', name: 'access_token_enc', nullable: true })
  accessTokenEnc?: string;

  @Column({
    type: 'timestamp with time zone',
    name: 'token_expiry_at',
    nullable: true,
  })
  tokenExpiryAt?: Date;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status: string;

  @OneToMany(() => ConversationEntity, (c) => c.channel)
  conversations: ConversationEntity[];
}
