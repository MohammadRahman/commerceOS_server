// PATCH: apps/api/src/modules/storefront/storefront.controller.ts
// Add these two endpoints to existing StorefrontController

// ── 1. Resolve store by domain (for custom domains + subdomains) ──────────────
@Get('s/resolve')
async resolveByDomain(
  @Query('domain') domain: string,
  @Req() req: Request,
) {
  // Try query param first, then Host header
  const host = domain || (req.headers['x-forwarded-host'] as string) || req.hostname;
  const PLATFORM = 'xenlo.app';

  // Subdomain: nexlo-demo.xenlo.app → slug = nexlo-demo
  if (host.endsWith(`.${PLATFORM}`)) {
    const slug = host.replace(`.${PLATFORM}`, '');
    return this.storefront.getStoreBySlug(slug);
  }

  // Custom domain: nexlo-demo.com
  return this.storefront.getStoreByDomain(host);
}

// ── 2. Sitemap per store ───────────────────────────────────────────────────────
@Get('s/:slug/sitemap.xml')
@Header('Content-Type', 'application/xml')
async sitemap(@Param('slug') slug: string, @Req() req: Request) {
  const store  = await this.storefront.getStoreBySlug(slug);
  const prods  = await this.storefront.listProducts(store.orgId, true);
  const origin = store.customDomain
    ? `https://${store.customDomain}`
    : `https://${store.slug}.xenlo.app`;

  const urls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'daily' },
    ...prods.map((p) => ({
      loc: `${origin}/products/${p.slug}`,
      priority: '0.8',
      changefreq: 'weekly',
      image: p.images?.[0],
      imageTitle: p.name,
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
    ${u.image ? `<image:image>
      <image:loc>${u.image}</image:loc>
      <image:title>${u.imageTitle}</image:title>
    </image:image>` : ''}
  </url>`).join('\n')}
</urlset>`;

  return xml;
}

// ── 3. robots.txt per store ────────────────────────────────────────────────────
@Get('s/:slug/robots.txt')
@Header('Content-Type', 'text/plain')
async robots(@Param('slug') slug: string, @Req() req: Request) {
  const store  = await this.storefront.getStoreBySlug(slug);
  const origin = store.customDomain
    ? `https://${store.customDomain}`
    : `https://${store.slug}.xenlo.app`;

  return `User-agent: *
Allow: /
Disallow: /checkout
Disallow: /orders/

Sitemap: ${origin}/sitemap.xml`;
}

// ── 4. Add these imports to the controller ────────────────────────────────────
// import { Header } from '@nestjs/common';  ← add to existing imports
// import { Request } from 'express';        ← add to existing imports
// // apps/api/src/modules/storefront/storefront.controller.ts
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   Body,
//   Controller,
//   Delete,
//   Get,
//   Param,
//   Post,
//   Put,
//   Query,
//   Req,
//   UseGuards,
// } from '@nestjs/common';
// import type { Request } from 'express';
// import * as storefrontService from './storefront.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { Ctx } from '@app/common/utils/request-context';

// @Controller()
// export class StorefrontController {
//   constructor(private storefront: storefrontService.StorefrontService) {}

//   // ══ ADMIN ROUTES (JWT protected) ══════════════════════════════════════════

//   // Store settings
//   @Get('v1/store/settings')
//   @UseGuards(JwtAuthGuard)
//   getSettings(@Ctx() ctx: { orgId: string }) {
//     return this.storefront.getStoreByOrgId(ctx.orgId);
//   }

//   @Post('v1/store/settings')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   upsertSettings(
//     @Ctx() ctx: { orgId: string },
//     @Body() dto: storefrontService.UpsertStoreDto,
//   ) {
//     return this.storefront.upsertStore(ctx.orgId, dto);
//   }

//   // Products — admin CRUD
//   @Get('v1/store/products')
//   @UseGuards(JwtAuthGuard)
//   listProductsAdmin(@Ctx() ctx: { orgId: string }) {
//     return this.storefront.listProducts(ctx.orgId, false); // include inactive
//   }

//   @Post('v1/store/products')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   createProduct(
//     @Ctx() ctx: { orgId: string },
//     @Body() dto: storefrontService.CreateProductDto,
//   ) {
//     return this.storefront.createProduct(ctx.orgId, dto);
//   }

//   @Put('v1/store/products/:id')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   updateProduct(
//     @Ctx() ctx: { orgId: string },
//     @Param('id') id: string,
//     @Body() dto: Partial<storefrontService.CreateProductDto>,
//   ) {
//     return this.storefront.updateProduct(ctx.orgId, id, dto);
//   }

//   @Delete('v1/store/products/:id')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('orders:write')
//   deleteProduct(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     return this.storefront.deleteProduct(ctx.orgId, id);
//   }

//   // Order items for a specific order
//   @Get('v1/orders/:id/items')
//   @UseGuards(JwtAuthGuard)
//   getOrderItems(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
//     return this.storefront.getOrderItems(ctx.orgId, orderId);
//   }

//   // ══ PUBLIC ROUTES (no auth) ════════════════════════════════════════════════

//   // Resolve store — by slug or custom domain
//   @Get('s/:slug')
//   getPublicStore(@Param('slug') slug: string, @Req() req: Request) {
//     const host = (req.headers['x-forwarded-host'] as string) ?? req.hostname;
//     // If host matches custom domain pattern, resolve by domain
//     if (host && !host.includes('xenlo.app') && !host.includes('localhost')) {
//       return this.storefront.getStoreByDomain(host);
//     }
//     return this.storefront.getStoreBySlug(slug);
//   }

//   // Public product list
//   @Get('s/:slug/products')
//   getPublicProducts(@Param('slug') slug: string) {
//     return this.storefront
//       .getStoreBySlug(slug)
//       .then((store) => this.storefront.listProducts(store.orgId, true));
//   }

//   // Public product detail
//   @Get('s/:slug/products/:productSlug')
//   getPublicProduct(
//     @Param('slug') slug: string,
//     @Param('productSlug') productSlug: string,
//   ) {
//     return this.storefront
//       .getStoreBySlug(slug)
//       .then((store) => this.storefront.getProduct(store.orgId, productSlug));
//   }

//   // Place order (public — customer checkout)
//   @Post('s/:slug/orders')
//   async placeOrder(
//     @Param('slug') slug: string,
//     @Body() dto: storefrontService.StorefrontOrderDto,
//   ) {
//     const store = await this.storefront.getStoreBySlug(slug);
//     return this.storefront.createStorefrontOrder(store, dto);
//   }

//   // Public order tracking — requires phone verification
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
