/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
// apps/worker/src/processors/live-sales.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, LIVE_SALE_JOBS } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import { LiveSaleEntity } from 'apps/api/src/modules/live-sale/entities/live-sale.entity';
import {
  OrderEntity,
  OrderStatus,
} from 'apps/api/src/modules/orders/entities/order.entity';
import { CustomerEntity } from 'apps/api/src/modules/inbox/entities/customer.entity';
import { PaymentsService } from 'apps/api/src/modules/payments/Payments.service.v2';
import Redis from 'ioredis';
import { InjectRedis } from '@app/common/queue/redis.decorators';

@Processor(QUEUE_NAMES.LIVE_SALES, { concurrency: 50 })
@Injectable()
export class LiveSalesProcessor extends WorkerHost {
  private readonly logger = new Logger(LiveSalesProcessor.name);

  constructor(
    private readonly queue: QueueService,
    private readonly payments: PaymentsService,
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(LiveSaleEntity)
    private readonly liveSales: Repository<LiveSaleEntity>,
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case LIVE_SALE_JOBS.PROCESS_COMMENT:
        return this.handleComment(job.data);
      case LIVE_SALE_JOBS.CREATE_ORDER:
        return this.handleCreateOrder(job.data);
      case LIVE_SALE_JOBS.SEND_PAYMENT_LINK:
        return this.handleSendPaymentLink(job.data);
      case LIVE_SALE_JOBS.UPDATE_COUNTERS:
        return this.handleUpdateCounters(job.data);
      default:
        this.logger.warn(`[LiveSales] Unknown job: ${job.name}`);
    }
  }

  // ─── Comment processing ────────────────────────────────────────────────────

  private async handleComment(data: {
    liveSaleId: string;
    orgId: string;
    commentId: string;
    senderId: string;
    senderName: string;
    text: string;
    platform: string;
  }) {
    // Redis dedup — much faster than DB for high-volume live events
    const dedupKey = `live:comment:${data.liveSaleId}:${data.commentId}`;
    const claimed = await this.redis.set(dedupKey, '1', 'EX', 3600, 'NX');
    if (!claimed) {
      this.logger.debug(
        `[LiveSales] Duplicate comment ${data.commentId} skipped`,
      );
      return;
    }

    const liveSale = await this.liveSales.findOne({
      where: { id: data.liveSaleId, orgId: data.orgId } as any,
    });

    if (!liveSale || liveSale.status !== 'active') {
      this.logger.debug(`[LiveSales] Live sale ${data.liveSaleId} not active`);
      return;
    }

    const keywords = liveSale.triggerKeywords?.length
      ? liveSale.triggerKeywords
      : ['WANT', 'want', 'ORDER', 'order', 'চাই', 'অর্ডার'];

    const hasIntent = keywords.some((k) => data.text.includes(k));

    if (hasIntent) {
      await this.queue.liveSale(LIVE_SALE_JOBS.CREATE_ORDER, {
        ...data,
        productQueue: liveSale.productQueue,
        triggerDmTemplate: liveSale.triggerDmTemplate,
      });
    }

    await this.queue.liveSale(LIVE_SALE_JOBS.UPDATE_COUNTERS, {
      liveSaleId: data.liveSaleId,
      orgId: data.orgId,
      hasIntent,
    });
  }

  // ─── Create order ──────────────────────────────────────────────────────────
  // Finds or creates the customer, picks the first available product
  // from the live sale queue, creates an order, then enqueues payment link.

  private async handleCreateOrder(data: {
    liveSaleId: string;
    orgId: string;
    senderId: string;
    senderName: string;
    platform: string;
    productQueue?: any[];
    triggerDmTemplate?: string;
  }) {
    this.logger.log(
      `[LiveSales] Creating order for ${data.senderName} in live ${data.liveSaleId}`,
    );

    // Find or create customer
    let customer = await this.customers.findOne({
      where: { orgId: data.orgId, name: data.senderName } as any,
    });
    if (!customer) {
      customer = (await this.customers.save(
        this.customers.create({
          orgId: data.orgId,
          name: data.senderName,
        } as any),
      )) as unknown as CustomerEntity;
    }

    // Pick first available product from queue
    const product = (data.productQueue ?? []).find(
      (p: any) => !p.isSoldOut && (p.stock === undefined || p.stock > 0),
    );

    if (!product) {
      this.logger.warn(
        `[LiveSales] No available product for live ${data.liveSaleId}`,
      );
      return;
    }

    const total = Number(product.price) || 0;

    const order = (await this.orders.save(
      this.orders.create({
        orgId: data.orgId,
        customerId: customer.id,
        status: OrderStatus.NEW,
        subtotal: total,
        total,
        currency: 'BDT',
        source: 'INBOX',
        notes: `Live sale: ${data.liveSaleId} | ${product.name}`,
        campaignTag: `live:${data.liveSaleId}`,
      } as any),
    )) as unknown as OrderEntity;

    this.logger.log(
      `[LiveSales] Order ${order.id} — ${product.name} ৳${total} for ${data.senderName}`,
    );

    // Update DB stats
    await this.liveSales.increment(
      { id: data.liveSaleId } as any,
      'totalOrders',
      1,
    );
    await this.liveSales.increment(
      { id: data.liveSaleId } as any,
      'totalRevenue',
      total,
    );

    // Enqueue payment link
    await this.queue.liveSale(LIVE_SALE_JOBS.SEND_PAYMENT_LINK, {
      liveSaleId: data.liveSaleId,
      orgId: data.orgId,
      senderId: data.senderId,
      senderName: data.senderName,
      orderId: order.id,
      productName: product.name,
      productPrice: product.price,
      triggerDmTemplate: data.triggerDmTemplate,
    });
  }

  // ─── Send payment link ─────────────────────────────────────────────────────
  // Delegates to PaymentsService.createPaymentLink() which:
  //  - Detects personal vs merchant mode from org's provider config
  //  - Generates bKash/Nagad instructions for personal mode
  //  - Auto-sends DM via AutoMessageService (already wired in PaymentsService)

  private async handleSendPaymentLink(data: {
    liveSaleId: string;
    orgId: string;
    senderId: string;
    senderName: string;
    orderId: string;
    productName: string;
    productPrice: number;
    triggerDmTemplate?: string;
  }) {
    this.logger.log(
      `[LiveSales] Sending payment link — order ${data.orderId} for ${data.senderName}`,
    );

    try {
      await this.payments.createPaymentLink(
        data.orgId,
        'system', // system-generated, no userId
        data.orderId,
        'bkash', // default provider for live sales in BD
        undefined, // payNow = full amount
        0, // no COD split for live
      );

      this.logger.log(`[LiveSales] Payment link sent — order ${data.orderId}`);
    } catch (err: any) {
      // Non-fatal — order exists, link can be sent manually from inbox
      this.logger.error(
        `[LiveSales] Payment link failed — order ${data.orderId}: ${err?.message}`,
      );
    }
  }

  // ─── Redis counters ────────────────────────────────────────────────────────

  private async handleUpdateCounters(data: {
    liveSaleId: string;
    orgId: string;
    hasIntent: boolean;
  }) {
    const pipe = this.redis.pipeline();
    pipe.incr(`live:${data.liveSaleId}:comments`);
    pipe.expire(`live:${data.liveSaleId}:comments`, 86400);
    if (data.hasIntent) {
      pipe.incr(`live:${data.liveSaleId}:orders`);
      pipe.expire(`live:${data.liveSaleId}:orders`, 86400);
    }
    await pipe.exec();
  }
}
