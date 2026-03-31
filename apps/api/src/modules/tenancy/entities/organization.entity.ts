import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';
import { UserEntity } from './user.entity';

@Entity('organizations')
export class OrganizationEntity extends AbstractEntity<OrganizationEntity> {
  @Index()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 50, default: 'FREE' })
  plan: string;

  /** Monthly recurring revenue in base currency units (set by billing webhook) */
  @Column({ type: 'integer', default: 0 })
  mrr: number;

  /** Active/suspended toggle — set by platform admin */
  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /**
   * Feature flags — per-org feature toggles set by platform admin.
   * Example: { storefront: true, ai_replies: false, analytics_v2: true }
   * Stored as JSONB so new flags never need a migration.
   */
  @Column({ type: 'jsonb', name: 'feature_flags', default: {} })
  featureFlags: Record<string, boolean>;

  @OneToMany(() => UserEntity, (u) => u.org)
  users: UserEntity[];

  @Column({ type: 'varchar', length: 50, default: 'Asia/Dhaka' })
  timezone: string;

  @Column({ type: 'varchar', length: 10, default: 'BDT' })
  currency: string;

  @Column({ type: 'varchar', length: 300, default: '' })
  pickupAddress: string;

  @Column({ type: 'boolean', default: false })
  isOnboarded: boolean;

  @Index()
  @Column({ type: 'char', length: 2, name: 'country_code', default: 'BD' })
  countryCode: string;
}
