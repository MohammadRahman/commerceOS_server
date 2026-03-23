// apps/api/src/modules/storefront/storefront.controller.ts
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import * as storefrontService from './storefront.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RbacGuard, RequirePerm } from '@app/common';
import { Ctx } from '@app/common/utils/request-context';

@Controller()
export class StorefrontController {
  constructor(private storefront: storefrontService.StorefrontService) {}

  // ══ ADMIN ROUTES (JWT protected) ══════════════════════════════════════════

  // Store settings
  @Get('v1/store/settings')
  @UseGuards(JwtAuthGuard)
  getSettings(@Ctx() ctx: { orgId: string }) {
    return this.storefront.getStoreByOrgId(ctx.orgId);
  }

  @Post('v1/store/settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('settings:write')
  upsertSettings(
    @Ctx() ctx: { orgId: string },
    @Body() dto: storefrontService.UpsertStoreDto,
  ) {
    return this.storefront.upsertStore(ctx.orgId, dto);
  }

  // Products — admin CRUD
  @Get('v1/store/products')
  @UseGuards(JwtAuthGuard)
  listProductsAdmin(@Ctx() ctx: { orgId: string }) {
    return this.storefront.listProducts(ctx.orgId, false); // include inactive
  }

  @Post('v1/store/products')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('orders:write')
  createProduct(
    @Ctx() ctx: { orgId: string },
    @Body() dto: storefrontService.CreateProductDto,
  ) {
    return this.storefront.createProduct(ctx.orgId, dto);
  }

  @Put('v1/store/products/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('orders:write')
  updateProduct(
    @Ctx() ctx: { orgId: string },
    @Param('id') id: string,
    @Body() dto: Partial<storefrontService.CreateProductDto>,
  ) {
    return this.storefront.updateProduct(ctx.orgId, id, dto);
  }

  @Delete('v1/store/products/:id')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('orders:write')
  deleteProduct(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.storefront.deleteProduct(ctx.orgId, id);
  }

  // Order items for a specific order
  @Get('v1/orders/:id/items')
  @UseGuards(JwtAuthGuard)
  getOrderItems(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
    return this.storefront.getOrderItems(ctx.orgId, orderId);
  }

  // ══ PUBLIC ROUTES (no auth) ════════════════════════════════════════════════

  // Resolve store — by slug or custom domain
  @Get('s/:slug')
  getPublicStore(@Param('slug') slug: string, @Req() req: Request) {
    const host = (req.headers['x-forwarded-host'] as string) ?? req.hostname;
    // If host matches custom domain pattern, resolve by domain
    if (host && !host.includes('xenlo.app') && !host.includes('localhost')) {
      return this.storefront.getStoreByDomain(host);
    }
    return this.storefront.getStoreBySlug(slug);
  }

  // Public product list
  @Get('s/:slug/products')
  getPublicProducts(@Param('slug') slug: string) {
    return this.storefront
      .getStoreBySlug(slug)
      .then((store) => this.storefront.listProducts(store.orgId, true));
  }

  // Public product detail
  @Get('s/:slug/products/:productSlug')
  getPublicProduct(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
  ) {
    return this.storefront
      .getStoreBySlug(slug)
      .then((store) => this.storefront.getProduct(store.orgId, productSlug));
  }

  // Place order (public — customer checkout)
  @Post('s/:slug/orders')
  async placeOrder(
    @Param('slug') slug: string,
    @Body() dto: storefrontService.StorefrontOrderDto,
  ) {
    const store = await this.storefront.getStoreBySlug(slug);
    return this.storefront.createStorefrontOrder(store, dto);
  }

  // Public order tracking — requires phone verification
  @Get('s/:slug/orders/:orderId')
  async trackOrder(
    @Param('slug') slug: string,
    @Param('orderId') orderId: string,
    @Query('phone') phone: string,
  ) {
    if (!phone) throw new Error('Phone number required');
    return this.storefront.getPublicOrder(orderId, phone);
  }
}
