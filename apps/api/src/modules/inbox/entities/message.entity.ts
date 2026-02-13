import { Column, Entity, Index, ManyToOne, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { ConversationEntity } from './conversation.entity';

export enum MessageDirection {
  IN = 'IN',
  OUT = 'OUT',
}

@Entity('messages')
@Unique('uq_messages_conversation_external', [
  'conversationId',
  'externalMessageId',
])
export class MessageEntity extends AbstractEntity<MessageEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, (c) => c.messages, {
    onDelete: 'CASCADE',
  })
  conversation: ConversationEntity;

  @Column({ type: 'varchar', length: 10 })
  direction: MessageDirection;

  @Column({
    type: 'varchar',
    length: 120,
    name: 'external_message_id',
    nullable: true,
  })
  externalMessageId?: string;

  @Column({
    type: 'varchar',
    length: 30,
    name: 'message_type',
    default: 'TEXT',
  })
  messageType: string;

  @Column({ type: 'text', nullable: true })
  text?: string;

  @Column({ type: 'jsonb', name: 'raw_payload', nullable: true })
  rawPayload?: any;

  @Index()
  @Column({
    type: 'timestamp with time zone',
    name: 'occurred_at',
    default: () => 'now()',
  })
  occurredAt: Date;
}
