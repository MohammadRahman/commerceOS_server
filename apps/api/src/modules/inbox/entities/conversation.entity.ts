import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { ChannelEntity } from './channel.entity';
import { MessageEntity } from './message.entity';

@Entity('conversations')
@Unique('uq_conversations_channel_thread', ['channelId', 'externalThreadId'])
export class ConversationEntity extends AbstractEntity<ConversationEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'channel_id' })
  channelId: string;

  @ManyToOne(() => ChannelEntity, (ch) => ch.conversations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: ChannelEntity;

  // Meta thread id
  @Column({ type: 'varchar', length: 120, name: 'external_thread_id' })
  externalThreadId: string;

  // External user id for the other participant (optional, Meta varies)
  @Column({
    type: 'varchar',
    length: 120,
    name: 'external_user_id',
    nullable: true,
  })
  externalUserId?: string;

  @Index()
  @Column({
    type: 'timestamp with time zone',
    name: 'last_message_at',
    nullable: true,
  })
  lastMessageAt?: Date;

  @Index()
  @Column({ type: 'uuid', name: 'assigned_user_id', nullable: true })
  assignedUserId?: string;

  @OneToMany(() => MessageEntity, (m) => m.conversation)
  messages: MessageEntity[];
}
