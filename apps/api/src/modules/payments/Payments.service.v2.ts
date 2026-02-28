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
  PERSONAL = 'personal', // manual — pay to phone number
  MERCHANT = 'merchant', // API — automated payment gateway
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

    // Load org provider config to determine mode
    const orgProvider = await this.orgPayments.findOne({
      where: { orgId, type: provider as any } as any,
    });

    if (orgProvider && orgProvider.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Payment provider ${provider} is not active for this org`,
      );
    }

    // Detect mode: personal if config has phoneNumber, merchant if has API keys
    const mode = this.detectMode(provider, orgProvider?.config);

    const link = await this.links.save(
      this.links.create({
        orgId,
        orderId: order.id,
        provider,
        amount: order.total,
        status: PaymentLinkStatus.CREATED,
        // Store mode in providerRef temporarily until worker processes it
      }),
    );

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
          amount: link.amount,
        },
      }),
    );

    if (mode === PaymentMode.PERSONAL) {
      // Personal: generate instruction immediately, no outbox needed
      const instruction = this.generatePaymentInstruction(
        provider,
        orgProvider?.config ?? {},
        order.total,
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

      return { ...link, mode, instruction };
    }

    // Merchant mode: enqueue outbox for API call
    await this.outbox.enqueue(orgId, 'payment_link.generate', {
      paymentLinkId: link.id,
    });

    return { ...link, mode };
  }

  // ── Upload payment screenshot (personal mode) ─────────────────────────────

  async uploadPaymentScreenshot(
    orgId: string,
    linkId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const result = await this.upload.uploadPaymentScreenshot(
      buffer,
      originalName,
      mimeType,
      orgId,
      linkId,
    );

    // Store screenshot URL in events
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

    // Update link with screenshot URL in config
    await this.links.update(
      { id: link.id, orgId } as any,
      {
        status: 'SCREENSHOT_UPLOADED',
      } as any,
    );

    return {
      screenshotUrl: result.url,
      paymentLinkId: link.id,
      message: 'Screenshot uploaded. Waiting for merchant confirmation.',
    };
  }

  // ── Confirm manual payment (owner action) ─────────────────────────────────

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
      throw new BadRequestException('Payment already confirmed');
    }

    // Mark as paid
    await this.links.update(
      { id: link.id, orgId } as any,
      { status: PaymentLinkStatus.PAID } as any,
    );

    await this.events.save(
      this.events.create({
        orgId,
        paymentLinkId: link.id,
        type: 'PAYMENT_MANUALLY_CONFIRMED',
        payload: { confirmedBy: userId, transactionId },
      }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: link.orderId,
        type: 'PAYMENT_CONFIRMED',
        data: {
          paymentLinkId: link.id,
          confirmedBy: userId,
          transactionId,
          mode: 'manual',
        },
      }),
    );

    return { confirmed: true, paymentLinkId: link.id };
  }

  // ── Get payment link with screenshot events ───────────────────────────────

  async getPaymentLinkWithEvents(orgId: string, linkId: string) {
    const link = await this.links.findOne({
      where: { id: linkId, orgId } as any,
    });
    if (!link) throw new NotFoundException('Payment link not found');

    const events = await this.events.find({
      where: { paymentLinkId: linkId, orgId } as any,
      order: { createdAt: 'ASC' } as any,
    });

    const screenshotEvent = events
      .filter((e) => e.type === 'PAYMENT_SCREENSHOT_UPLOADED')
      .pop();

    return {
      ...link,
      screenshotUrl: screenshotEvent?.payload?.screenshotUrl ?? null,
      events,
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
      status === '0000';

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

  // ── Helpers ───────────────────────────────────────────────────────────────

  private detectMode(
    provider: string,
    config?: Record<string, any>,
  ): PaymentMode {
    if (!config) return PaymentMode.PERSONAL;

    // Personal mode indicators
    if (config.phoneNumber || config.mobileNumber) return PaymentMode.PERSONAL;

    // Merchant mode indicators
    if (
      config.appKey || // bKash merchant
      config.merchantId || // Nagad merchant
      config.storeId // SSLCommerz
    )
      return PaymentMode.MERCHANT;

    return PaymentMode.PERSONAL;
  }

  private generatePaymentInstruction(
    provider: string,
    config: Record<string, any>,
    amount: number,
    orderId: string,
  ) {
    const phoneNumber = config.phoneNumber ?? config.mobileNumber ?? '';
    const providerName =
      provider === 'bkash'
        ? 'bKash'
        : provider === 'nagad'
          ? 'Nagad'
          : provider;

    const instructionText =
      `Please send BDT ${amount.toLocaleString()} to ${providerName} number: ${phoneNumber}. ` +
      `Use "${orderId}" as the reference/note. ` +
      `After payment, share your transaction ID or screenshot for confirmation.`;

    return {
      provider,
      phoneNumber,
      amount,
      orderId,
      instructionText,
      steps: [
        `Open your ${providerName} app`,
        `Go to "Send Money"`,
        `Enter number: ${phoneNumber}`,
        `Amount: BDT ${amount.toLocaleString()}`,
        `Reference/Note: ${orderId}`,
        `Complete payment and save the transaction ID`,
        `Share screenshot or transaction ID for confirmation`,
      ],
    };
  }
}
