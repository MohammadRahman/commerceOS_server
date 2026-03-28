/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/storefront/storefront.controller.ts
//
// Changes from previous version:
//  - POST /v1/store/upload — new endpoint for hero images, product photos,
//    and OG images. Uses UploadService.uploadStoreMedia which allows images
//    and videos up to 20MB/50MB. Returns { url: string }.
//  - UploadModule imported in storefront.module.ts (see migration note below)
//
// MIGRATION NOTE: Add UploadModule to StorefrontModule imports:
//   imports: [..., UploadModule]
//   And add to constructor: private uploadService: UploadService

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import {
//   StorefrontService,
//   UpsertStoreDto,
//   CreateProductDto,
//   StorefrontOrderDto,
// } from './storefront.service';
import { UploadService } from '@app/common/upload';
import { StorefrontService } from './storefront.service';
import { UpsertStoreDto } from './dto/upsert-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { StorefrontOrderDto } from './dto/storefront-order.dto';

@Controller()
export class StorefrontController {
  constructor(
    private readonly storefrontService: StorefrontService,
    private readonly uploadService: UploadService,
  ) {}

  // ── Admin: store settings ──────────────────────────────────────────────────

  @Get('v1/store/settings')
  @UseGuards(JwtAuthGuard)
  async getStoreSettings(@Request() req: any) {
    const store = await this.storefrontService.getStoreByOrgId(req.user.orgId);
    return store ?? {};
  }

  @Post('v1/store/settings')
  @UseGuards(JwtAuthGuard)
  async upsertStoreSettings(@Request() req: any, @Body() body: UpsertStoreDto) {
    return this.storefrontService.upsertStore(req.user.orgId, body);
  }

  // ── Admin: file upload ─────────────────────────────────────────────────────

  /**
   * POST /v1/store/upload
   *
   * Accepts a single file via multipart/form-data field "file".
   * Supports: JPEG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV.
   * Images: max 20MB. Videos: max 50MB.
   * Returns: { url: string }
   *
   * Used by:
   *  - ImageUploader component (product photos, OG images)
   *  - HeroSlideEditor (hero background images and videos)
   */
  @Post('v1/store/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB hard cap at multer level
      },
    }),
  )
  async uploadStoreMedia(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('subfolder') subfolder?: string,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Send as multipart/form-data with field name "file".',
      );
    }

    const result = await this.uploadService.uploadStoreMedia(
      file.buffer,
      file.originalname,
      file.mimetype,
      req.user.orgId,
      subfolder ?? 'media',
    );

    return { url: result.url };
  }

  // ── Admin: products ────────────────────────────────────────────────────────

  @Get('v1/store/products')
  @UseGuards(JwtAuthGuard)
  async listAdminProducts(@Request() req: any) {
    return this.storefrontService.listProducts(req.user.orgId, false);
  }

  @Post('v1/store/products')
  @UseGuards(JwtAuthGuard)
  async createProduct(@Request() req: any, @Body() body: CreateProductDto) {
    return this.storefrontService.createProduct(req.user.orgId, body);
  }

  @Put('v1/store/products/:id')
  @UseGuards(JwtAuthGuard)
  async updateProduct(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: Partial<CreateProductDto>,
  ) {
    return this.storefrontService.updateProduct(req.user.orgId, id, body);
  }

  @Delete('v1/store/products/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async deleteProduct(@Request() req: any, @Param('id') id: string) {
    return this.storefrontService.deleteProduct(req.user.orgId, id);
  }

  // ── Public: storefront ─────────────────────────────────────────────────────

  @Get('s/:slug')
  async getPublicStore(@Param('slug') slug: string) {
    return this.storefrontService.getStoreBySlug(slug);
  }

  @Get('s/resolve')
  async resolveByDomain(@Query('domain') domain: string) {
    return this.storefrontService.getStoreByDomain(domain);
  }

  @Get('s/:slug/products')
  async getPublicProducts(@Param('slug') slug: string) {
    const store = await this.storefrontService.getStoreBySlug(slug);
    return this.storefrontService.listProducts(store.orgId, true);
  }

  @Get('s/:slug/products/:productSlug')
  async getPublicProduct(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
  ) {
    const store = await this.storefrontService.getStoreBySlug(slug);
    return this.storefrontService.getProduct(store.orgId, productSlug);
  }

  @Post('s/:slug/orders')
  async createPublicOrder(
    @Param('slug') slug: string,
    @Body() body: StorefrontOrderDto,
  ) {
    const store = await this.storefrontService.getStoreBySlug(slug);
    return this.storefrontService.createStorefrontOrder(store, body);
  }

  @Get('s/:slug/orders/:orderId')
  async getPublicOrder(
    @Param('orderId') orderId: string,
    @Query('phone') phone: string,
  ) {
    return this.storefrontService.getPublicOrder(orderId, phone);
  }
}
// apps/api/src/modules/storefront/storefront.controller.ts
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   Body,
//   Controller,
//   Delete,
//   Get,
//   Header,
//   Param,
//   Post,
//   Put,
//   Query,
//   Req,
//   UseGuards,
// } from '@nestjs/common';
// import type { Request } from 'express';
// import {
//   StorefrontService,
//   UpsertStoreDto,
//   CreateProductDto,
//   StorefrontOrderDto,
// } from './storefront.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { Ctx } from '@app/common/utils/request-context';

// @Controller()
// export class StorefrontController {
//   constructor(private storefront: StorefrontService) {}

//   // ══ ADMIN ROUTES (JWT protected) ══════════════════════════════════════════

//   @Get('v1/store/settings')
//   @UseGuards(JwtAuthGuard)
//   getSettings(@Ctx() ctx: { orgId: string }) {
//     return this.storefront.getStoreByOrgId(ctx.orgId);
//   }

