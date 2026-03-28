/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/api/src/modules/live-sale/live-sale.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { LiveSaleEntity, LiveProduct } from './entities/live-sale.entity';
import { ProductEntity } from '../storefront/entities/product.entity';
import { PostEntity } from '../comments/entities/post.entity';
import { ChannelEntity, ChannelType } from '../inbox/entities/channel.entity';

export interface StartLiveSaleDto {
  postId: string;
  platformPostId: string;
  triggerKeywords?: string[];
  triggerDmTemplate?: string;
}

export interface QuickAddProductDto {
  name: string;
  price: number;
  imageUrl?: string;
  stock?: number;
}

export interface UpdateQueueDto {
  productQueue: LiveProduct[];
}

@Injectable()
export class LiveSaleService {
  private readonly logger = new Logger(LiveSaleService.name);

  constructor(
    @InjectRepository(LiveSaleEntity)
    private liveSales: Repository<LiveSaleEntity>,
    @InjectRepository(ProductEntity)
    private products: Repository<ProductEntity>,
    @InjectRepository(PostEntity)
    private posts: Repository<PostEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    private config: ConfigService,
  ) {}

  // ── Channel resolution + token decrypt ────────────────────────────────────

  private async getChannel(
    orgId: string,
  ): Promise<{ pageId: string; accessToken: string }> {
    const channel = await this.channels.findOne({
      where: { orgId, type: ChannelType.FACEBOOK, status: 'ACTIVE' } as any,
    });
    if (!channel) throw new BadRequestException('No active Facebook channel');

    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const buf = Buffer.from(channel.accessTokenEnc!, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const k = crypto.createHash('sha256').update(key).digest();
    const dc = crypto.createDecipheriv('aes-256-gcm', k, iv);
    dc.setAuthTag(tag);
    const accessToken = Buffer.concat([dc.update(data), dc.final()]).toString(
      'utf8',
    );

    return { pageId: channel.pageId!, accessToken };
  }

  // ── Session management ─────────────────────────────────────────────────────

  async startSession(
    orgId: string,
    dto: StartLiveSaleDto,
  ): Promise<LiveSaleEntity> {
    // Check for existing active session on this post
    const existing = await this.liveSales.findOne({
      where: { orgId, postId: dto.postId, status: 'active' } as any,
    });
    if (existing) return existing; // idempotent — return existing session

    const session = (await this.liveSales.save(
      this.liveSales.create({
        orgId,
        postId: dto.postId,
        platformPostId: dto.platformPostId,
        status: 'active',
        productQueue: [],
        triggerKeywords: dto.triggerKeywords ?? [
          'WANT',
          'want',
          'ORDER',
          'order',
          'চাই',
          'অর্ডার',
        ],
        triggerDmTemplate: dto.triggerDmTemplate,
        startedAt: new Date(),
      } as any),
    )) as unknown as LiveSaleEntity;

    return session;
  }

  async getSession(orgId: string, sessionId: string): Promise<LiveSaleEntity> {
    const session = await this.liveSales.findOne({
      where: { id: sessionId, orgId } as any,
    });
    if (!session) throw new NotFoundException('Live sale session not found');
    return session;
  }

  async getActiveSession(
    orgId: string,
    postId: string,
  ): Promise<LiveSaleEntity | null> {
    return this.liveSales.findOne({
      where: { orgId, postId, status: 'active' } as any,
    });
  }

  async endSession(orgId: string, sessionId: string): Promise<LiveSaleEntity> {
    const session = await this.getSession(orgId, sessionId);
    await this.liveSales.update({ id: session.id }, {
      status: 'ended',
      endedAt: new Date(),
    } as any);
    return this.liveSales.findOne({
      where: { id: session.id },
    }) as Promise<LiveSaleEntity>;
  }

  // ── Product queue ──────────────────────────────────────────────────────────

  /**
   * Add a product from the existing catalog to the queue.
   */
  async addProductFromCatalog(
    orgId: string,
    sessionId: string,
    productId: string,
  ): Promise<LiveSaleEntity> {
    const [session, product] = await Promise.all([
      this.getSession(orgId, sessionId),
      this.products.findOne({ where: { id: productId, orgId } as any }),
    ]);

    if (!product) throw new NotFoundException('Product not found');
    if (session.productQueue.some((p) => p.id === productId)) {
      throw new BadRequestException('Product already in queue');
    }

    const liveProduct: LiveProduct = {
      id: product.id,
      name: product.name,
      price: product.price,
      imageUrl: product.images?.[0],
      stock: product.stock,
      isSoldOut: false,
      orderCount: 0,
      sortOrder: session.productQueue.length,
    };

    const updated = [...session.productQueue, liveProduct];
    await this.liveSales.update({ id: session.id }, {
      productQueue: updated,
    } as any);
    return this.liveSales.findOne({
      where: { id: session.id },
    }) as Promise<LiveSaleEntity>;
  }

  /**
   * Quick-add a product on the fly during a live — name + price only.
   */
  async quickAddProduct(
    orgId: string,
    sessionId: string,
    dto: QuickAddProductDto,
  ): Promise<LiveSaleEntity> {
    const session = await this.getSession(orgId, sessionId);

    const liveProduct: LiveProduct = {
      id: `quick-${Date.now()}`,
      name: dto.name,
      price: dto.price,
      imageUrl: dto.imageUrl,
      stock: dto.stock,
      isSoldOut: false,
      orderCount: 0,
      sortOrder: session.productQueue.length,
    };

    const updated = [...session.productQueue, liveProduct];
    await this.liveSales.update({ id: session.id }, {
      productQueue: updated,
    } as any);
    return this.liveSales.findOne({
      where: { id: session.id },
    }) as Promise<LiveSaleEntity>;
  }

  /**
   * Update the full queue order after drag-and-drop reorder.
   */
  async updateQueue(
    orgId: string,
    sessionId: string,
    dto: UpdateQueueDto,
  ): Promise<LiveSaleEntity> {
    await this.getSession(orgId, sessionId);
    await this.liveSales.update({ id: sessionId }, {
      productQueue: dto.productQueue,
    } as any);
    return this.liveSales.findOne({
      where: { id: sessionId },
    }) as Promise<LiveSaleEntity>;
  }

  // ── Announce product ───────────────────────────────────────────────────────

  /**
   * Posts a comment to the live video announcing the current product.
   * Format: "📦 Now selling: {name} — ৳{price}\nComment WANT to order! 🛍️"
   */
  async announceProduct(
    orgId: string,
    sessionId: string,
    productId: string,
    customText?: string,
  ): Promise<{ commentId: string }> {
    const session = await this.getSession(orgId, sessionId);
    const product = session.productQueue.find((p) => p.id === productId);
    if (!product) throw new NotFoundException('Product not in queue');

    const { accessToken } = await this.getChannel(orgId);

    const text =
      customText ??
      [
        `📦 Now selling: ${product.name} — ৳${product.price.toLocaleString()}`,
        ``,
        `✅ In stock${product.stock ? `: ${product.stock} pieces` : ''}`,
        ``,
        `Comment WANT to order! 🛍️`,
        `চাই লিখুন অর্ডার করতে! 🛍️`,
      ].join('\n');

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${session.platformPostId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: accessToken }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new BadRequestException(`Facebook API error: ${err}`);
    }

    const data = (await res.json()) as any;

    // Update product's announce text
    const updated = session.productQueue.map((p) =>
      p.id === productId ? { ...p, announceText: text } : p,
    );
    await this.liveSales.update({ id: session.id }, {
      productQueue: updated,
    } as any);

    return { commentId: data.id };
  }

