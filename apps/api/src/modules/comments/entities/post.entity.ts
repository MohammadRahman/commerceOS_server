// apps/api/src/modules/comments/entities/post.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

export type PostPlatform = 'facebook' | 'instagram';
export type PostType = 'post' | 'live' | 'reel' | 'story';

@Entity('social_posts')
export class PostEntity extends AbstractEntity<PostEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 100,
    name: 'platform_post_id',
    unique: false,
  })
  platformPostId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: PostPlatform;

  @Column({ type: 'varchar', length: 20 })
  type: PostType;

  @Column({ type: 'text', nullable: true })
  title?: string;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ type: 'text', nullable: true })
  permalink?: string;

  @Column({ type: 'text', name: 'thumbnail_url', nullable: true })
  thumbnailUrl?: string;

  @Column({ type: 'boolean', name: 'is_live', default: false })
  isLive: boolean;

  @Column({ type: 'timestamptz', name: 'live_started_at', nullable: true })
  liveStartedAt?: Date;

  @Column({ type: 'timestamptz', name: 'live_ended_at', nullable: true })
  liveEndedAt?: Date;

  @Column({ type: 'integer', name: 'comment_count', default: 0 })
  commentCount: number;

  @Column({ type: 'integer', name: 'processed_count', default: 0 })
  processedCount: number;

  @Column({ type: 'timestamptz', name: 'synced_at', nullable: true })
  syncedAt?: Date;

  @Column({ type: 'timestamptz', name: 'posted_at', nullable: true })
  postedAt?: Date;
}