//   @Post('v1/store/settings')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('settings:write')
//   upsertSettings(@Ctx() ctx: { orgId: string }, @Body() dto: UpsertStoreDto) {
//     return this.storefront.upsertStore(ctx.orgId, dto);
//   }

//   @Get('v1/store/products')
//   @UseGuards(JwtAuthGuard)
//   listProductsAdmin(@Ctx() ctx: { orgId: string }) {
//     return this.storefront.listProducts(ctx.orgId, false);
//   }

//   @Post('v1/store/products')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   createProduct(@Ctx() ctx: { orgId: string }, @Body() dto: CreateProductDto) {
//     return this.storefront.createProduct(ctx.orgId, dto);
//   }

//   @Put('v1/store/products/:id')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   updateProduct(
//     @Ctx() ctx: { orgId: string },
//     @Param('id') id: string,
//     @Body() dto: Partial<CreateProductDto>,
//   ) {
//     return this.storefront.updateProduct(ctx.orgId, id, dto);
//   }

//   @Delete('v1/store/products/:id')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   deleteProduct(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     return this.storefront.deleteProduct(ctx.orgId, id);
//   }

//   @Get('v1/orders/:id/items')
//   @UseGuards(JwtAuthGuard)
//   getOrderItems(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
//     return this.storefront.getOrderItems(ctx.orgId, orderId);
//   }

//   // ══ PUBLIC ROUTES (no auth) ════════════════════════════════════════════════

//   @Get('s/resolve')
//   async resolveByDomain(@Query('domain') domain: string, @Req() req: Request) {
//     const host =
//       domain || (req.headers['x-forwarded-host'] as string) || req.hostname;
//     const PLATFORM = 'xenlo.app';
//     if (host.endsWith(`.${PLATFORM}`)) {
//       const slug = host.replace(`.${PLATFORM}`, '');
//       return this.storefront.getStoreBySlug(slug);
//     }
//     return this.storefront.getStoreByDomain(host);
//   }

//   @Get('s/:slug')
//   getPublicStore(@Param('slug') slug: string, @Req() req: Request) {
//     const host = (req.headers['x-forwarded-host'] as string) ?? req.hostname;
//     if (host && !host.includes('xenlo.app') && !host.includes('localhost')) {
//       return this.storefront.getStoreByDomain(host);
//     }
//     return this.storefront.getStoreBySlug(slug);
//   }

//   @Get('s/:slug/products')
//   getPublicProducts(@Param('slug') slug: string) {
//     return this.storefront
//       .getStoreBySlug(slug)
//       .then((store) => this.storefront.listProducts(store.orgId, true));
//   }

//   @Get('s/:slug/products/:productSlug')
//   getPublicProduct(
//     @Param('slug') slug: string,
//     @Param('productSlug') productSlug: string,
//   ) {
//     return this.storefront
//       .getStoreBySlug(slug)
//       .then((store) => this.storefront.getProduct(store.orgId, productSlug));
//   }

//   @Get('s/:slug/sitemap.xml')
//   @Header('Content-Type', 'application/xml')
//   async sitemap(@Param('slug') slug: string) {
//     const store = await this.storefront.getStoreBySlug(slug);
//     const prods = await this.storefront.listProducts(store.orgId, true);
//     const origin = store.customDomain
//       ? `https://${store.customDomain}`
//       : `https://${store.slug}.xenlo.app`;

//     const urls = [
//       {
//         loc: `${origin}/`,
//         priority: '1.0',
//         changefreq: 'daily',
//         image: null as string | null,
//         imageTitle: null as string | null,
//       },
//       ...prods.map((p) => ({
//         loc: `${origin}/products/${p.slug}`,
//         priority: '0.8',
//         changefreq: 'weekly',
//         image: p.images?.[0] ?? null,
//         imageTitle: p.name,
//       })),
//     ];

//     return `<?xml version="1.0" encoding="UTF-8"?>
// <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
//         xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
// ${urls
//   .map(
//     (u) => `  <url>
//     <loc>${u.loc}</loc>
//     <changefreq>${u.changefreq}</changefreq>
//     <priority>${u.priority}</priority>${
//       u.image
//         ? `
//     <image:image>
//       <image:loc>${u.image}</image:loc>
//       <image:title>${u.imageTitle}</image:title>
//     </image:image>`
//         : ''
//     }
//   </url>`,
//   )
//   .join('\n')}
// </urlset>`;
//   }

//   @Get('s/:slug/robots.txt')
//   @Header('Content-Type', 'text/plain')
//   async robots(@Param('slug') slug: string) {
//     const store = await this.storefront.getStoreBySlug(slug);
//     const origin = store.customDomain
//       ? `https://${store.customDomain}`
//       : `https://${store.slug}.xenlo.app`;

//     return `User-agent: *
// Allow: /
// Disallow: /checkout
// Disallow: /orders/

// Sitemap: ${origin}/sitemap.xml`;
//   }

//   @Post('s/:slug/orders')
//   async placeOrder(
//     @Param('slug') slug: string,
//     @Body() dto: StorefrontOrderDto,
//   ) {
//     const store = await this.storefront.getStoreBySlug(slug);
//     return this.storefront.createStorefrontOrder(store, dto);
//   }

//   @Get('s/:slug/orders/:orderId')
//   async trackOrder(
//     @Param('slug') slug: string,
//     @Param('orderId') orderId: string,
//     @Query('phone') phone: string,
//   ) {
//     if (!phone) throw new Error('Phone number required');
//     return this.storefront.getPublicOrder(orderId, phone);
//   }
// }
