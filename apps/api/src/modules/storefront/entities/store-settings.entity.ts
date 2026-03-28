// apps/api/src/modules/storefront/entities/store-settings.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

@Entity('store_settings')
export class StoreSettingsEntity extends AbstractEntity<StoreSettingsEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id', unique: true })
  orgId: string;

  @Index()
  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 200,
    name: 'custom_domain',
    nullable: true,
  })
  customDomain?: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', name: 'logo_url', nullable: true })
  logoUrl?: string;

  @Column({ type: 'text', name: 'banner_url', nullable: true })
  bannerUrl?: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'theme_color',
    default: '#6366f1',
  })
  themeColor: string;

  @Column({ type: 'varchar', length: 5, default: 'BDT' })
  currency: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'integer', name: 'delivery_fee', default: 0 })
  deliveryFee: number;

  @Column({ type: 'integer', name: 'min_order', default: 0 })
  minOrder: number;

  @Column({
    type: 'varchar',
    length: 30,
    name: 'contact_phone',
    nullable: true,
  })
  contactPhone?: string;

  @Column({
    type: 'varchar',
    length: 320,
    name: 'contact_email',
    nullable: true,
  })
  contactEmail?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'text', name: 'facebook_url', nullable: true })
  facebookUrl?: string;

  @Column({ type: 'text', name: 'instagram_url', nullable: true })
  instagramUrl?: string;

  @Column({
    type: 'varchar',
    length: 30,
    name: 'whatsapp_number',
    nullable: true,
  })
  whatsappNumber?: string;

  /**
   * Full theme configuration — layout, colors, fonts, hero slides, etc.
   * Stored as JSONB so adding new ThemeConfig fields never requires a migration.
   */
  @Column({ type: 'jsonb', name: 'theme_config', nullable: true, default: {} })
  themeConfig: Record<string, any>;

  /**
   * Store-level SEO metadata.
   * Shape: StoreSEO from storefront.types.ts
   * {
   *   title, description, keywords, ogImage,
   *   googleVerification, bingVerification, twitterHandle,
   *   enableStructuredData, robots
   * }
   */
  @Column({ type: 'jsonb', name: 'seo', nullable: true, default: {} })
  seo: Record<string, any>;
}
// apps/api/src/modules/storefront/entities/store-settings.entity.ts
// import { Column, Entity, Index } from 'typeorm';
// import { AbstractEntity } from '@app/common/database/base.entity';

// @Entity('store_settings')
// export class StoreSettingsEntity extends AbstractEntity<StoreSettingsEntity> {
//   @Index()
//   @Column({ type: 'uuid', name: 'org_id', unique: true })
//   orgId: string;

//   @Index()
//   @Column({ type: 'varchar', length: 100, unique: true })
//   slug: string;

//   @Index()
//   @Column({
//     type: 'varchar',
//     length: 200,
//     name: 'custom_domain',
//     nullable: true,
//   })
//   customDomain?: string;

//   @Column({ type: 'varchar', length: 200 })
//   name: string;

//   @Column({ type: 'text', nullable: true })
//   description?: string;

//   @Column({ type: 'text', name: 'logo_url', nullable: true })
//   logoUrl?: string;

//   @Column({ type: 'text', name: 'banner_url', nullable: true })
//   bannerUrl?: string;

//   @Column({
//     type: 'varchar',
//     length: 20,
//     name: 'theme_color',
//     default: '#6366f1',
//   })
//   themeColor: string;

//   @Column({ type: 'varchar', length: 5, default: 'BDT' })
//   currency: string;

//   @Column({ type: 'boolean', name: 'is_active', default: true })
//   isActive: boolean;

//   @Column({ type: 'integer', name: 'delivery_fee', default: 0 })
//   deliveryFee: number;

//   @Column({ type: 'integer', name: 'min_order', default: 0 })
//   minOrder: number;

//   @Column({
//     type: 'varchar',
//     length: 30,
//     name: 'contact_phone',
//     nullable: true,
//   })
//   contactPhone?: string;

//   @Column({
//     type: 'varchar',
//     length: 320,
//     name: 'contact_email',
//     nullable: true,
//   })
//   contactEmail?: string;

//   @Column({ type: 'text', nullable: true })
//   address?: string;

//   @Column({ type: 'text', name: 'facebook_url', nullable: true })
//   facebookUrl?: string;

//   @Column({ type: 'text', name: 'instagram_url', nullable: true })
//   instagramUrl?: string;

//   @Column({
//     type: 'varchar',
//     length: 30,
//     name: 'whatsapp_number',
//     nullable: true,
//   })
//   whatsappNumber?: string;

//   @Column({
//   type: 'jsonb',
//   name: 'theme_config',  // ← snake_case in DB
//   nullable: true,
//   default: {}
// })
// themeConfig: Record<string, any>;
// }
