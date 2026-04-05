/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/modules/ai/ai.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Ctx } from '@app/common/utils/request-context';
import { AiService } from './ai.service';
import { ChannelEntity, ChannelType } from '../inbox/entities/channel.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProductEntity } from '../storefront/entities/product.entity';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

@Controller('v1/ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(
    private ai: AiService,
    private config: ConfigService,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    @InjectRepository(OrderEntity)
    private orders: Repository<OrderEntity>,
    @InjectRepository(ProductEntity)
    private products: Repository<ProductEntity>,
  ) {}

  // ── Token decrypt helper ───────────────────────────────────────────────────

  private decryptToken(accessTokenEnc: string): string {
    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const buf = Buffer.from(accessTokenEnc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const k = crypto.createHash('sha256').update(key).digest();
    const dc = crypto.createDecipheriv('aes-256-gcm', k, iv);
    dc.setAuthTag(tag);
    return Buffer.concat([dc.update(enc), dc.final()]).toString('utf8');
  }

  private async getChannel(orgId: string, type: ChannelType) {
    return this.channels.findOne({
      where: { orgId, type: type as any, status: 'ACTIVE' as any } as any,
    });
  }

  // ── Product from image URL ────────────────────────────────────────────────

  @Post('product/from-url')
  async productFromUrl(
    @Ctx() ctx: { orgId: string },
    @Body() body: { imageUrl: string; storeName?: string },
  ) {
    return this.ai.generateProductFromImage(
      body.imageUrl,
      undefined,
      undefined,
      body.storeName,
    );
  }

  // ── Product from uploaded image ───────────────────────────────────────────

  @Post('product/from-upload')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  async productFromUpload(
    @Ctx() ctx: { orgId: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { storeName?: string },
  ) {
    const base64 = file.buffer.toString('base64');
    return this.ai.generateProductFromImage(
      undefined,
      base64,
      file.mimetype,
      body.storeName,
    );
  }

  // ── Product SEO ────────────────────────────────────────────────────────────

  /**
   * POST /v1/ai/product/seo
   * Generates SEO title, description and keywords for a product.
   * Called when merchant opens the SEO tab in the product modal.
   */
  @Post('product/seo')
  async productSeo(
    @Body()
    body: {
      productName: string;
      productDescription?: string;
      productUrl?: string;
    },
  ) {
    return this.ai.generateProductSeo(
      body.productName,
      body.productDescription,
      body.productUrl,
    );
  }

  // ── Product description from name ─────────────────────────────────────────

  /**
   * POST /v1/ai/product/description
   * Generates a product description from the product name alone.
   * Called on blur of the product name field.
   */
  @Post('product/description')
  async productDescription(
    @Body() body: { productName: string; storeName?: string },
  ) {
    return this.ai.generateProductDescription(body.productName, body.storeName);
  }

  // ── Store SEO ──────────────────────────────────────────────────────────────

  /**
   * POST /v1/ai/store/seo
   * Generates SEO title, description and keywords for the store.
   * Called when merchant opens the SEO tab in store settings.
   */
  @Post('store/seo')
  async storeSeo(
    @Body()
    body: {
      storeName: string;
      storeDescription?: string;
      storeSlug?: string;
      storeUrl?: string;
    },
  ) {
    return this.ai.generateStoreSeo(
      body.storeName,
      body.storeDescription,
      body.storeSlug,
      body.storeUrl,
    );
  }

  // ── Store setup ────────────────────────────────────────────────────────────

  @Post('store/setup')
  async storeSetup(
    @Body()
    body: {
      businessName: string;
      businessType: string;
      targetAudience?: string;
    },
  ) {
    return this.ai.generateStoreSetup(
      body.businessName,
      body.businessType,
      body.targetAudience,
    );
  }

  // ── Facebook photos ────────────────────────────────────────────────────────

  @Get('facebook/photos')
  async facebookPhotos(@Ctx() ctx: { orgId: string }) {
    const channel = await this.getChannel(ctx.orgId, ChannelType.FACEBOOK);
    if (!channel?.accessTokenEnc) return { photos: [] };
    const token = this.decryptToken(channel.accessTokenEnc);
    const photos = await this.ai.fetchFacebookPagePhotos(
      channel.externalAccountId ?? channel.pageId ?? '',
      token,
    );
    return { photos };
  }

  // ── Instagram photos ───────────────────────────────────────────────────────

  /**
   * GET /v1/ai/instagram/photos
   * Fetches recent media from the connected Instagram Business account.
   * Used in the OG image picker and product import flow.
   */
  @Get('instagram/photos')
  async instagramPhotos(@Ctx() ctx: { orgId: string }) {
    const channel = await this.getChannel(ctx.orgId, ChannelType.INSTAGRAM);
    if (!channel?.accessTokenEnc) return { photos: [] };
    const token = this.decryptToken(channel.accessTokenEnc);
    const photos = await this.ai.fetchInstagramPhotos(
      channel.igBusinessId ?? channel.externalAccountId ?? '',
      token,
    );
    return { photos };
  }

  // ── Inbox reply ────────────────────────────────────────────────────────────

  @Post('inbox/reply')
  async inboxReply(
    @Ctx() ctx: { orgId: string },
    @Body()
    body: {
      message: string;
      storeName?: string;
      history?: string;
      orderContext?: string;
    },
  ) {
    return this.ai.generateInboxReply(
      body.message,
      body.storeName ?? 'Store',
      body.history,
      body.orderContext,
    );
  }

  // ── Growth report ──────────────────────────────────────────────────────────

  @Get('growth/report')
  async growthReport(@Ctx() ctx: { orgId: string }) {
    const [allOrders, allProducts] = await Promise.all([
      this.orders.find({
        where: { orgId: ctx.orgId } as any,
        order: { createdAt: 'DESC' } as any,
        take: 200,
      }),
      this.products.find({ where: { orgId: ctx.orgId } as any }),
    ]);

    const totalRevenue = allOrders.reduce((s, o) => s + o.total, 0);
    const avgOrderValue = allOrders.length
      ? Math.round(totalRevenue / allOrders.length)
      : 0;
    const pendingOrders = allOrders.filter(
      (o) => o.status === 'NEW' || o.status === 'CONFIRMED',
    ).length;
    const lowStock = allProducts
      .filter((p) => p.stock > 0 && p.stock <= 5)
      .map((p) => p.name);
    const noDesc = allProducts.filter((p) => !p.description).map((p) => p.name);
    const topProducts = allProducts.slice(0, 3).map((p) => p.name);

    return this.ai.generateGrowthReport(
      {
        totalOrders: allOrders.length,
        totalRevenue,
        avgOrderValue,
        pendingOrders,
        topProducts,
        lowStockProducts: lowStock,
        noDescriptionProducts: noDesc,
      },
      'My Store',
    );
  }
}
