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
import { AutoMessageService } from '../../integrations/meta/services/auto-message.service';

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
    private autoMessage: AutoMessageService,
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
      void this.autoMessage
        .onPaymentLinkCreated(link, {
          customerId: order.customerId,
          currency: order.currency,
          total: order.total,
          balanceDue: order.balanceDue,
        })
        .catch(() => undefined);
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
    phoneNumber: string; // ✅ added — frontend expects this field
    provider: string;
    amount: number;
    orderId: string;
    steps: string[]; // ✅ added — frontend renders instruction.steps
  } {
    // ✅ FIXED: config stores "phoneNumber" — the old code checked
    // "accountNumber" and "merchantMobile" which don't exist, so it
    // always fell back to 'N/A' and never returned the phone number.
    const phoneNumber =
      config?.phoneNumber ??
      config?.accountNumber ??
      config?.merchantMobile ??
      '';

    const name = config?.accountName ?? config?.merchantName ?? provider;

    const instructionText =
      `Please send ${amount} BDT to ${provider.toUpperCase()} number: ${phoneNumber} (${name}). ` +
      `Use order ID ${orderId} as the reference/note.`;

    // Step-by-step instructions shown on the payment page
    const steps = [
      `Open your ${provider.toUpperCase()} app`,
      `Tap "Send Money"`,
      `Enter the number: ${phoneNumber}`,
      `Enter amount: ${amount} BDT`,
      `Use order ID ${orderId} as the reference/note`,
      `Complete the payment and copy your Transaction ID`,
    ];

    return {
      instructionText,
      phoneNumber, // ✅ now returned — fixes "Send money to: undefined"
      provider,
      amount,
      orderId,
      steps,
    };
  }
}
