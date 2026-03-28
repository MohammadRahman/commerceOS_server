/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/modules/storefront/storefront.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreSettingsEntity } from './entities/store-settings.entity';
import { ProductEntity } from './entities/product.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { CustomerEntity } from '../inbox/entities/customer.entity';

// ── Import class DTOs — single source of truth, no inline interface duplication
import { UpsertStoreDto } from './dto/upsert-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { StorefrontOrderDto } from './dto/storefront-order.dto';
import { isUUID } from 'class-validator';

// Re-export so the controller can import from one place if preferred
export { UpsertStoreDto, CreateProductDto, StorefrontOrderDto };

@Injectable()
export class StorefrontService {
  constructor(
    @InjectRepository(StoreSettingsEntity)
    private stores: Repository<StoreSettingsEntity>,
    @InjectRepository(ProductEntity)
    private products: Repository<ProductEntity>,
    @InjectRepository(OrderItemEntity)
    private orderItems: Repository<OrderItemEntity>,
    @InjectRepository(OrderEntity)
    private orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private orderEvents: Repository<OrderEventEntity>,
    @InjectRepository(CustomerEntity)
    private customers: Repository<CustomerEntity>,
  ) {}

  // ── Store settings ─────────────────────────────────────────────────────────

  async getStoreBySlug(slug: string): Promise<StoreSettingsEntity> {
    const store = await this.stores.findOne({
      where: { slug, isActive: true } as any,
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async getStoreByDomain(domain: string): Promise<StoreSettingsEntity> {
    const store = await this.stores.findOne({
      where: { customDomain: domain, isActive: true } as any,
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async getStoreByOrgId(orgId: string): Promise<StoreSettingsEntity | null> {
    return this.stores.findOne({ where: { orgId } as any });
  }

  async upsertStore(
    orgId: string,
    dto: UpsertStoreDto,
  ): Promise<StoreSettingsEntity> {
    const existing = await this.stores.findOne({ where: { orgId } as any });

    if (existing) {
      const update: Record<string, any> = {};

      const scalarFields: (keyof UpsertStoreDto)[] = [
        'slug',
        'customDomain',
        'name',
        'description',
        'logoUrl',
        'bannerUrl',
        'themeColor',
        'currency',
        'deliveryFee',
        'minOrder',
        'contactPhone',
        'contactEmail',
        'address',
        'facebookUrl',
        'instagramUrl',
        'whatsappNumber',
        'isActive',
      ];
      for (const field of scalarFields) {
        if (dto[field] !== undefined) update[field] = dto[field];
      }

      // Merge JSONB — prevents partial saves from wiping unrelated keys
      if (dto.themeConfig !== undefined) {
        update.themeConfig = {
          ...(existing.themeConfig ?? {}),
          ...dto.themeConfig,
        };
      }
      if (dto.seo !== undefined) {
        update.seo = { ...(existing.seo ?? {}), ...dto.seo };
      }

      await this.stores.update({ id: existing.id }, update);
      return this.stores.findOne({
        where: { id: existing.id },
      }) as Promise<StoreSettingsEntity>;
    }

    if (!dto.slug) {
      const base = dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
      dto.slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const slugExists = await this.stores.findOne({
      where: { slug: dto.slug } as any,
    });
    if (slugExists) throw new BadRequestException('Store slug already taken');

    return this.stores.save(
      this.stores.create({
        orgId,
        ...dto,
        themeConfig: dto.themeConfig ?? {},
        seo: dto.seo ?? {},
      } as any),
    ) as unknown as StoreSettingsEntity;
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async listProducts(
    orgId: string,
    activeOnly = false,
  ): Promise<ProductEntity[]> {
    const where: any = { orgId };
    if (activeOnly) where.isActive = true;
    return this.products.find({
      where,
      order: { sortOrder: 'ASC', createdAt: 'DESC' } as any,
    });
  }

  async getProduct(orgId: string, slugOrId: string): Promise<ProductEntity> {
    const where = isUUID(slugOrId)
      ? [
          { orgId, slug: slugOrId },
          { orgId, id: slugOrId },
        ]
      : [{ orgId, slug: slugOrId }];

    // const product = await this.products.findOne({
    //   where: [
    //     { orgId, slug: slugOrId },
    //     { orgId, id: slugOrId },
    //   ] as any,
    // });
    const product = await this.products.findOne({ where: where as any });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async createProduct(
    orgId: string,
    dto: CreateProductDto,
  ): Promise<ProductEntity> {
    const base = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 200);

    let finalSlug = base;
    const existing = await this.products.findOne({
      where: { orgId, slug: base } as any,
    });
    if (existing)
      finalSlug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

    return this.products.save(
      this.products.create({
        orgId,
        slug: finalSlug,
        ...dto,
        transforms: dto.transforms ?? [],
        seo: dto.seo ?? {},
      } as any),
    ) as unknown as ProductEntity;
  }

  async updateProduct(
    orgId: string,
    id: string,
    dto: Partial<CreateProductDto>,
  ): Promise<ProductEntity> {
    const product = await this.products.findOne({
      where: { id, orgId } as any,
    });
    if (!product) throw new NotFoundException('Product not found');

    const update: Record<string, any> = { ...dto };
    if (dto.transforms !== undefined) update.transforms = dto.transforms;
    if (dto.seo !== undefined)
      update.seo = { ...(product.seo ?? {}), ...dto.seo };

    await this.products.update({ id }, update);
    return this.products.findOne({ where: { id } }) as Promise<ProductEntity>;
  }

  async deleteProduct(orgId: string, id: string): Promise<void> {
    const product = await this.products.findOne({
      where: { id, orgId } as any,
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.products.delete({ id });
  }

  // ── Public storefront order ────────────────────────────────────────────────

  async createStorefrontOrder(
    store: StoreSettingsEntity,
    dto: StorefrontOrderDto,
  ): Promise<{ orderId: string; total: number; currency: string }> {
    if (!dto.items?.length)
      throw new BadRequestException('Order must have at least one item');

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.products.find({
      where: productIds.map((id) => ({
        id,
        orgId: store.orgId,
        isActive: true,
      })) as any,
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    const items: { product: ProductEntity; quantity: number }[] = [];
    for (const item of dto.items) {
      const product = productMap.get(item.productId);
      if (!product)
        throw new BadRequestException(
          `Product ${item.productId} not found or inactive`,
        );
      if (product.stock > 0 && item.quantity > product.stock)
        throw new BadRequestException(`Insufficient stock for ${product.name}`);
      items.push({ product, quantity: item.quantity });
    }

    const subtotal = items.reduce(
      (sum, i) => sum + i.product.price * i.quantity,
      0,
    );
    const deliveryFee = store.deliveryFee ?? 0;
    const total = subtotal + deliveryFee;

    if (store.minOrder > 0 && subtotal < store.minOrder) {
      throw new BadRequestException(
        `Minimum order amount is ${store.minOrder} ${store.currency}`,
      );
    }

    let customer = await this.customers.findOne({
      where: { orgId: store.orgId, phone: dto.customerPhone } as any,
      order: { createdAt: 'DESC' } as any,
    });

    if (!customer) {
      customer = (await this.customers.save(
        this.customers.create({
          orgId: store.orgId,
          name: dto.customerName,
          phone: dto.customerPhone,
          email: dto.customerEmail,
          addressText: dto.deliveryAddress,
        }),
      )) as unknown as CustomerEntity;
    }

    const order = (await this.orders.save(
      this.orders.create({
        orgId: store.orgId,
        customerId: customer.id,
        status: OrderStatus.NEW,
        subtotal,
        deliveryFee,
        total,
        paidAmount: 0,
        balanceDue: total,
        paymentStatus: 'UNPAID',
        currency: store.currency,
        notes: dto.notes,
        source: 'STOREFRONT',
      } as any),
    )) as unknown as OrderEntity;

    for (const item of items) {
      await (this.orderItems.save(
        this.orderItems.create({
          orgId: store.orgId,
          orderId: order.id,
          productId: item.product.id,
          name: item.product.name,
          price: item.product.price,
          quantity: item.quantity,
          total: item.product.price * item.quantity,
          imageUrl: item.product.images?.[0] ?? null,
        } as any),
      ) as unknown as Promise<OrderItemEntity>);

      if (item.product.stock > 0) {
        await this.products.update({ id: item.product.id }, {
          stock: item.product.stock - item.quantity,
        } as any);
      }
    }

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId: store.orgId,
        orderId: order.id,
        type: 'ORDER_CREATED',
        data: {
          source: 'STOREFRONT',
          storeSlug: store.slug,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          itemCount: items.length,
          total,
        },
      }),
    );

    return { orderId: order.id, total, currency: store.currency };
  }

  // ── Public order lookup ────────────────────────────────────────────────────

  async getPublicOrder(orderId: string, phone: string) {
    const order = await this.orders.findOne({
      where: { id: orderId } as any,
      relations: ['customer'],
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.customer?.phone !== phone)
      throw new NotFoundException('Order not found');

    const items = await this.orderItems.find({
      where: { orderId: order.id } as any,
    });

    const shipments = await this.orders
      .query(
        `SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orderId],
      )
      .catch(() => []);

    return {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      total: order.total,
      paidAmount: order.paidAmount,
      balanceDue: order.balanceDue,
      currency: order.currency,
      createdAt: order.createdAt,
      items,
      tracking: shipments[0] ?? null,
    };
  }

  // ── Order items for admin ──────────────────────────────────────────────────

  async getOrderItems(
    orgId: string,
    orderId: string,
  ): Promise<OrderItemEntity[]> {
    return this.orderItems.find({
      where: { orgId, orderId } as any,
    });
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // apps/api/src/modules/storefront/storefront.service.ts
// import {
//   BadRequestException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { StoreSettingsEntity } from './entities/store-settings.entity';
// import { ProductEntity } from './entities/product.entity';
// import { OrderItemEntity } from './entities/order-item.entity';
// import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
// import { OrderEventEntity } from '../orders/entities/order-event.entity';
// import { CustomerEntity } from '../inbox/entities/customer.entity';

// // ── DTOs ──────────────────────────────────────────────────────────────────────

// export interface UpsertStoreDto {
//   slug?: string;
//   customDomain?: string;
//   name: string;
//   description?: string;
//   logoUrl?: string;
//   bannerUrl?: string;
//   themeColor?: string;
//   currency?: string;
//   deliveryFee?: number;
//   minOrder?: number;
//   contactPhone?: string;
//   contactEmail?: string;
//   address?: string;
//   facebookUrl?: string;
//   instagramUrl?: string;
//   whatsappNumber?: string;
//   isActive?: boolean;
//   /**
//    * Full theme config from the client builder (ThemeConfig).
//    * Includes heroSlides[], heroHeight, heroAnimation, etc.
//    * Stored as JSONB — no schema migration needed when fields are added.
//    */
//   themeConfig?: Record<string, any>;
//   /**
//    * Store-level SEO settings (StoreSEO).
//    * { title, description, keywords, ogImage, googleVerification,
//    *   bingVerification, twitterHandle, enableStructuredData, robots }
//    */
//   seo?: Record<string, any>;
// }

// export interface CreateProductDto {
//   name: string;
//   description?: string;
//   price: number;
//   comparePrice?: number;
//   stock?: number;
//   images?: string[];
//   isActive?: boolean;
//   sortOrder?: number;
//   /**
//    * Per-image CSS transform controls (ImageTransform[]).
//    * Index matches images[]. Applied client-side only.
//    * [{ brightness, contrast, saturation, blur, scale, x, y }]
//    */
//   transforms?: Record<string, number>[];
//   /**
//    * Per-product SEO metadata (ProductSEO).
//    * { title, description, keywords, ogImage, canonical, noIndex }
//    */
//   seo?: Record<string, any>;
// }

// export interface StorefrontOrderDto {
//   customerName: string;
//   customerPhone: string;
//   customerEmail?: string;
//   deliveryAddress: string;
//   notes?: string;
//   items: { productId: string; quantity: number }[];
// }

// @Injectable()
// export class StorefrontService {
//   constructor(
//     @InjectRepository(StoreSettingsEntity)
//     private stores: Repository<StoreSettingsEntity>,
//     @InjectRepository(ProductEntity)
//     private products: Repository<ProductEntity>,
//     @InjectRepository(OrderItemEntity)
//     private orderItems: Repository<OrderItemEntity>,
//     @InjectRepository(OrderEntity)
//     private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private orderEvents: Repository<OrderEventEntity>,
//     @InjectRepository(CustomerEntity)
//     private customers: Repository<CustomerEntity>,
//   ) {}

//   // ── Store settings ─────────────────────────────────────────────────────────

//   async getStoreBySlug(slug: string): Promise<StoreSettingsEntity> {
//     const store = await this.stores.findOne({
//       where: { slug, isActive: true } as any,
//     });
//     if (!store) throw new NotFoundException('Store not found');
//     return store;
//   }

//   async getStoreByDomain(domain: string): Promise<StoreSettingsEntity> {
//     const store = await this.stores.findOne({
//       where: { customDomain: domain, isActive: true } as any,
//     });
//     if (!store) throw new NotFoundException('Store not found');
//     return store;
//   }

//   async getStoreByOrgId(orgId: string): Promise<StoreSettingsEntity | null> {
//     return this.stores.findOne({ where: { orgId } as any });
//   }

//   async upsertStore(
//     orgId: string,
//     dto: UpsertStoreDto,
//   ): Promise<StoreSettingsEntity> {
//     const existing = await this.stores.findOne({ where: { orgId } as any });

//     if (existing) {
//       // Build update payload — only include defined fields so partial
//       // updates don't accidentally null out existing themeConfig / seo
//       const update: Record<string, any> = {};

//       // Scalar fields
//       const scalarFields: (keyof UpsertStoreDto)[] = [
//         'slug',
//         'customDomain',
//         'name',
//         'description',
//         'logoUrl',
//         'bannerUrl',
//         'themeColor',
//         'currency',
//         'deliveryFee',
//         'minOrder',
//         'contactPhone',
//         'contactEmail',
//         'address',
//         'facebookUrl',
//         'instagramUrl',
//         'whatsappNumber',
//         'isActive',
//       ];
//       for (const field of scalarFields) {
//         if (dto[field] !== undefined) update[field] = dto[field];
//       }

//       // JSONB fields — merge with existing rather than overwrite
//       // This prevents a partial theme save from wiping unrelated keys
//       if (dto.themeConfig !== undefined) {
//         update.themeConfig = {
//           ...(existing.themeConfig ?? {}),
//           ...dto.themeConfig,
//         };
//       }
//       if (dto.seo !== undefined) {
//         update.seo = { ...(existing.seo ?? {}), ...dto.seo };
//       }

//       await this.stores.update({ id: existing.id }, update);
//       return this.stores.findOne({
//         where: { id: existing.id },
//       }) as Promise<StoreSettingsEntity>;
//     }

//     // ── Create new store ───────────────────────────────────────────────────

//     // Auto-generate slug if not provided
//     if (!dto.slug) {
//       const base = dto.name
//         .toLowerCase()
//         .replace(/[^a-z0-9]+/g, '-')
//         .replace(/^-|-$/g, '')
//         .slice(0, 80);
//       dto.slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
//     }

//     const slugExists = await this.stores.findOne({
//       where: { slug: dto.slug } as any,
//     });
//     if (slugExists) throw new BadRequestException('Store slug already taken');

//     return this.stores.save(
//       this.stores.create({
//         orgId,
//         ...dto,
//         themeConfig: dto.themeConfig ?? {},
//         seo: dto.seo ?? {},
//       } as any),
//     ) as unknown as StoreSettingsEntity;
//   }

//   // ── Products ───────────────────────────────────────────────────────────────

//   async listProducts(
//     orgId: string,
//     activeOnly = false,
//   ): Promise<ProductEntity[]> {
//     const where: any = { orgId };
//     if (activeOnly) where.isActive = true;
//     return this.products.find({
//       where,
//       order: { sortOrder: 'ASC', createdAt: 'DESC' } as any,
//     });
//   }

//   async getProduct(orgId: string, slugOrId: string): Promise<ProductEntity> {
//     const product = await this.products.findOne({
//       where: [
//         { orgId, slug: slugOrId },
//         { orgId, id: slugOrId },
//       ] as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');
//     return product;
//   }

//   async createProduct(
//     orgId: string,
//     dto: CreateProductDto,
//   ): Promise<ProductEntity> {
//     const base = dto.name
//       .toLowerCase()
//       .replace(/[^a-z0-9]+/g, '-')
//       .replace(/^-|-$/g, '')
//       .slice(0, 200);

//     let finalSlug = base;
//     const existing = await this.products.findOne({
//       where: { orgId, slug: base } as any,
//     });
//     if (existing)
//       finalSlug = `${base}-${Math.random().toString(36).slice(2, 6)}`;

//     return this.products.save(
//       this.products.create({
//         orgId,
//         slug: finalSlug,
//         ...dto,
//         transforms: dto.transforms ?? [],
//         seo: dto.seo ?? {},
//       } as any),
//     ) as unknown as ProductEntity;
//   }

//   async updateProduct(
//     orgId: string,
//     id: string,
//     dto: Partial<CreateProductDto>,
//   ): Promise<ProductEntity> {
//     const product = await this.products.findOne({
//       where: { id, orgId } as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');

//     // Build update — handle transforms and seo explicitly so they
//     // don't accidentally overwrite with undefined
//     const update: Record<string, any> = { ...dto };
//     if (dto.transforms !== undefined) update.transforms = dto.transforms;
//     if (dto.seo !== undefined)
//       update.seo = { ...(product.seo ?? {}), ...dto.seo };

//     await this.products.update({ id }, update);
//     return this.products.findOne({ where: { id } }) as Promise<ProductEntity>;
//   }

//   async deleteProduct(orgId: string, id: string): Promise<void> {
//     const product = await this.products.findOne({
//       where: { id, orgId } as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');
//     await this.products.delete({ id });
//   }

//   // ── Public storefront order ────────────────────────────────────────────────

//   async createStorefrontOrder(
//     store: StoreSettingsEntity,
//     dto: StorefrontOrderDto,
//   ): Promise<{ orderId: string; total: number; currency: string }> {
//     if (!dto.items?.length)
//       throw new BadRequestException('Order must have at least one item');

//     const productIds = dto.items.map((i) => i.productId);
//     const products = await this.products.find({
//       where: productIds.map((id) => ({
//         id,
//         orgId: store.orgId,
//         isActive: true,
//       })) as any,
//     });

//     const productMap = new Map(products.map((p) => [p.id, p]));

//     const items: { product: ProductEntity; quantity: number }[] = [];
//     for (const item of dto.items) {
//       const product = productMap.get(item.productId);
//       if (!product)
//         throw new BadRequestException(
//           `Product ${item.productId} not found or inactive`,
//         );
//       if (product.stock > 0 && item.quantity > product.stock) {
//         throw new BadRequestException(`Insufficient stock for ${product.name}`);
//       }
//       items.push({ product, quantity: item.quantity });
//     }

//     const subtotal = items.reduce(
//       (sum, i) => sum + i.product.price * i.quantity,
//       0,
//     );
//     const deliveryFee = store.deliveryFee ?? 0;
//     const total = subtotal + deliveryFee;

//     if (store.minOrder > 0 && subtotal < store.minOrder) {
//       throw new BadRequestException(
//         `Minimum order amount is ${store.minOrder} ${store.currency}`,
//       );
//     }

//     let customer = await this.customers.findOne({
//       where: { orgId: store.orgId, phone: dto.customerPhone } as any,
//       order: { createdAt: 'DESC' } as any,
//     });

//     if (!customer) {
//       customer = (await this.customers.save(
//         this.customers.create({
//           orgId: store.orgId,
//           name: dto.customerName,
//           phone: dto.customerPhone,
//           email: dto.customerEmail,
//           addressText: dto.deliveryAddress,
//         }),
//       )) as unknown as CustomerEntity;
//     }

//     const order = (await this.orders.save(
//       this.orders.create({
//         orgId: store.orgId,
//         customerId: customer.id,
//         status: OrderStatus.NEW,
//         subtotal,
//         deliveryFee,
//         total,
//         paidAmount: 0,
//         balanceDue: total,
//         paymentStatus: 'UNPAID',
//         currency: store.currency,
//         notes: dto.notes,
//         source: 'STOREFRONT',
//       } as any),
//     )) as unknown as OrderEntity;

//     for (const item of items) {
//       await (this.orderItems.save(
//         this.orderItems.create({
//           orgId: store.orgId,
//           orderId: order.id,
//           productId: item.product.id,
//           name: item.product.name,
//           price: item.product.price,
//           quantity: item.quantity,
//           total: item.product.price * item.quantity,
//           imageUrl: item.product.images?.[0] ?? null,
//         } as any),
//       ) as unknown as Promise<OrderItemEntity>);

//       if (item.product.stock > 0) {
//         await this.products.update({ id: item.product.id }, {
//           stock: item.product.stock - item.quantity,
//         } as any);
//       }
//     }

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId: store.orgId,
//         orderId: order.id,
//         type: 'ORDER_CREATED',
//         data: {
//           source: 'STOREFRONT',
//           storeSlug: store.slug,
//           customerName: dto.customerName,
//           customerPhone: dto.customerPhone,
//           itemCount: items.length,
//           total,
//         },
//       }),
//     );

//     return { orderId: order.id, total, currency: store.currency };
//   }

//   // ── Public order lookup ────────────────────────────────────────────────────

//   async getPublicOrder(orderId: string, phone: string) {
//     const order = await this.orders.findOne({
//       where: { id: orderId } as any,
//       relations: ['customer'],
//     });
//     if (!order) throw new NotFoundException('Order not found');

//     if (order.customer?.phone !== phone) {
//       throw new NotFoundException('Order not found');
//     }

//     const items = await this.orderItems.find({
//       where: { orderId: order.id } as any,
//     });

//     const shipments = await this.orders
//       .query(
//         `SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
//         [orderId],
//       )
//       .catch(() => []);

//     return {
//       id: order.id,
//       status: order.status,
//       paymentStatus: order.paymentStatus,
//       subtotal: order.subtotal,
//       deliveryFee: order.deliveryFee,
//       total: order.total,
//       paidAmount: order.paidAmount,
//       balanceDue: order.balanceDue,
//       currency: order.currency,
//       createdAt: order.createdAt,
//       items,
//       tracking: shipments[0] ?? null,
//     };
//   }

//   // ── Order items for admin ──────────────────────────────────────────────────

//   async getOrderItems(
//     orgId: string,
//     orderId: string,
//   ): Promise<OrderItemEntity[]> {
//     return this.orderItems.find({
//       where: { orgId, orderId } as any,
//     });
//   }
// }
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/modules/storefront/storefront.service.ts
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   BadRequestException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { StoreSettingsEntity } from './entities/store-settings.entity';
// import { ProductEntity } from './entities/product.entity';
// import { OrderItemEntity } from './entities/order-item.entity';
// import { OrderEntity, OrderStatus } from '../orders/entities/order.entity';
// import { OrderEventEntity } from '../orders/entities/order-event.entity';
// import { CustomerEntity } from '../inbox/entities/customer.entity';

// // ── DTOs ─────────────────────────────────────────────────────────────────────

// export interface UpsertStoreDto {
//   slug?: string;
//   customDomain?: string;
//   name: string;
//   description?: string;
//   logoUrl?: string;
//   bannerUrl?: string;
//   themeColor?: string;
//   currency?: string;
//   deliveryFee?: number;
//   minOrder?: number;
//   contactPhone?: string;
//   contactEmail?: string;
//   address?: string;
//   facebookUrl?: string;
//   instagramUrl?: string;
//   whatsappNumber?: string;
//   isActive?: boolean;
// }

// export interface CreateProductDto {
//   name: string;
//   description?: string;
//   price: number;
//   comparePrice?: number;
//   stock?: number;
//   images?: string[];
//   isActive?: boolean;
//   sortOrder?: number;
// }

// export interface StorefrontOrderDto {
//   customerName: string;
//   customerPhone: string;
//   customerEmail?: string;
//   deliveryAddress: string;
//   notes?: string;
//   items: { productId: string; quantity: number }[];
// }

// @Injectable()
// export class StorefrontService {
//   constructor(
//     @InjectRepository(StoreSettingsEntity)
//     private stores: Repository<StoreSettingsEntity>,
//     @InjectRepository(ProductEntity)
//     private products: Repository<ProductEntity>,
//     @InjectRepository(OrderItemEntity)
//     private orderItems: Repository<OrderItemEntity>,
//     @InjectRepository(OrderEntity)
//     private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private orderEvents: Repository<OrderEventEntity>,
//     @InjectRepository(CustomerEntity)
//     private customers: Repository<CustomerEntity>,
//   ) {}

//   // ── Store settings ────────────────────────────────────────────────────────

//   async getStoreBySlug(slug: string): Promise<StoreSettingsEntity> {
//     const store = await this.stores.findOne({
//       where: { slug, isActive: true } as any,
//     });
//     if (!store) throw new NotFoundException('Store not found');
//     return store;
//   }

//   async getStoreByDomain(domain: string): Promise<StoreSettingsEntity> {
//     const store = await this.stores.findOne({
//       where: { customDomain: domain, isActive: true } as any,
//     });
//     if (!store) throw new NotFoundException('Store not found');
//     return store;
//   }

//   async getStoreByOrgId(orgId: string): Promise<StoreSettingsEntity | null> {
//     return this.stores.findOne({ where: { orgId } as any });
//   }

//   async upsertStore(
//     orgId: string,
//     dto: UpsertStoreDto,
//   ): Promise<StoreSettingsEntity> {
//     const existing = await this.stores.findOne({ where: { orgId } as any });

//     if (existing) {
//       await this.stores.update({ id: existing.id }, dto as any);
//       return this.stores.findOne({
//         where: { id: existing.id },
//       }) as Promise<StoreSettingsEntity>;
//     }

//     // Auto-generate slug if not provided
//     if (!dto.slug) {
//       dto.slug = dto.name
//         .toLowerCase()
//         .replace(/[^a-z0-9]+/g, '-')
//         .replace(/^-|-$/g, '')
//         .slice(0, 80);
//       // Append random suffix to avoid conflicts
//       dto.slug = `${dto.slug}-${Math.random().toString(36).slice(2, 6)}`;
//     }

//     // Check slug uniqueness
//     const slugExists = await this.stores.findOne({
//       where: { slug: dto.slug } as any,
//     });
//     if (slugExists) throw new BadRequestException('Store slug already taken');

//     return this.stores.save(
//       this.stores.create({ orgId, ...dto } as any),
//     ) as unknown as StoreSettingsEntity;
//   }

//   // ── Products ──────────────────────────────────────────────────────────────

//   async listProducts(
//     orgId: string,
//     activeOnly = false,
//   ): Promise<ProductEntity[]> {
//     const where: any = { orgId };
//     if (activeOnly) where.isActive = true;
//     return this.products.find({
//       where,
//       order: { sortOrder: 'ASC', createdAt: 'DESC' } as any,
//     });
//   }

//   async getProduct(orgId: string, slugOrId: string): Promise<ProductEntity> {
//     const product = await this.products.findOne({
//       where: [
//         { orgId, slug: slugOrId },
//         { orgId, id: slugOrId },
//       ] as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');
//     return product;
//   }

//   async createProduct(
//     orgId: string,
//     dto: CreateProductDto,
//   ): Promise<ProductEntity> {
//     const slug = dto.name
//       .toLowerCase()
//       .replace(/[^a-z0-9]+/g, '-')
//       .replace(/^-|-$/g, '')
//       .slice(0, 200);

//     // Ensure unique slug
//     let finalSlug = slug;
//     const existing = await this.products.findOne({
//       where: { orgId, slug } as any,
//     });
//     if (existing)
//       finalSlug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

//     return this.products.save(
//       this.products.create({ orgId, slug: finalSlug, ...dto } as any),
//     ) as unknown as ProductEntity;
//   }

//   async updateProduct(
//     orgId: string,
//     id: string,
//     dto: Partial<CreateProductDto>,
//   ): Promise<ProductEntity> {
//     const product = await this.products.findOne({
//       where: { id, orgId } as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');
//     await this.products.update({ id }, dto as any);
//     return this.products.findOne({ where: { id } }) as Promise<ProductEntity>;
//   }

//   async deleteProduct(orgId: string, id: string): Promise<void> {
//     const product = await this.products.findOne({
//       where: { id, orgId } as any,
//     });
//     if (!product) throw new NotFoundException('Product not found');
//     await this.products.delete({ id });
//   }

//   // ── Public storefront order ───────────────────────────────────────────────

//   async createStorefrontOrder(
//     store: StoreSettingsEntity,
//     dto: StorefrontOrderDto,
//   ): Promise<{ orderId: string; total: number; currency: string }> {
//     if (!dto.items?.length)
//       throw new BadRequestException('Order must have at least one item');

//     // Fetch + validate products
//     const productIds = dto.items.map((i) => i.productId);
//     const products = await this.products.find({
//       where: productIds.map((id) => ({
//         id,
//         orgId: store.orgId,
//         isActive: true,
//       })) as any,
//     });

//     const productMap = new Map(products.map((p) => [p.id, p]));

//     // Build order items + calculate total
//     const items: { product: ProductEntity; quantity: number }[] = [];
//     for (const item of dto.items) {
//       const product = productMap.get(item.productId);
//       if (!product)
//         throw new BadRequestException(
//           `Product ${item.productId} not found or inactive`,
//         );
//       if (product.stock > 0 && item.quantity > product.stock) {
//         throw new BadRequestException(`Insufficient stock for ${product.name}`);
//       }
//       items.push({ product, quantity: item.quantity });
//     }

//     const subtotal = items.reduce(
//       (sum, i) => sum + i.product.price * i.quantity,
//       0,
//     );
//     const deliveryFee = store.deliveryFee ?? 0;
//     const total = subtotal + deliveryFee;

//     if (store.minOrder > 0 && subtotal < store.minOrder) {
//       throw new BadRequestException(
//         `Minimum order amount is ${store.minOrder} ${store.currency}`,
//       );
//     }

//     // Find or create customer by phone
//     let customer = await this.customers.findOne({
//       where: { orgId: store.orgId, phone: dto.customerPhone } as any,
//       order: { createdAt: 'DESC' } as any,
//     });

//     if (!customer) {
//       customer = (await this.customers.save(
//         this.customers.create({
//           orgId: store.orgId,
//           name: dto.customerName,
//           phone: dto.customerPhone,
//           email: dto.customerEmail,
//           addressText: dto.deliveryAddress,
//         }),
//       )) as unknown as CustomerEntity;
//     }

//     // Create order
//     const order = (await this.orders.save(
//       this.orders.create({
//         orgId: store.orgId,
//         customerId: customer.id,
//         status: OrderStatus.NEW,
//         subtotal,
//         deliveryFee,
//         total,
//         paidAmount: 0,
//         balanceDue: total,
//         paymentStatus: 'UNPAID',
//         currency: store.currency,
//         notes: dto.notes,
//         source: 'STOREFRONT',
//       } as any),
//     )) as unknown as OrderEntity;

//     // Create order items + decrement stock
//     for (const item of items) {
//       await (this.orderItems.save(
//         this.orderItems.create({
//           orgId: store.orgId,
//           orderId: order.id,
//           productId: item.product.id,
//           name: item.product.name,
//           price: item.product.price,
//           quantity: item.quantity,
//           total: item.product.price * item.quantity,
//           imageUrl: item.product.images?.[0] ?? null,
//         } as any),
//       ) as unknown as Promise<OrderItemEntity>);

//       // Decrement stock if tracked
//       if (item.product.stock > 0) {
//         await this.products.update({ id: item.product.id }, {
//           stock: item.product.stock - item.quantity,
//         } as any);
//       }
//     }

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId: store.orgId,
//         orderId: order.id,
//         type: 'ORDER_CREATED',
//         data: {
//           source: 'STOREFRONT',
//           storeSlug: store.slug,
//           customerName: dto.customerName,
//           customerPhone: dto.customerPhone,
//           itemCount: items.length,
//           total,
//         },
//       }),
//     );

//     return { orderId: order.id, total, currency: store.currency };
//   }

//   // ── Public order lookup ───────────────────────────────────────────────────

//   async getPublicOrder(orderId: string, phone: string) {
//     const order = await this.orders.findOne({
//       where: { id: orderId } as any,
//       relations: ['customer'],
//     });
//     if (!order) throw new NotFoundException('Order not found');

//     // Verify phone matches — security check
//     if (order.customer?.phone !== phone) {
//       throw new NotFoundException('Order not found');
//     }

//     const items = await this.orderItems.find({
//       where: { orderId: order.id } as any,
//     });

//     const shipments = await this.orders
//       .query(
//         `SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
//         [orderId],
//       )
//       .catch(() => []);

//     return {
//       id: order.id,
//       status: order.status,
//       paymentStatus: order.paymentStatus,
//       subtotal: order.subtotal,
//       deliveryFee: order.deliveryFee,
//       total: order.total,
//       paidAmount: order.paidAmount,
//       balanceDue: order.balanceDue,
//       currency: order.currency,
//       createdAt: order.createdAt,
//       items,
//       tracking: shipments[0] ?? null,
//     };
//   }

//   // ── Order items for admin ─────────────────────────────────────────────────

//   async getOrderItems(
//     orgId: string,
//     orderId: string,
//   ): Promise<OrderItemEntity[]> {
//     return this.orderItems.find({
//       where: { orgId, orderId } as any,
//     });
//   }
// }
