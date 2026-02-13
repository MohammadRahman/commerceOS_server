/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentLinkEntity } from './entities/payment-link.entity';
import { PaymentEventEntity } from './entities/payment-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { IdempotencyService, OutboxService } from '@app/common';
import { PaymentLinkStatus } from './enums/payment-link.enum';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentLinkEntity)
    private links: Repository<PaymentLinkEntity>,
    @InjectRepository(PaymentEventEntity)
    private events: Repository<PaymentEventEntity>,
    @InjectRepository(OrderEntity) private orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private orderEvents: Repository<OrderEventEntity>,
    private outbox: OutboxService,
    private idem: IdempotencyService,
  ) {}

  async createPaymentLink(
    orgId: string,
    userId: string,
    orderId: string,
    provider = 'sslcommerz',
  ) {
    const order = await this.orders.findOne({ where: { id: orderId, orgId } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.total <= 0)
      throw new BadRequestException('Order total must be > 0');

    const link = await this.links.save(
      this.links.create({
        orgId,
        orderId: order.id,
        provider,
        amount: order.total,
        status: PaymentLinkStatus.CREATED,
      }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: order.id,
        type: 'PAYMENT_LINK_CREATED',
        data: { userId, paymentLinkId: link.id, provider, amount: link.amount },
      }),
    );

    // enqueue background generation (enterprise reliability)
    await this.outbox.enqueue(orgId, 'payment_link.generate', {
      paymentLinkId: link.id,
    });

    return link;
  }

  async handleProviderWebhook(provider: string, orgId: string, payload: any) {
    // Dedup: provider should provide transaction/ref id.
    // For now, accept a generic `reference` field. We'll map properly per provider later.
    const reference =
      payload?.reference || payload?.tran_id || payload?.transactionId;
    if (!reference) return { ok: true, ignored: 'no_reference' };

    const ok = await this.idem.claim(
      orgId,
      `webhook:payments:${provider}`,
      String(reference),
      { ttlSeconds: 60 * 60 * 24 * 7 },
    );
    if (!ok) return { ok: true, duplicate: true };

    // Store raw webhook event for audit
    // We'll locate payment link by providerRef or by link.id used as reference
    let link = await this.links.findOne({
      where: { orgId, provider, providerRef: String(reference) },
    });

    if (!link) {
      // common approach: use internal paymentLinkId as reference when generating
      link = await this.links.findOne({
        where: { orgId, id: String(reference), provider },
      });
    }

    if (!link) return { ok: true, ignored: 'unknown_reference' };

    await this.events.save(
      this.events.create({
        orgId,
        paymentLinkId: link.id,
        type: 'PAYMENT_WEBHOOK_RECEIVED',
        payload,
      }),
    );

    const status = (
      payload?.status ||
      payload?.payment_status ||
      ''
    ).toLowerCase();

    if (status === 'paid' || status === 'success' || status === 'valid') {
      await this.links.update(
        { id: link.id, orgId },
        { status: PaymentLinkStatus.PAID },
      );

      await this.orderEvents.save(
        this.orderEvents.create({
          orgId,
          orderId: link.orderId,
          type: 'PAYMENT_CONFIRMED',
          data: { provider, reference },
        }),
      );
    }

    return { ok: true };
  }
}
