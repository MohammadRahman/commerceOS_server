// apps/api/src/modules/live-sale/entities/live-sale.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

export type LiveSaleStatus = 'active' | 'ended';

export interface LiveProduct {
  id: string; // product id or temp id for quick-adds
  name: string;
  price: number;
  imageUrl?: string;
  stock?: number;
  isSoldOut: boolean;
  orderCount: number;
  announceText?: string; // custom announce message override
  sortOrder: number;
}

@Entity('live_sales')
export class LiveSaleEntity extends AbstractEntity<LiveSaleEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Index()
  @Column({ type: 'uuid', name: 'post_id' })
  postId: string;

  // Meta's post/live video ID
  @Column({ type: 'varchar', length: 100, name: 'platform_post_id' })
  platformPostId: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: LiveSaleStatus;

  // Ordered product queue — JSONB so drag-and-drop reorder
  // is a single update with no schema changes
  @Column({ type: 'jsonb', name: 'product_queue', default: [] })
  productQueue: LiveProduct[];

  // Keywords that trigger the auto payment link DM
  @Column({
    type: 'text',
    array: true,
    name: 'trigger_keywords',
    default: ['WANT', 'want', 'ORDER', 'order', 'চাই', 'অর্ডার'],
  })
  triggerKeywords: string[];

  // DM template sent when keyword is triggered
  @Column({
    type: 'text',
    name: 'trigger_dm_template',
    default:
      'Hi {{name}}! 🎉 Thanks for your interest! Here is your payment link to order {{product}} for ৳{{price}}: {{link}}',
  })
  triggerDmTemplate: string;

  // Aggregate stats — updated in real time
  @Column({ type: 'integer', name: 'total_orders', default: 0 })
  totalOrders: number;

  @Column({ type: 'integer', name: 'total_revenue', default: 0 })
  totalRevenue: number;

  @Column({ type: 'integer', name: 'total_comments', default: 0 })
  totalComments: number;

  @Column({ type: 'integer', name: 'unique_buyers', default: 0 })
  uniqueBuyers: number;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt?: Date;
}