  // ── Sold out ───────────────────────────────────────────────────────────────

  /**
   * Marks a product as sold out:
   * 1. Posts a sold-out comment on the live
   * 2. Marks isSoldOut=true in the queue
   * The auto-hide of future availability comments is handled
   * by creating an auto-reply rule via CommentsService.
   */
  async markSoldOut(
    orgId: string,
    sessionId: string,
    productId: string,
  ): Promise<{ commentId: string }> {
    const session = await this.getSession(orgId, sessionId);
    const product = session.productQueue.find((p) => p.id === productId);
    if (!product) throw new NotFoundException('Product not in queue');
    if (product.isSoldOut)
      throw new BadRequestException('Already marked as sold out');

    const { accessToken } = await this.getChannel(orgId);

    const text = [
      `❌ SOLD OUT: ${product.name}`,
      ``,
      `🙏 Thank you everyone who ordered!`,
      `📦 Next product coming up soon... stay tuned!`,
    ].join('\n');

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${session.platformPostId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, access_token: accessToken }),
      },
    );

    if (!res.ok)
      throw new BadRequestException(`Facebook API error: ${await res.text()}`);
    const data = (await res.json()) as any;

    // Mark sold out in queue
    const updated = session.productQueue.map((p) =>
      p.id === productId ? { ...p, isSoldOut: true } : p,
    );
    await this.liveSales.update({ id: session.id }, {
      productQueue: updated,
    } as any);

    return { commentId: data.id };
  }

  // ── Keyword trigger (called from webhook/comment ingestion) ────────────────

  /**
   * Called when a new comment arrives during an active live.
   * If comment matches a trigger keyword, sends a payment link DM.
   */
  async handleIncomingComment(
    orgId: string,
    postId: string,
    senderId: string,
    senderName: string,
    text: string,
  ): Promise<void> {
    const session = await this.getActiveSession(orgId, postId);
    if (!session) return; // no active live session for this post

    // Find current (first non-sold-out) product
    const currentProduct = session.productQueue
      .filter((p) => !p.isSoldOut)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];

    if (!currentProduct) return; // all products sold out

    // Check if comment matches a trigger keyword
    const matched = session.triggerKeywords.some((kw) =>
      text.toLowerCase().includes(kw.toLowerCase()),
    );
    if (!matched) return;

    const { accessToken } = await this.getChannel(orgId);

    // Send payment link DM
    const dmText = session.triggerDmTemplate
      .replace(/{{name}}/g, senderName)
      .replace(/{{product}}/g, currentProduct.name)
      .replace(/{{price}}/g, currentProduct.price.toLocaleString())
      .replace(
        /{{link}}/g,
        `https://pay.commerceos.app/${orgId}/${currentProduct.id}`,
      );

    await fetch('https://graph.facebook.com/v19.0/me/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: dmText },
        access_token: accessToken,
      }),
    }).catch((err) => this.logger.error('DM send failed:', err));

    // Increment order count on the product
    const updated = session.productQueue.map((p) =>
      p.id === currentProduct.id ? { ...p, orderCount: p.orderCount + 1 } : p,
    );
    await this.liveSales.update({ id: session.id }, {
      productQueue: updated,
      totalOrders: session.totalOrders + 1,
      totalRevenue: session.totalRevenue + currentProduct.price,
      totalComments: session.totalComments + 1,
    } as any);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getStats(orgId: string, sessionId: string) {
    const session = await this.getSession(orgId, sessionId);
    const duration = session.startedAt
      ? Math.floor(
          (Date.now() - new Date(session.startedAt).getTime()) / 1000 / 60,
        )
      : 0;

    return {
      totalOrders: session.totalOrders,
      totalRevenue: session.totalRevenue,
      totalComments: session.totalComments,
      uniqueBuyers: session.uniqueBuyers,
      durationMins: duration,
      productQueue: session.productQueue,
      status: session.status,
    };
  }

  async listSessions(orgId: string): Promise<LiveSaleEntity[]> {
    return this.liveSales.find({
      where: { orgId } as any,
      order: { createdAt: 'DESC' } as any,
      take: 20,
    });
  }
}
