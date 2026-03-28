// apps/api/src/modules/storefront/entities/product.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { AbstractEntity } from '@app/common/database/base.entity';

@Entity('products')
export class ProductEntity extends AbstractEntity<ProductEntity> {
  @Index()
  @Column({ type: 'uuid', name: 'org_id' })
  orgId: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 220 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'integer', default: 0 })
  price: number;

  @Column({ type: 'integer', name: 'compare_price', nullable: true })
  comparePrice?: number;

  @Column({ type: 'integer', default: 0 })
  stock: number;

  @Column({ type: 'text', array: true, default: [] })
  images: string[];

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number;

  /**
   * Per-image non-destructive CSS transform controls.
   * Array index matches images[] array.
   * Shape per element (ImageTransform from storefront.types.ts):
   * { brightness, contrast, saturation, blur, scale, x, y }
   * All numbers. Default: 100/100/100/0/100/50/50
   * Applied client-side as CSS filter + object-position — no server processing.
   */
  @Column({ type: 'jsonb', nullable: true, default: [] })
  transforms: Record<string, number>[];

  /**
   * Per-product SEO metadata.
   * Shape: ProductSEO from storefront.types.ts
   * { title, description, keywords, ogImage, canonical, noIndex }
   */
  @Column({ type: 'jsonb', nullable: true, default: {} })
  seo: Record<string, any>;
}
// apps/api/src/modules/storefront/entities/product.entity.ts
// import { Column, Entity, Index } from 'typeorm';
// import { AbstractEntity } from '@app/common/database/base.entity';

// @Entity('products')
// export class ProductEntity extends AbstractEntity<ProductEntity> {
//   @Index()
//   @Column({ type: 'uuid', name: 'org_id' })
//   orgId: string;

//   @Column({ type: 'varchar', length: 200 })
//   name: string;

//   @Index()
//   @Column({ type: 'varchar', length: 220 })
//   slug: string;

//   @Column({ type: 'text', nullable: true })
//   description?: string;

//   @Column({ type: 'integer', default: 0 })
//   price: number;

//   @Column({ type: 'integer', name: 'compare_price', nullable: true })
//   comparePrice?: number;

//   @Column({ type: 'integer', default: 0 })
//   stock: number;

//   @Column({ type: 'text', array: true, default: [] })
//   images: string[];

//   @Column({ type: 'boolean', name: 'is_active', default: true })
//   isActive: boolean;

//   @Column({ type: 'integer', name: 'sort_order', default: 0 })
//   sortOrder: number;
// }
