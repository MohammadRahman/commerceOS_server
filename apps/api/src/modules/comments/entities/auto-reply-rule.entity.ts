// apps/api/src/modules/comments/entities/auto-reply-rule.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

export type RuleTrigger = 'keyword' | 'intent' | 'all';
export type RuleAction =
  | 'reply'
  | 'move_to_inbox'
  | 'send_payment_link'
  | 'hide'
  | 'reply_and_move';

@Entity('auto_reply_rules')
export class AutoReplyRuleEntity extends AbstractEntity<AutoReplyRuleEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /** keyword | intent | all */
  @Column({ type: 'varchar', length: 20 })
  trigger: RuleTrigger;

  /** Keywords to match (case-insensitive, any match triggers) */
  @Column({ type: 'text', array: true, default: [] })
  keywords: string[];

  /** Intent types to match */
  @Column({ type: 'text', array: true, default: [], name: 'intents' })
  intents: string[];

  /** Which platforms this rule applies to. Empty = all */
  @Column({ type: 'text', array: true, default: [], name: 'platforms' })
  platforms: string[];

  /** The action to take when triggered */
  @Column({ type: 'varchar', length: 30 })
  action: RuleAction;

  /**
   * Public reply template.
   * Supports variables: {{name}}, {{product}}, {{price}}
   */
  @Column({ type: 'text', name: 'reply_template', nullable: true })
  replyTemplate?: string;

  /**
   * Private DM template sent when moving to inbox.
   * Supports same variables.
   */
  @Column({ type: 'text', name: 'dm_template', nullable: true })
  dmTemplate?: string;

  /** Product to attach payment link to (optional) */
  @Column({ type: 'uuid', name: 'product_id', nullable: true })
  productId?: string;

  /**
   * Priority — lower number runs first when multiple rules match.
   * Use to ensure specific rules take precedence over catch-alls.
   */
  @Column({ type: 'integer', default: 100 })
  priority: number;

  /** How many times this rule has fired */
  @Column({ type: 'integer', name: 'fire_count', default: 0 })
  fireCount: number;

  @Column({ type: 'timestamptz', name: 'last_fired_at', nullable: true })
  lastFiredAt?: Date;
}
