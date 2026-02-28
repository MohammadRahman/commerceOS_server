/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
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
import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
import { IdempotencyService, OutboxService } from '@app/common';
import { PaymentLinkStatus } from './enums/payment-link.enum';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentLinkEntity)
    private links: Repository<PaymentLinkEntity>,
    @InjectRepository(PaymentEventEntity)
    private events: Repository<PaymentEventEntity>,
    @InjectRepository(OrderEntity)
    private orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private orderEvents: Repository<OrderEventEntity>,
    @InjectRepository(OrgPaymentProviderEntity)
    private orgPayments: Repository<OrgPaymentProviderEntity>,
    private outbox: OutboxService,
    private idem: IdempotencyService,
  ) {}

  // ── List payment links for an order ──────────────────────────────────────

  async listPaymentLinks(orgId: string, orderId: string) {
    return this.links.find({
      where: { orgId, orderId } as any,
      order: { createdAt: 'DESC' } as any,
    });
  }

  // ── Get single payment link ───────────────────────────────────────────────

  async getPaymentLink(orgId: string, linkId: string) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');
    return link;
  }

  // ── Create payment link ───────────────────────────────────────────────────

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

    // Validate provider is configured for this org
    const orgProvider = await this.orgPayments.findOne({
      where: { orgId, type: provider as any } as any,
    });

    // Allow creation even without credentials — worker will use fake fallback
    // But warn if provider is not active
    if (orgProvider && orgProvider.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Payment provider ${provider} is not active for this org`,
      );
    }

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

    // Enqueue background generation
    await this.outbox.enqueue(orgId, 'payment_link.generate', {
      paymentLinkId: link.id,
    });

    return link;
  }

  // ── Check payment status ──────────────────────────────────────────────────

  async checkPaymentStatus(orgId: string, linkId: string) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    return {
      id: link.id,
      provider: link.provider,
      amount: link.amount,
      status: link.status,
      url: link.url,
      providerRef: link.providerRef,
      createdAt: link.createdAt,
    };
  }

  // ── Get connected payment providers for org ───────────────────────────────

  async getOrgPaymentProviders(orgId: string) {
    return this.orgPayments.find({
      where: { orgId } as any,
      order: { createdAt: 'ASC' } as any,
    });
  }

  // ── Handle provider webhook ───────────────────────────────────────────────

  async handleProviderWebhook(provider: string, orgId: string, payload: any) {
    const reference =
      payload?.reference ||
      payload?.tran_id ||
      payload?.transactionId ||
      payload?.paymentID;

    if (!reference) return { ok: true, ignored: 'no_reference' };

    const ok = await this.idem.claim(
      orgId,
      `webhook:payments:${provider}`,
      String(reference),
      { ttlSeconds: 60 * 60 * 24 * 7 },
    );
    if (!ok) return { ok: true, duplicate: true };

    let link = await this.links.findOne({
      where: { orgId, provider, providerRef: String(reference) } as any,
    });

    if (!link) {
      link = await this.links.findOne({
        where: { orgId, id: String(reference), provider } as any,
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
      payload?.statusCode ||
      ''
    ).toLowerCase();

    const isPaid =
      status === 'paid' ||
      status === 'success' ||
      status === 'valid' ||
      status === '0000'; // bKash success code

    if (isPaid) {
      await this.links.update({ id: link.id, orgId } as any, {
        status: PaymentLinkStatus.PAID,
      });

      await this.events.save(
        this.events.create({
          orgId,
          paymentLinkId: link.id,
          type: 'PAYMENT_CONFIRMED',
          payload: { provider, reference },
        }),
      );

      await this.orderEvents.save(
        this.orderEvents.create({
          orgId,
          orderId: link.orderId,
          type: 'PAYMENT_CONFIRMED',
          data: { provider, reference, paymentLinkId: link.id },
        }),
      );
    }

    return { ok: true };
  }
}

// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
// } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { PaymentLinkEntity } from './entities/payment-link.entity';
// import { PaymentEventEntity } from './entities/payment-event.entity';
// import { OrderEntity } from '../orders/entities/order.entity';
// import { OrderEventEntity } from '../orders/entities/order-event.entity';
// import { IdempotencyService, OutboxService } from '@app/common';
// import { PaymentLinkStatus } from './enums/payment-link.enum';

// @Injectable()
// export class PaymentsService {
//   constructor(
//     @InjectRepository(PaymentLinkEntity)
//     private links: Repository<PaymentLinkEntity>,
//     @InjectRepository(PaymentEventEntity)
//     private events: Repository<PaymentEventEntity>,
//     @InjectRepository(OrderEntity) private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private orderEvents: Repository<OrderEventEntity>,
//     private outbox: OutboxService,
//     private idem: IdempotencyService,
//   ) {}

//   async createPaymentLink(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     provider = 'sslcommerz',
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');

//     if (order.total <= 0)
//       throw new BadRequestException('Order total must be > 0');

//     const link = await this.links.save(
//       this.links.create({
//         orgId,
//         orderId: order.id,
//         provider,
//         amount: order.total,
//         status: PaymentLinkStatus.CREATED,
//       }),
//     );

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId,
//         orderId: order.id,
//         type: 'PAYMENT_LINK_CREATED',
//         data: { userId, paymentLinkId: link.id, provider, amount: link.amount },
//       }),
//     );

//     // enqueue background generation (enterprise reliability)
//     await this.outbox.enqueue(orgId, 'payment_link.generate', {
//       paymentLinkId: link.id,
//     });

//     return link;
//   }

//   async handleProviderWebhook(provider: string, orgId: string, payload: any) {
//     // Dedup: provider should provide transaction/ref id.
//     // For now, accept a generic `reference` field. We'll map properly per provider later.
//     const reference =
//       payload?.reference || payload?.tran_id || payload?.transactionId;
//     if (!reference) return { ok: true, ignored: 'no_reference' };

//     const ok = await this.idem.claim(
//       orgId,
//       `webhook:payments:${provider}`,
//       String(reference),
//       { ttlSeconds: 60 * 60 * 24 * 7 },
//     );
//     if (!ok) return { ok: true, duplicate: true };

//     // Store raw webhook event for audit
//     // We'll locate payment link by providerRef or by link.id used as reference
//     let link = await this.links.findOne({
//       where: { orgId, provider, providerRef: String(reference) },
//     });

//     if (!link) {
//       // common approach: use internal paymentLinkId as reference when generating
//       link = await this.links.findOne({
//         where: { orgId, id: String(reference), provider },
//       });
//     }

//     if (!link) return { ok: true, ignored: 'unknown_reference' };

//     await this.events.save(
//       this.events.create({
//         orgId,
//         paymentLinkId: link.id,
//         type: 'PAYMENT_WEBHOOK_RECEIVED',
//         payload,
//       }),
//     );

//     const status = (
//       payload?.status ||
//       payload?.payment_status ||
//       ''
//     ).toLowerCase();

//     if (status === 'paid' || status === 'success' || status === 'valid') {
//       await this.links.update(
//         { id: link.id, orgId },
//         { status: PaymentLinkStatus.PAID },
//       );

//       await this.orderEvents.save(
//         this.orderEvents.create({
//           orgId,
//           orderId: link.orderId,
//           type: 'PAYMENT_CONFIRMED',
//           data: { provider, reference },
//         }),
//       );
//     }

//     return { ok: true };
//   }
// }
