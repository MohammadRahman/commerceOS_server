// v4
// v3 — fixed:
//   1. link.expiresAt removed (field doesn't exist on PaymentLinkEntity)
//   2. this.links.save() result cast to PaymentLinkEntity (single entity overload)
//      to prevent TypeScript inferring PaymentLinkEntity[] on subsequent .id access
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
import { UploadService } from '@app/common/upload/upload.service';

export enum PaymentMode {
  PERSONAL = 'personal',
  MERCHANT = 'merchant',
}

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
    private upload: UploadService,
  ) {}

  // ── List payment links for an order ──────────────────────────────────────

  async listPaymentLinks(orgId: string, orderId: string) {
    const links = await this.links.find({
      where: { orgId, orderId } as any,
      order: { createdAt: 'DESC' } as any,
    });

    return Promise.all(
      links.map(async (link) => {
        const screenshotEvent = await this.events.findOne({
          where: {
            paymentLinkId: link.id,
            type: 'PAYMENT_SCREENSHOT_UPLOADED',
          } as any,
          order: { createdAt: 'DESC' } as any,
        });
        return {
          ...link,
          payNow: link.amount,
          codAmount: link.codAmount ?? 0,
          trxId: link.trxId ?? null,
          screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
        };
      }),
    );
  }

  // ── Get public payment link (no auth — customer-facing) ───────────────────

  async getPublicPaymentLink(linkId: string) {
    const link = await this.links.findOne({
      where: { id: linkId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const orgProvider = await this.orgPayments.findOne({
      where: { orgId: link.orgId, type: link.provider as any } as any,
    });

    const mode = this.detectMode(link.provider, orgProvider?.config);

    let instruction: object | undefined;
    if (mode === PaymentMode.PERSONAL && orgProvider?.config) {
      instruction = this.generatePaymentInstruction(
        link.provider,
        orgProvider.config,
        link.amount,
        link.orderId,
      );
    }

    return {
      id: link.id,
      orgId: link.orgId,
      provider: link.provider,
      amount: link.amount,
      codAmount: link.codAmount ?? 0,
      currency: 'BDT',
      status: link.status,
      mode,
      url: mode === PaymentMode.MERCHANT ? link.url : undefined,
      instruction: mode === PaymentMode.PERSONAL ? instruction : undefined,
      // expiresAt removed — not a column on PaymentLinkEntity
    };
  }

  // ── Get single payment link (authenticated) ───────────────────────────────

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
    payNow?: number,
    due = 0,
  ) {
    const order = await this.orders.findOne({ where: { id: orderId, orgId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.total <= 0)
      throw new BadRequestException('Order total must be > 0');

    const orgProvider = await this.orgPayments.findOne({
      where: { orgId, type: provider as any } as any,
    });

    if (orgProvider && orgProvider.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Payment provider ${provider} is not active for this org`,
      );
    }

    const mode = this.detectMode(provider, orgProvider?.config);
    const onlineAmt = payNow ?? order.total;
    const codAmt = due ?? 0;

    // Explicit cast so TypeScript picks the single-entity overload of save()
    // Without this, `as any` on the create() arg makes TS infer PaymentLinkEntity[]
    const link = (await this.links.save(
      this.links.create({
        orgId,
        orderId: order.id,
        provider,
        amount: onlineAmt,
        codAmount: codAmt,
        status: PaymentLinkStatus.CREATED,
      } as any),
    )) as unknown as PaymentLinkEntity;

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: order.id,
        type: 'PAYMENT_LINK_CREATED',
        data: {
          userId,
          paymentLinkId: link.id,
          provider,
          mode,
          amount: onlineAmt,
          codAmount: codAmt,
        },
      }),
    );

    if (mode === PaymentMode.PERSONAL) {
      const instruction = this.generatePaymentInstruction(
        provider,
        orgProvider?.config ?? {},
        onlineAmt,
        order.id,
      );

      await this.links.update(
        { id: link.id, orgId } as any,
        {
          url: instruction.instructionText,
          providerRef: `MANUAL-${link.id}`,
          status: 'SENT',
        } as any,
      );

      await this.events.save(
        this.events.create({
          orgId,
          paymentLinkId: link.id,
          type: 'PAYMENT_INSTRUCTION_GENERATED',
          payload: instruction,
        }),
      );

      return { ...link, mode, instruction, codAmount: codAmt };
    }

    await this.outbox.enqueue(orgId, 'payment_link.generate', {
      paymentLinkId: link.id,
    });

    return { ...link, mode, codAmount: codAmt };
  }

  // ── Upload payment screenshot / trxId (public — no auth) ─────────────────

  async uploadPaymentScreenshot(
    orgId: string,
    linkId: string,
    buffer: Buffer | null,
    originalName: string,
    mimeType: string,
    trxId?: string,
  ) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    let screenshotUrl: string | null = null;

    if (buffer && buffer.length > 0) {
      const result = await this.upload.uploadPaymentScreenshot(
        buffer,
        originalName,
        mimeType,
        orgId,
        linkId,
      );
      screenshotUrl = result.url;

      await this.events.save(
        this.events.create({
          orgId,
          paymentLinkId: link.id,
          type: 'PAYMENT_SCREENSHOT_UPLOADED',
          payload: {
            screenshotUrl: result.url,
            publicId: result.publicId,
            uploadedAt: new Date().toISOString(),
          },
        }),
      );
    }

    await this.links.update(
      { id: link.id, orgId } as any,
      {
        status: 'SCREENSHOT_UPLOADED',
        ...(trxId?.trim() ? { trxId: trxId.trim() } : {}),
      } as any,
    );

    return {
      screenshotUrl,
      paymentLinkId: link.id,
      message: 'Proof submitted. Waiting for merchant confirmation.',
    };
  }

  // ── Confirm manual payment or refund ──────────────────────────────────────

  async confirmManualPayment(
    orgId: string,
    linkId: string,
    userId: string,
    transactionId?: string,
  ) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');
    if (link.status === PaymentLinkStatus.PAID) {
      throw new BadRequestException('Already confirmed');
    }

    await this.links.update(
      { id: link.id, orgId } as any,
      {
        status: PaymentLinkStatus.PAID,
        ...(transactionId ? { trxId: transactionId } : {}),
      } as any,
    );

    await this.events.save(
      this.events.create({
        orgId,
        paymentLinkId: link.id,
        type: 'PAYMENT_MANUALLY_CONFIRMED',
        payload: { confirmedBy: userId, transactionId },
      }),
    );

    if (link.orderId) {
      const order = await this.orders.findOne({
        where: { id: link.orderId, orgId } as any,
      });

      if (order) {
        const isRefundLink =
          typeof link.providerRef === 'string' &&
          link.providerRef.startsWith('REFUND-');

        if (isRefundLink) {
          order.paymentStatus = 'REFUNDED';
          await this.orders.save(order);

          await this.orderEvents.save(
            this.orderEvents.create({
              orgId,
              orderId: order.id,
              type: 'REFUND_CONFIRMED',
              data: {
                paymentLinkId: link.id,
                confirmedBy: userId,
                transactionId,
                amount: link.amount,
              },
            }),
          );
        } else {
          const paidLinks = await this.links.find({
            where: {
              orderId: link.orderId,
              orgId,
              status: PaymentLinkStatus.PAID,
            } as any,
          });

          const totalPaid = paidLinks.reduce(
            (sum, l) => sum + (Number(l.amount) || 0),
            0,
          );

          order.paidAmount = totalPaid;
          order.balanceDue = Math.max(0, order.total - totalPaid);
          order.paymentStatus =
            order.balanceDue === 0
              ? 'PAID'
              : totalPaid > 0
                ? 'PARTIALLY_PAID'
                : 'UNPAID';

          await this.orders.save(order);

          await this.orderEvents.save(
            this.orderEvents.create({
              orgId,
              orderId: order.id,
              type: 'PAYMENT_CONFIRMED',
              data: {
                paymentLinkId: link.id,
                confirmedBy: userId,
                transactionId,
                amount: link.amount,
                paidAmount: order.paidAmount,
                balanceDue: order.balanceDue,
                paymentStatus: order.paymentStatus,
                mode: 'manual',
              },
            }),
          );
        }
      }
    }

    return { confirmed: true, paymentLinkId: link.id };
  }

  // ── Get payment link with events ──────────────────────────────────────────

  async getPaymentLinkWithEvents(orgId: string, linkId: string) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const linkEvents = await this.events.find({
      where: { paymentLinkId: linkId, orgId } as any,
      order: { createdAt: 'ASC' } as any,
    });

    const screenshotEvent = linkEvents
      .filter((e) => e.type === 'PAYMENT_SCREENSHOT_UPLOADED')
      .pop();

    return {
      ...link,
      payNow: link.amount,
      codAmount: link.codAmount ?? 0,
      trxId: link.trxId ?? null,
      screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
      events: linkEvents,
    };
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

    const statusStr = (
      payload?.status ||
      payload?.payment_status ||
      payload?.statusCode ||
      ''
    ).toLowerCase();

    const isPaid =
      statusStr === 'paid' ||
      statusStr === 'success' ||
      statusStr === 'valid' ||
      statusStr === '0000';

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

      if (link.orderId) {
        const order = await this.orders.findOne({
          where: { id: link.orderId, orgId } as any,
        });
        if (order) {
          const paidLinks = await this.links.find({
            where: {
              orderId: link.orderId,
              orgId,
              status: PaymentLinkStatus.PAID,
            } as any,
          });
          const totalPaid = paidLinks.reduce(
            (sum, l) => sum + (Number(l.amount) || 0),
            0,
          );
          order.paidAmount = totalPaid;
          order.balanceDue = Math.max(0, order.total - totalPaid);
          order.paymentStatus =
            order.balanceDue === 0
              ? 'PAID'
              : totalPaid > 0
                ? 'PARTIALLY_PAID'
                : 'UNPAID';
          await this.orders.save(order);
        }
      }

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

  // ── Create refund link ────────────────────────────────────────────────────

  async createRefundLink(
    orgId: string,
    userId: string,
    orderId: string,
    provider = 'bkash',
  ) {
    const order = await this.orders.findOne({ where: { id: orderId, orgId } });
    if (!order) throw new NotFoundException('Order not found');

    const isRefundable =
      order.status === 'RETURNED' ||
      (order.status === 'CANCELLED' && (order.paidAmount ?? 0) > 0);

    if (!isRefundable) {
      throw new BadRequestException(
        'Refunds can only be issued for returned orders, or cancelled orders where payment was collected',
      );
    }

    const refundAmount = order.paidAmount ?? 0;

    if (refundAmount <= 0) {
      throw new BadRequestException(
        'No payment has been collected for this order — nothing to refund',
      );
    }

    const orgProvider = await this.orgPayments.findOne({
      where: { orgId, type: provider as any } as any,
    });

    const mode = this.detectMode(provider, orgProvider?.config);

    // Explicit cast — same reason as createPaymentLink
    const link = await this.links.save(
      this.links.create({
        orgId,
        orderId: order.id,
        provider,
        amount: refundAmount,
        status: PaymentLinkStatus.CREATED,
      }),
    );

    await this.orders.save(
      Object.assign(order, { paymentStatus: 'REFUND_PENDING' }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: order.id,
        type: 'REFUND_LINK_CREATED',
        data: {
          userId,
          paymentLinkId: link.id,
          provider,
          mode,
          amount: refundAmount,
          orderStatus: order.status,
        },
      }),
    );

    if (mode === PaymentMode.PERSONAL) {
      const instruction = this.generatePaymentInstruction(
        provider,
        orgProvider?.config ?? {},
        refundAmount,
        order.id,
      );

      await this.links.update(
        { id: link.id, orgId } as any,
        {
          url: instruction.instructionText,
          providerRef: `REFUND-${link.id}`,
          status: 'SENT',
        } as any,
      );

      await this.events.save(
        this.events.create({
          orgId,
          paymentLinkId: link.id,
          type: 'PAYMENT_INSTRUCTION_GENERATED',
          payload: { ...instruction, isRefund: true },
        }),
      );

      return { ...link, amount: refundAmount, mode, instruction };
    }

    await this.outbox.enqueue(orgId, 'payment_link.generate', {
      paymentLinkId: link.id,
      isRefund: true,
    });

    return { ...link, amount: refundAmount, mode };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private detectMode(provider: string, config: any): PaymentMode {
    if (!config) return PaymentMode.PERSONAL;
    const hasMerchantConfig =
      config.apiKey || config.storeId || config.merchantId;
    return hasMerchantConfig ? PaymentMode.MERCHANT : PaymentMode.PERSONAL;
  }

  private generatePaymentInstruction(
    provider: string,
    config: any,
    amount: number,
    orderId: string,
  ): {
    instructionText: string;
    provider: string;
    amount: number;
    orderId: string;
  } {
    const account = config?.accountNumber ?? config?.merchantMobile ?? 'N/A';
    const name = config?.accountName ?? config?.merchantName ?? provider;
    const instructionText =
      `Please send ${amount} BDT to ${provider.toUpperCase()} number: ${account} (${name}). ` +
      `Use order ID ${orderId} as the reference/note.`;
    return { instructionText, provider, amount, orderId };
  }
}
// // v3 — fixed:
// //   1. link.expiresAt removed (field doesn't exist on PaymentLinkEntity)
// //   2. this.links.save() result cast to PaymentLinkEntity (single entity overload)
// //      to prevent TypeScript inferring PaymentLinkEntity[] on subsequent .id access
// /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
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
// import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
// import { IdempotencyService, OutboxService } from '@app/common';
// import { PaymentLinkStatus } from './enums/payment-link.enum';
// import { UploadService } from '@app/common/upload/upload.service';

// export enum PaymentMode {
//   PERSONAL = 'personal',
//   MERCHANT = 'merchant',
// }

// @Injectable()
// export class PaymentsService {
//   constructor(
//     @InjectRepository(PaymentLinkEntity)
//     private links: Repository<PaymentLinkEntity>,
//     @InjectRepository(PaymentEventEntity)
//     private events: Repository<PaymentEventEntity>,
//     @InjectRepository(OrderEntity)
//     private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private orderEvents: Repository<OrderEventEntity>,
//     @InjectRepository(OrgPaymentProviderEntity)
//     private orgPayments: Repository<OrgPaymentProviderEntity>,
//     private outbox: OutboxService,
//     private idem: IdempotencyService,
//     private upload: UploadService,
//   ) {}

//   // ── List payment links for an order ──────────────────────────────────────

//   async listPaymentLinks(orgId: string, orderId: string) {
//     const links = await this.links.find({
//       where: { orgId, orderId } as any,
//       order: { createdAt: 'DESC' } as any,
//     });

//     return Promise.all(
//       links.map(async (link) => {
//         const screenshotEvent = await this.events.findOne({
//           where: {
//             paymentLinkId: link.id,
//             type: 'PAYMENT_SCREENSHOT_UPLOADED',
//           } as any,
//           order: { createdAt: 'DESC' } as any,
//         });
//         return {
//           ...link,
//           payNow: link.amount,
//           codAmount: link.codAmount ?? 0,
//           trxId: link.trxId ?? null,
//           screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
//         };
//       }),
//     );
//   }

//   // ── Get public payment link (no auth — customer-facing) ───────────────────

//   async getPublicPaymentLink(linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId: link.orgId, type: link.provider as any } as any,
//     });

//     const mode = this.detectMode(link.provider, orgProvider?.config);

//     let instruction: object | undefined;
//     if (mode === PaymentMode.PERSONAL && orgProvider?.config) {
//       instruction = this.generatePaymentInstruction(
//         link.provider,
//         orgProvider.config,
//         link.amount,
//         link.orderId,
//       );
//     }

//     return {
//       id: link.id,
//       orgId: link.orgId,
//       provider: link.provider,
//       amount: link.amount,
//       codAmount: link.codAmount ?? 0,
//       currency: 'BDT',
//       status: link.status,
//       mode,
//       url: mode === PaymentMode.MERCHANT ? link.url : undefined,
//       instruction: mode === PaymentMode.PERSONAL ? instruction : undefined,
//       // expiresAt removed — not a column on PaymentLinkEntity
//     };
//   }

//   // ── Get single payment link (authenticated) ───────────────────────────────

//   async getPaymentLink(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');
//     return link;
//   }

//   // ── Create payment link ───────────────────────────────────────────────────

//   async createPaymentLink(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     provider = 'sslcommerz',
//     payNow?: number,
//     due = 0,
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');
//     if (order.total <= 0)
//       throw new BadRequestException('Order total must be > 0');

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId, type: provider as any } as any,
//     });

//     if (orgProvider && orgProvider.status !== 'ACTIVE') {
//       throw new BadRequestException(
//         `Payment provider ${provider} is not active for this org`,
//       );
//     }

//     const mode = this.detectMode(provider, orgProvider?.config);
//     const onlineAmt = payNow ?? order.total;
//     const codAmt = due ?? 0;

//     // Explicit cast so TypeScript picks the single-entity overload of save()
//     // Without this, `as any` on the create() arg makes TS infer PaymentLinkEntity[]
//     const link = await this.links.save(
//       this.links.create({
//         orgId,
//         orderId: order.id,
//         provider,
//         amount: onlineAmt,
//         codAmount: codAmt,
//         status: PaymentLinkStatus.CREATED,
//       } as any),
//     );

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId,
//         orderId: order.id,
//         type: 'PAYMENT_LINK_CREATED',
//         data: {
//           userId,
//           paymentLinkId: link.id,
//           provider,
//           mode,
//           amount: onlineAmt,
//           codAmount: codAmt,
//         },
//       }),
//     );

//     if (mode === PaymentMode.PERSONAL) {
//       const instruction = this.generatePaymentInstruction(
//         provider,
//         orgProvider?.config ?? {},
//         onlineAmt,
//         order.id,
//       );

//       await this.links.update(
//         { id: link.id, orgId } as any,
//         {
//           url: instruction.instructionText,
//           providerRef: `MANUAL-${link.id}`,
//           status: 'SENT',
//         } as any,
//       );

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_INSTRUCTION_GENERATED',
//           payload: instruction,
//         }),
//       );

//       return { ...link, mode, instruction, codAmount: codAmt };
//     }

//     await this.outbox.enqueue(orgId, 'payment_link.generate', {
//       paymentLinkId: link.id,
//     });

//     return { ...link, mode, codAmount: codAmt };
//   }

//   // ── Upload payment screenshot / trxId (public — no auth) ─────────────────

//   async uploadPaymentScreenshot(
//     orgId: string,
//     linkId: string,
//     buffer: Buffer | null,
//     originalName: string,
//     mimeType: string,
//     trxId?: string,
//   ) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     let screenshotUrl: string | null = null;

//     if (buffer && buffer.length > 0) {
//       const result = await this.upload.uploadPaymentScreenshot(
//         buffer,
//         originalName,
//         mimeType,
//         orgId,
//         linkId,
//       );
//       screenshotUrl = result.url;

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_SCREENSHOT_UPLOADED',
//           payload: {
//             screenshotUrl: result.url,
//             publicId: result.publicId,
//             uploadedAt: new Date().toISOString(),
//           },
//         }),
//       );
//     }

//     await this.links.update(
//       { id: link.id, orgId } as any,
//       {
//         status: 'SCREENSHOT_UPLOADED',
//         ...(trxId?.trim() ? { trxId: trxId.trim() } : {}),
//       } as any,
//     );

//     return {
//       screenshotUrl,
//       paymentLinkId: link.id,
//       message: 'Proof submitted. Waiting for merchant confirmation.',
//     };
//   }

//   // ── Confirm manual payment or refund ──────────────────────────────────────

//   async confirmManualPayment(
//     orgId: string,
//     linkId: string,
//     userId: string,
//     transactionId?: string,
//   ) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');
//     if (link.status === PaymentLinkStatus.PAID) {
//       throw new BadRequestException('Already confirmed');
//     }

//     await this.links.update(
//       { id: link.id, orgId } as any,
//       {
//         status: PaymentLinkStatus.PAID,
//         ...(transactionId ? { trxId: transactionId } : {}),
//       } as any,
//     );

//     await this.events.save(
//       this.events.create({
//         orgId,
//         paymentLinkId: link.id,
//         type: 'PAYMENT_MANUALLY_CONFIRMED',
//         payload: { confirmedBy: userId, transactionId },
//       }),
//     );

//     if (link.orderId) {
//       const order = await this.orders.findOne({
//         where: { id: link.orderId, orgId } as any,
//       });

//       if (order) {
//         const isRefundLink =
//           typeof link.providerRef === 'string' &&
//           link.providerRef.startsWith('REFUND-');

//         if (isRefundLink) {
//           order.paymentStatus = 'REFUNDED';
//           await this.orders.save(order);

//           await this.orderEvents.save(
//             this.orderEvents.create({
//               orgId,
//               orderId: order.id,
//               type: 'REFUND_CONFIRMED',
//               data: {
//                 paymentLinkId: link.id,
//                 confirmedBy: userId,
//                 transactionId,
//                 amount: link.amount,
//               },
//             }),
//           );
//         } else {
//           const paidLinks = await this.links.find({
//             where: {
//               orderId: link.orderId,
//               orgId,
//               status: PaymentLinkStatus.PAID,
//             } as any,
//           });

//           const totalPaid = paidLinks.reduce(
//             (sum, l) => sum + (Number(l.amount) || 0),
//             0,
//           );

//           order.paidAmount = totalPaid;
//           order.balanceDue = Math.max(0, order.total - totalPaid);
//           order.paymentStatus =
//             order.balanceDue === 0
//               ? 'PAID'
//               : totalPaid > 0
//                 ? 'PARTIALLY_PAID'
//                 : 'UNPAID';

//           await this.orders.save(order);

//           await this.orderEvents.save(
//             this.orderEvents.create({
//               orgId,
//               orderId: order.id,
//               type: 'PAYMENT_CONFIRMED',
//               data: {
//                 paymentLinkId: link.id,
//                 confirmedBy: userId,
//                 transactionId,
//                 amount: link.amount,
//                 paidAmount: order.paidAmount,
//                 balanceDue: order.balanceDue,
//                 paymentStatus: order.paymentStatus,
//                 mode: 'manual',
//               },
//             }),
//           );
//         }
//       }
//     }

//     return { confirmed: true, paymentLinkId: link.id };
//   }

//   // ── Get payment link with events ──────────────────────────────────────────

//   async getPaymentLinkWithEvents(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     const linkEvents = await this.events.find({
//       where: { paymentLinkId: linkId, orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });

//     const screenshotEvent = linkEvents
//       .filter((e) => e.type === 'PAYMENT_SCREENSHOT_UPLOADED')
//       .pop();

//     return {
//       ...link,
//       payNow: link.amount,
//       codAmount: link.codAmount ?? 0,
//       trxId: link.trxId ?? null,
//       screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
//       events: linkEvents,
//     };
//   }

//   // ── Check payment status ──────────────────────────────────────────────────

//   async checkPaymentStatus(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     return {
//       id: link.id,
//       provider: link.provider,
//       amount: link.amount,
//       status: link.status,
//       url: link.url,
//       providerRef: link.providerRef,
//       createdAt: link.createdAt,
//     };
//   }

//   // ── Get connected payment providers for org ───────────────────────────────

//   async getOrgPaymentProviders(orgId: string) {
//     return this.orgPayments.find({
//       where: { orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });
//   }

//   // ── Handle provider webhook ───────────────────────────────────────────────

//   async handleProviderWebhook(provider: string, orgId: string, payload: any) {
//     const reference =
//       payload?.reference ||
//       payload?.tran_id ||
//       payload?.transactionId ||
//       payload?.paymentID;

//     if (!reference) return { ok: true, ignored: 'no_reference' };

//     const ok = await this.idem.claim(
//       orgId,
//       `webhook:payments:${provider}`,
//       String(reference),
//       { ttlSeconds: 60 * 60 * 24 * 7 },
//     );
//     if (!ok) return { ok: true, duplicate: true };

//     let link = await this.links.findOne({
//       where: { orgId, provider, providerRef: String(reference) } as any,
//     });
//     if (!link) {
//       link = await this.links.findOne({
//         where: { orgId, id: String(reference), provider } as any,
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

//     const statusStr = (
//       payload?.status ||
//       payload?.payment_status ||
//       payload?.statusCode ||
//       ''
//     ).toLowerCase();

//     const isPaid =
//       statusStr === 'paid' ||
//       statusStr === 'success' ||
//       statusStr === 'valid' ||
//       statusStr === '0000';

//     if (isPaid) {
//       await this.links.update({ id: link.id, orgId } as any, {
//         status: PaymentLinkStatus.PAID,
//       });

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_CONFIRMED',
//           payload: { provider, reference },
//         }),
//       );

//       if (link.orderId) {
//         const order = await this.orders.findOne({
//           where: { id: link.orderId, orgId } as any,
//         });
//         if (order) {
//           const paidLinks = await this.links.find({
//             where: {
//               orderId: link.orderId,
//               orgId,
//               status: PaymentLinkStatus.PAID,
//             } as any,
//           });
//           const totalPaid = paidLinks.reduce(
//             (sum, l) => sum + (Number(l.amount) || 0),
//             0,
//           );
//           order.paidAmount = totalPaid;
//           order.balanceDue = Math.max(0, order.total - totalPaid);
//           order.paymentStatus =
//             order.balanceDue === 0
//               ? 'PAID'
//               : totalPaid > 0
//                 ? 'PARTIALLY_PAID'
//                 : 'UNPAID';
//           await this.orders.save(order);
//         }
//       }

//       await this.orderEvents.save(
//         this.orderEvents.create({
//           orgId,
//           orderId: link.orderId,
//           type: 'PAYMENT_CONFIRMED',
//           data: { provider, reference, paymentLinkId: link.id },
//         }),
//       );
//     }

//     return { ok: true };
//   }

//   // ── Create refund link ────────────────────────────────────────────────────

//   async createRefundLink(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     provider = 'bkash',
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');

//     const isRefundable =
//       order.status === 'RETURNED' ||
//       (order.status === 'CANCELLED' && (order.paidAmount ?? 0) > 0);

//     if (!isRefundable) {
//       throw new BadRequestException(
//         'Refunds can only be issued for returned orders, or cancelled orders where payment was collected',
//       );
//     }

//     const refundAmount = order.paidAmount ?? 0;

//     if (refundAmount <= 0) {
//       throw new BadRequestException(
//         'No payment has been collected for this order — nothing to refund',
//       );
//     }

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId, type: provider as any } as any,
//     });

//     const mode = this.detectMode(provider, orgProvider?.config);

//     // Explicit cast — same reason as createPaymentLink
//     const link = await this.links.save(
//       this.links.create({
//         orgId,
//         orderId: order.id,
//         provider,
//         amount: refundAmount,
//         status: PaymentLinkStatus.CREATED,
//       }),
//     );

//     await this.orders.save(
//       Object.assign(order, { paymentStatus: 'REFUND_PENDING' }),
//     );

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId,
//         orderId: order.id,
//         type: 'REFUND_LINK_CREATED',
//         data: {
//           userId,
//           paymentLinkId: link.id,
//           provider,
//           mode,
//           amount: refundAmount,
//           orderStatus: order.status,
//         },
//       }),
//     );

//     if (mode === PaymentMode.PERSONAL) {
//       const instruction = this.generatePaymentInstruction(
//         provider,
//         orgProvider?.config ?? {},
//         refundAmount,
//         order.id,
//       );

//       await this.links.update(
//         { id: link.id, orgId } as any,
//         {
//           url: instruction.instructionText,
//           providerRef: `REFUND-${link.id}`,
//           status: 'SENT',
//         } as any,
//       );

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_INSTRUCTION_GENERATED',
//           payload: { ...instruction, isRefund: true },
//         }),
//       );

//       return { ...link, amount: refundAmount, mode, instruction };
//     }

//     await this.outbox.enqueue(orgId, 'payment_link.generate', {
//       paymentLinkId: link.id,
//       isRefund: true,
//     });

//     return { ...link, amount: refundAmount, mode };
//   }

//   // ── Private helpers ───────────────────────────────────────────────────────

//   private detectMode(provider: string, config: any): PaymentMode {
//     if (!config) return PaymentMode.PERSONAL;
//     const hasMerchantConfig =
//       config.apiKey || config.storeId || config.merchantId;
//     return hasMerchantConfig ? PaymentMode.MERCHANT : PaymentMode.PERSONAL;
//   }

//   private generatePaymentInstruction(
//     provider: string,
//     config: any,
//     amount: number,
//     orderId: string,
//   ): {
//     instructionText: string;
//     provider: string;
//     amount: number;
//     orderId: string;
//   } {
//     const account = config?.accountNumber ?? config?.merchantMobile ?? 'N/A';
//     const name = config?.accountName ?? config?.merchantName ?? provider;
//     const instructionText =
//       `Please send ${amount} BDT to ${provider.toUpperCase()} number: ${account} (${name}). ` +
//       `Use order ID ${orderId} as the reference/note.`;
//     return { instructionText, provider, amount, orderId };
//   }
// }
// // v2
// /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
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
// import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
// import { IdempotencyService, OutboxService } from '@app/common';
// import { PaymentLinkStatus } from './enums/payment-link.enum';
// import { UploadService } from '@app/common/upload/upload.service';

// export enum PaymentMode {
//   PERSONAL = 'personal',
//   MERCHANT = 'merchant',
// }

// @Injectable()
// export class PaymentsService {
//   constructor(
//     @InjectRepository(PaymentLinkEntity)
//     private links: Repository<PaymentLinkEntity>,
//     @InjectRepository(PaymentEventEntity)
//     private events: Repository<PaymentEventEntity>,
//     @InjectRepository(OrderEntity)
//     private orders: Repository<OrderEntity>,
//     @InjectRepository(OrderEventEntity)
//     private orderEvents: Repository<OrderEventEntity>,
//     @InjectRepository(OrgPaymentProviderEntity)
//     private orgPayments: Repository<OrgPaymentProviderEntity>,
//     private outbox: OutboxService,
//     private idem: IdempotencyService,
//     private upload: UploadService,
//   ) {}

//   // ── List payment links for an order ──────────────────────────────────────

//   async listPaymentLinks(orgId: string, orderId: string) {
//     const links = await this.links.find({
//       where: { orgId, orderId } as any,
//       order: { createdAt: 'DESC' } as any,
//     });

//     return Promise.all(
//       links.map(async (link) => {
//         const screenshotEvent = await this.events.findOne({
//           where: {
//             paymentLinkId: link.id,
//             type: 'PAYMENT_SCREENSHOT_UPLOADED',
//           } as any,
//           order: { createdAt: 'DESC' } as any,
//         });
//         return {
//           ...link,
//           payNow: link.amount,
//           codAmount: (link as any).codAmount ?? 0,
//           trxId: (link as any).trxId ?? null,
//           screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
//         };
//       }),
//     );
//   }

//   // ── Get public payment link (no auth — customer-facing) ───────────────────

//   async getPublicPaymentLink(linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId: link.orgId, type: link.provider as any } as any,
//     });

//     const mode = this.detectMode(link.provider, orgProvider?.config);

//     let instruction: object | undefined;
//     if (mode === PaymentMode.PERSONAL && orgProvider?.config) {
//       instruction = this.generatePaymentInstruction(
//         link.provider,
//         orgProvider.config,
//         link.amount, // link.amount = payNow (online portion)
//         link.orderId,
//       );
//     }

//     return {
//       id: link.id,
//       orgId: link.orgId,
//       provider: link.provider,
//       amount: link.amount, // payNow — online portion only
//       codAmount: (link as any).codAmount ?? 0, // COD remainder
//       currency: 'BDT',
//       status: link.status,
//       mode,
//       url: mode === PaymentMode.MERCHANT ? link.url : undefined,
//       instruction: mode === PaymentMode.PERSONAL ? instruction : undefined,
//       expiresAt: link.expiresAt ?? undefined,
//     };
//   }

//   // ── Get single payment link (authenticated) ───────────────────────────────

//   async getPaymentLink(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');
//     return link;
//   }

//   // ── Create payment link ───────────────────────────────────────────────────

//   async createPaymentLink(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     provider = 'sslcommerz',
//     payNow?: number, // online portion (undefined = full payment)
//     due = 0, // COD remainder
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');
//     if (order.total <= 0)
//       throw new BadRequestException('Order total must be > 0');

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId, type: provider as any } as any,
//     });

//     if (orgProvider && orgProvider.status !== 'ACTIVE') {
//       throw new BadRequestException(
//         `Payment provider ${provider} is not active for this org`,
//       );
//     }

//     const mode = this.detectMode(provider, orgProvider?.config);
//     const onlineAmt = payNow ?? order.total; // what the customer pays online NOW
//     const codAmt = due ?? 0; // what is collected at the door

//     const link = await this.links.save(
//       this.links.create({
//         orgId,
//         orderId: order.id,
//         provider,
//         amount: onlineAmt, // store payNow, NOT order.total
//         codAmount: codAmt, // new column
//         status: PaymentLinkStatus.CREATED,
//       } as any),
//     );

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId,
//         orderId: order.id,
//         type: 'PAYMENT_LINK_CREATED',
//         data: {
//           userId,
//           paymentLinkId: link.id,
//           provider,
//           mode,
//           amount: onlineAmt,
//           codAmount: codAmt,
//         },
//       }),
//     );

//     if (mode === PaymentMode.PERSONAL) {
//       const instruction = this.generatePaymentInstruction(
//         provider,
//         orgProvider?.config ?? {},
//         onlineAmt, // show the online amount, not the full total
//         order.id,
//       );

//       await this.links.update(
//         { id: link.id, orgId } as any,
//         {
//           url: instruction.instructionText,
//           providerRef: `MANUAL-${link.id}`,
//           status: 'SENT',
//         } as any,
//       );

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_INSTRUCTION_GENERATED',
//           payload: instruction,
//         }),
//       );

//       return { ...link, mode, instruction, codAmount: codAmt };
//     }

//     // Merchant mode: enqueue outbox for API call
//     await this.outbox.enqueue(orgId, 'payment_link.generate', {
//       paymentLinkId: link.id,
//     });

//     return { ...link, mode, codAmount: codAmt };
//   }

//   // ── Upload payment screenshot / trxId (public — no auth) ─────────────────

//   async uploadPaymentScreenshot(
//     orgId: string,
//     linkId: string,
//     buffer: Buffer | null,
//     originalName: string,
//     mimeType: string,
//     trxId?: string,
//   ) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     let screenshotUrl: string | null = null;

//     // File upload is optional — customer may submit trxId only
//     if (buffer && buffer.length > 0) {
//       const result = await this.upload.uploadPaymentScreenshot(
//         buffer,
//         originalName,
//         mimeType,
//         orgId,
//         linkId,
//       );
//       screenshotUrl = result.url;

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_SCREENSHOT_UPLOADED',
//           payload: {
//             screenshotUrl: result.url,
//             publicId: result.publicId,
//             uploadedAt: new Date().toISOString(),
//           },
//         }),
//       );
//     }

//     // Persist status + optional trxId
//     await this.links.update(
//       { id: link.id, orgId } as any,
//       {
//         status: 'SCREENSHOT_UPLOADED',
//         ...(trxId?.trim() ? { trxId: trxId.trim() } : {}),
//       } as any,
//     );

//     return {
//       screenshotUrl,
//       paymentLinkId: link.id,
//       message: 'Proof submitted. Waiting for merchant confirmation.',
//     };
//   }

//   // ── Confirm manual payment or refund (owner action) ───────────────────────
//   //
//   // Handles both cases by inspecting providerRef:
//   //   providerRef starts with "REFUND-"  →  refund confirmation path
//   //   otherwise                          →  payment confirmation path

//   async confirmManualPayment(
//     orgId: string,
//     linkId: string,
//     userId: string,
//     transactionId?: string,
//   ) {
//     // ── 1. Load & validate ─────────────────────────────────────────────────
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');
//     if (link.status === PaymentLinkStatus.PAID) {
//       throw new BadRequestException('Already confirmed');
//     }

//     // ── 2. Mark link PAID, optionally persist trxId ────────────────────────
//     await this.links.update(
//       { id: link.id, orgId } as any,
//       {
//         status: PaymentLinkStatus.PAID,
//         ...(transactionId ? { trxId: transactionId } : {}),
//       } as any,
//     );

//     // ── 3. Record payment-level event ──────────────────────────────────────
//     await this.events.save(
//       this.events.create({
//         orgId,
//         paymentLinkId: link.id,
//         type: 'PAYMENT_MANUALLY_CONFIRMED',
//         payload: { confirmedBy: userId, transactionId },
//       }),
//     );

//     // ── 4. Update order ────────────────────────────────────────────────────
//     if (link.orderId) {
//       const order = await this.orders.findOne({
//         where: { id: link.orderId, orgId } as any,
//       });

//       if (order) {
//         const isRefundLink =
//           typeof link.providerRef === 'string' &&
//           link.providerRef.startsWith('REFUND-');

//         if (isRefundLink) {
//           // ── Refund confirmation: owner confirmed money sent to customer ──
//           order.paymentStatus = 'REFUNDED';
//           await this.orders.save(order);

//           await this.orderEvents.save(
//             this.orderEvents.create({
//               orgId,
//               orderId: order.id,
//               type: 'REFUND_CONFIRMED',
//               data: {
//                 paymentLinkId: link.id,
//                 confirmedBy: userId,
//                 transactionId,
//                 amount: link.amount,
//               },
//             }),
//           );
//         } else {
//           // ── Payment confirmation: sum all paid links, update financials ──
//           const paidLinks = await this.links.find({
//             where: {
//               orderId: link.orderId,
//               orgId,
//               status: PaymentLinkStatus.PAID,
//             } as any,
//           });

//           const totalPaid = paidLinks.reduce(
//             (sum, l) => sum + (Number(l.amount) || 0),
//             0,
//           );

//           order.paidAmount = totalPaid;
//           order.balanceDue = Math.max(0, order.total - totalPaid);
//           order.paymentStatus =
//             order.balanceDue === 0
//               ? 'PAID'
//               : totalPaid > 0
//                 ? 'PARTIALLY_PAID'
//                 : 'UNPAID';

//           await this.orders.save(order);

//           await this.orderEvents.save(
//             this.orderEvents.create({
//               orgId,
//               orderId: order.id,
//               type: 'PAYMENT_CONFIRMED',
//               data: {
//                 paymentLinkId: link.id,
//                 confirmedBy: userId,
//                 transactionId,
//                 amount: link.amount,
//                 paidAmount: order.paidAmount,
//                 balanceDue: order.balanceDue,
//                 paymentStatus: order.paymentStatus,
//                 mode: 'manual',
//               },
//             }),
//           );
//         }
//       }
//     }

//     return { confirmed: true, paymentLinkId: link.id };
//   }

//   // ── Get payment link with screenshot events (authenticated detail) ─────────

//   async getPaymentLinkWithEvents(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     const linkEvents = await this.events.find({
//       where: { paymentLinkId: linkId, orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });

//     const screenshotEvent = linkEvents
//       .filter((e) => e.type === 'PAYMENT_SCREENSHOT_UPLOADED')
//       .pop();

//     return {
//       ...link,
//       payNow: link.amount,
//       codAmount: (link as any).codAmount ?? 0,
//       trxId: (link as any).trxId ?? null,
//       screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
//       events: linkEvents,
//     };
//   }

//   // ── Check payment status ──────────────────────────────────────────────────

//   async checkPaymentStatus(orgId: string, linkId: string) {
//     const link = await this.links.findOne({
//       where: { id: linkId, orgId } as any,
//     });
//     if (!link) throw new NotFoundException('Payment link not found');

//     return {
//       id: link.id,
//       provider: link.provider,
//       amount: link.amount,
//       status: link.status,
//       url: link.url,
//       providerRef: link.providerRef,
//       createdAt: link.createdAt,
//     };
//   }

//   // ── Get connected payment providers for org ───────────────────────────────

//   async getOrgPaymentProviders(orgId: string) {
//     return this.orgPayments.find({
//       where: { orgId } as any,
//       order: { createdAt: 'ASC' } as any,
//     });
//   }

//   // ── Handle provider webhook ───────────────────────────────────────────────

//   async handleProviderWebhook(provider: string, orgId: string, payload: any) {
//     const reference =
//       payload?.reference ||
//       payload?.tran_id ||
//       payload?.transactionId ||
//       payload?.paymentID;

//     if (!reference) return { ok: true, ignored: 'no_reference' };

//     const ok = await this.idem.claim(
//       orgId,
//       `webhook:payments:${provider}`,
//       String(reference),
//       { ttlSeconds: 60 * 60 * 24 * 7 },
//     );
//     if (!ok) return { ok: true, duplicate: true };

//     let link = await this.links.findOne({
//       where: { orgId, provider, providerRef: String(reference) } as any,
//     });
//     if (!link) {
//       link = await this.links.findOne({
//         where: { orgId, id: String(reference), provider } as any,
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

//     const statusStr = (
//       payload?.status ||
//       payload?.payment_status ||
//       payload?.statusCode ||
//       ''
//     ).toLowerCase();

//     const isPaid =
//       statusStr === 'paid' ||
//       statusStr === 'success' ||
//       statusStr === 'valid' ||
//       statusStr === '0000';

//     if (isPaid) {
//       await this.links.update({ id: link.id, orgId } as any, {
//         status: PaymentLinkStatus.PAID,
//       });

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_CONFIRMED',
//           payload: { provider, reference },
//         }),
//       );

//       // Update order financials for webhook-confirmed payments
//       if (link.orderId) {
//         const order = await this.orders.findOne({
//           where: { id: link.orderId, orgId } as any,
//         });
//         if (order) {
//           const paidLinks = await this.links.find({
//             where: {
//               orderId: link.orderId,
//               orgId,
//               status: PaymentLinkStatus.PAID,
//             } as any,
//           });
//           const totalPaid = paidLinks.reduce(
//             (sum, l) => sum + (Number(l.amount) || 0),
//             0,
//           );
//           order.paidAmount = totalPaid;
//           order.balanceDue = Math.max(0, order.total - totalPaid);
//           order.paymentStatus =
//             order.balanceDue === 0
//               ? 'PAID'
//               : totalPaid > 0
//                 ? 'PARTIALLY_PAID'
//                 : 'UNPAID';
//           await this.orders.save(order);
//         }
//       }

//       await this.orderEvents.save(
//         this.orderEvents.create({
//           orgId,
//           orderId: link.orderId,
//           type: 'PAYMENT_CONFIRMED',
//           data: { provider, reference, paymentLinkId: link.id },
//         }),
//       );
//     }

//     return { ok: true };
//   }

//   // ── Create refund link ────────────────────────────────────────────────────
//   // v2

//   async createRefundLink(
//     orgId: string,
//     userId: string,
//     orderId: string,
//     provider = 'bkash',
//   ) {
//     const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//     if (!order) throw new NotFoundException('Order not found');

//     // ── FIX 1: allow CANCELLED orders that had partial payment ───────────────
//     const isRefundable =
//       order.status === 'RETURNED' ||
//       (order.status === 'CANCELLED' && (order.paidAmount ?? 0) > 0);

//     if (!isRefundable) {
//       throw new BadRequestException(
//         'Refunds can only be issued for returned orders, or cancelled orders where payment was collected',
//       );
//     }

//     // ── FIX 2: refund only what was actually collected ───────────────────────
//     const refundAmount = order.paidAmount ?? 0;

//     if (refundAmount <= 0) {
//       throw new BadRequestException(
//         'No payment has been collected for this order — nothing to refund',
//       );
//     }

//     const orgProvider = await this.orgPayments.findOne({
//       where: { orgId, type: provider as any } as any,
//     });

//     const mode = this.detectMode(provider, orgProvider?.config);

//     const link = await this.links.save(
//       this.links.create({
//         orgId,
//         orderId: order.id,
//         provider,
//         amount: refundAmount, // ← paidAmount, not total
//         status: PaymentLinkStatus.CREATED,
//       }),
//     );

//     // Set order.paymentStatus = REFUND_PENDING immediately
//     await this.orders.save(
//       Object.assign(order, { paymentStatus: 'REFUND_PENDING' }),
//     );

//     await this.orderEvents.save(
//       this.orderEvents.create({
//         orgId,
//         orderId: order.id,
//         type: 'REFUND_LINK_CREATED',
//         data: {
//           userId,
//           paymentLinkId: link.id,
//           provider,
//           mode,
//           amount: refundAmount,
//           orderStatus: order.status, // log whether RETURNED or CANCELLED
//         },
//       }),
//     );

//     if (mode === PaymentMode.PERSONAL) {
//       const instruction = this.generatePaymentInstruction(
//         provider,
//         orgProvider?.config ?? {},
//         refundAmount,
//         order.id,
//       );

//       await this.links.update(
//         { id: link.id, orgId } as any,
//         {
//           url: instruction.instructionText,
//           providerRef: `REFUND-${link.id}`,
//           status: 'SENT',
//         } as any,
//       );

//       await this.events.save(
//         this.events.create({
//           orgId,
//           paymentLinkId: link.id,
//           type: 'PAYMENT_INSTRUCTION_GENERATED',
//           payload: { ...instruction, isRefund: true },
//         }),
//       );

//       return { ...link, amount: refundAmount, mode, instruction };
//     }

//     // Merchant mode
//     await this.outbox.enqueue(orgId, 'payment_link.generate', {
//       paymentLinkId: link.id,
//       isRefund: true,
//     });

//     return { ...link, amount: refundAmount, mode };
//   }
//   // v1
//   // async createRefundLink(
//   //   orgId: string,
//   //   userId: string,
//   //   orderId: string,
//   //   provider = 'bkash',
//   // ) {
//   //   const order = await this.orders.findOne({ where: { id: orderId, orgId } });
//   //   if (!order) throw new NotFoundException('Order not found');
//   //   if (order.status !== 'RETURNED') {
//   //     throw new BadRequestException(
//   //       'Refunds can only be issued for returned orders',
//   //     );
//   //   }
//   //   if (order.total <= 0) {
//   //     throw new BadRequestException(
//   //       'Order total must be > 0 to issue a refund',
//   //     );
//   //   }

//   //   const orgProvider = await this.orgPayments.findOne({
//   //     where: { orgId, type: provider as any } as any,
//   //   });

//   //   const mode = this.detectMode(provider, orgProvider?.config);

//   //   const link = await this.links.save(
//   //     this.links.create({
//   //       orgId,
//   //       orderId: order.id,
//   //       provider,
//   //       amount: order.total,
//   //       codAmount: 0,
//   //       status: PaymentLinkStatus.CREATED,
//   //     } as any),
//   //   );

//   //   // Mark order as REFUND_PENDING immediately so the UI reflects it
//   //   order.paymentStatus = 'REFUND_PENDING';
//   //   await this.orders.save(order);

//   //   await this.orderEvents.save(
//   //     this.orderEvents.create({
//   //       orgId,
//   //       orderId: order.id,
//   //       type: 'REFUND_LINK_CREATED',
//   //       data: {
//   //         userId,
//   //         paymentLinkId: link.id,
//   //         provider,
//   //         mode,
//   //         amount: link.amount,
//   //       },
//   //     }),
//   //   );

//   //   if (mode === PaymentMode.PERSONAL) {
//   //     const instruction = this.generatePaymentInstruction(
//   //       provider,
//   //       orgProvider?.config ?? {},
//   //       order.total,
//   //       order.id,
//   //     );

//   //     await this.links.update(
//   //       { id: link.id, orgId } as any,
//   //       {
//   //         url: instruction.instructionText,
//   //         providerRef: `REFUND-${link.id}`,
//   //         status: 'SENT',
//   //       } as any,
//   //     );

//   //     await this.events.save(
//   //       this.events.create({
//   //         orgId,
//   //         paymentLinkId: link.id,
//   //         type: 'PAYMENT_INSTRUCTION_GENERATED',
//   //         payload: { ...instruction, isRefund: true },
//   //       }),
//   //     );

//   //     return { ...link, mode, instruction };
//   //   }

//   //   // Merchant mode: enqueue outbox for PGW refund/payout link
//   //   await this.outbox.enqueue(orgId, 'payment_link.generate', {
//   //     paymentLinkId: link.id,
//   //     isRefund: true,
//   //   });

//   //   return { ...link, mode };
//   // }

//   // ── Helpers ───────────────────────────────────────────────────────────────

//   private detectMode(
//     provider: string,
//     config?: Record<string, any>,
//   ): PaymentMode {
//     if (!config) return PaymentMode.PERSONAL;
//     if (config.phoneNumber || config.mobileNumber) return PaymentMode.PERSONAL;
//     if (config.appKey || config.merchantId || config.storeId)
//       return PaymentMode.MERCHANT;
//     return PaymentMode.PERSONAL;
//   }

//   private generatePaymentInstruction(
//     provider: string,
//     config: Record<string, any>,
//     amount: number,
//     orderId: string,
//   ) {
//     const phoneNumber = config.phoneNumber ?? config.mobileNumber ?? '';
//     const providerName =
//       provider === 'bkash'
//         ? 'bKash'
//         : provider === 'nagad'
//           ? 'Nagad'
//           : provider;

//     const instructionText =
//       `Please send BDT ${amount.toLocaleString()} to ${providerName} number: ${phoneNumber}. ` +
//       `Use "${orderId}" as the reference/note. ` +
//       `After payment, share your transaction ID or screenshot for confirmation.`;

//     return {
//       provider,
//       phoneNumber,
//       amount,
//       orderId,
//       instructionText,
//       steps: [
//         `Open your ${providerName} app`,
//         `Go to "Send Money"`,
//         `Enter number: ${phoneNumber}`,
//         `Amount: BDT ${amount.toLocaleString()}`,
//         `Reference/Note: ${orderId}`,
//         `Complete payment and save the transaction ID`,
//         `Share screenshot or transaction ID for confirmation`,
//       ],
//     };
//   }
// }
