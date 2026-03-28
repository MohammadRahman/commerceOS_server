// apps/api/src/modules/comments/entities/post-comment.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

export type CommentIntent =
  | 'price_query'
  | 'buy_intent'
  | 'availability'
  | 'complaint'
  | 'spam'
  | 'other';

export type CommentStatus =
  | 'new'
  | 'replied'
  | 'moved_to_inbox'
  | 'hidden'
  | 'deleted'
  | 'payment_sent';

@Entity('post_comments')
export class PostCommentEntity extends AbstractEntity<PostCommentEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'post_id' })
  postId: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 100,
    name: 'platform_comment_id',
    unique: true,
  })
  platformCommentId: string;

  @Column({
    type: 'varchar',
    length: 100,
    name: 'parent_comment_id',
    nullable: true,
  })
  parentCommentId?: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 100, name: 'sender_id' })
  senderId: string;

  @Column({ type: 'varchar', length: 200, name: 'sender_name' })
  senderName: string;

  @Column({ type: 'text', name: 'sender_profile_url', nullable: true })
  senderProfileUrl?: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'timestamptz', name: 'commented_at' })
  commentedAt: Date;

  @Column({ type: 'varchar', length: 30, default: 'other' })
  intent: CommentIntent;

  @Column({ type: 'float', name: 'intent_confidence', default: 0 })
  intentConfidence: number;

  @Column({ type: 'boolean', name: 'is_classified', default: false })
  isClassified: boolean;

  @Column({ type: 'varchar', length: 30, default: 'new' })
  status: CommentStatus;

  @Column({ type: 'text', name: 'reply_text', nullable: true })
  replyText?: string;

  @Column({ type: 'timestamptz', name: 'replied_at', nullable: true })
  repliedAt?: Date;

  @Column({ type: 'uuid', name: 'replied_by', nullable: true })
  repliedBy?: string;

  @Column({ type: 'uuid', name: 'conversation_id', nullable: true })
  conversationId?: string;

  @Column({ type: 'timestamptz', name: 'moved_to_inbox_at', nullable: true })
  movedToInboxAt?: Date;

  @Column({ type: 'uuid', name: 'payment_link_id', nullable: true })
  paymentLinkId?: string;

  @Column({ type: 'timestamptz', name: 'payment_sent_at', nullable: true })
  paymentSentAt?: Date;

  @Column({ type: 'boolean', name: 'is_returning_customer', default: false })
  isReturningCustomer: boolean;

  @Column({ type: 'uuid', name: 'customer_id', nullable: true })
  customerId?: string;
}
