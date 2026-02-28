/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import {
  OutboxEventEntity,
  OutboxStatus,
} from '@app/common/outbox/outbox-event.entity';

import { FakePaymentProvider } from './providers/fake-payment.provider';
import { FakeCourierProvider } from './providers/fake-courier.provider';
import { OrderEventEntity } from 'apps/api/src/modules/orders/entities/order-event.entity';
import { PaymentEventEntity } from 'apps/api/src/modules/payments/entities/payment-event.entity';
import { PaymentLinkEntity } from 'apps/api/src/modules/payments/entities/payment-link.entity';
import { ShipmentEventEntity } from 'apps/api/src/modules/shipments/entities/shipment-event.entity';
import {
  ShipmentEntity,
  ShipmentStatus,
} from 'apps/api/src/modules/shipments/entities/shipment.entity';
import { OrgPaymentProviderEntity } from 'apps/api/src/modules/providers/entities/org-payment-provider.entity';
import { NagadProvider } from './providers/nagad.provider';
import { BkashProvider } from './providers/bkash.provider';
import { SslCommerzProvider } from './providers/sslcommerz.provider';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(
    @InjectRepository(OutboxEventEntity)
    private outbox: Repository<OutboxEventEntity>,
    @InjectRepository(PaymentLinkEntity)
    private paymentLinks: Repository<PaymentLinkEntity>,
    @InjectRepository(PaymentEventEntity)
    private paymentEvents: Repository<PaymentEventEntity>,
    @InjectRepository(ShipmentEntity)
    private shipments: Repository<ShipmentEntity>,
    @InjectRepository(ShipmentEventEntity)
    private shipmentEvents: Repository<ShipmentEventEntity>,
    @InjectRepository(OrderEventEntity)
    private orderEvents: Repository<OrderEventEntity>,
    @InjectRepository(OrgPaymentProviderEntity)
    private orgPayments: Repository<OrgPaymentProviderEntity>,
    private bkash: BkashProvider,
    private nagad: NagadProvider,
    private sslcommerz: SslCommerzProvider,
    private pay: FakePaymentProvider,
    private courier: FakeCourierProvider,
  ) {
    setInterval(() => this.tick().catch((e) => this.logger.error(e)), 2000);
  }

  async tick() {
    const now = new Date();
    const batch = await this.outbox.find({
      where: {
        status: OutboxStatus.PENDING,
        availableAt: LessThanOrEqual(now),
      },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    for (const evt of batch) await this.processOne(evt.id);
  }

  private async processOne(id: string) {
    const locked = await this.outbox.update(
      { id, status: OutboxStatus.PENDING },
      { status: OutboxStatus.PROCESSING },
    );
    if (!locked.affected) return;

    const evt = await this.outbox.findOne({ where: { id } });
    if (!evt) return;

    try {
      switch (evt.type) {
        case 'payment_link.generate':
          await this.handlePaymentLinkGenerate(evt.orgId, evt.payload);
          break;
        case 'shipment.book':
          await this.handleShipmentBook(evt.orgId, evt.payload);
          break;
        default:
          throw new Error(`Unknown outbox type: ${evt.type}`);
      }

      await this.outbox.update({ id: evt.id }, { status: OutboxStatus.SENT });
    } catch (e: any) {
      const attempts = (evt.attempts ?? 0) + 1;
      const backoffSeconds = Math.min(60 * attempts, 600); // 60s, 120s... max 10m

      await this.outbox.update(
        { id: evt.id },
        {
          status: OutboxStatus.PENDING, // retry
          attempts,
          lastError: String(e?.message ?? e),
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
        },
      );

      this.logger.error(
        `Outbox failed ${evt.type} (${evt.id}): ${String(e?.message ?? e)}`,
      );
    }
  }
  private async handlePaymentLinkGenerate(
    orgId: string,
    payload: { paymentLinkId: string },
  ) {
    const link = await this.paymentLinks.findOne({
      where: { id: payload.paymentLinkId, orgId },
    });
    if (!link) return;

    // Load org payment provider credentials
    const orgProvider = await this.orgPayments.findOne({
      where: { orgId, type: link.provider as any },
    });

    let resp: { providerRef: string; url: string };

    // Route to real provider if credentials exist, else fake
    if (orgProvider?.config && Object.keys(orgProvider.config).length > 0) {
      try {
        if (link.provider === 'bkash') {
          resp = await this.bkash.createPayment(orgProvider.config as any, {
            amount: link.amount,
            orderId: link.orderId,
            reference: link.id,
            callbackUrl: `${process.env.APP_URL ?? 'https://app.commerceos.com'}/payment/callback/bkash`,
          });
        } else if (link.provider === 'nagad') {
          resp = await this.nagad.createPayment(orgProvider.config as any, {
            amount: link.amount,
            orderId: link.orderId,
            callbackUrl: `${process.env.APP_URL ?? 'https://app.commerceos.com'}/payment/callback/nagad`,
          });
        } else if (link.provider === 'sslcommerz') {
          resp = await this.sslcommerz.createPayment(
            orgProvider.config as any,
            {
              amount: link.amount,
              orderId: link.orderId,
              customerName: 'Customer',
              customerEmail: 'customer@example.com',
              customerPhone: '01700000000',
              customerAddress: 'Dhaka, Bangladesh',
              successUrl: `${process.env.APP_URL ?? 'https://app.commerceos.com'}/payment/success`,
              failUrl: `${process.env.APP_URL ?? 'https://app.commerceos.com'}/payment/fail`,
              cancelUrl: `${process.env.APP_URL ?? 'https://app.commerceos.com'}/payment/cancel`,
              ipnUrl: `${process.env.API_URL ?? 'https://api.commerceos.com'}/v1/webhooks/payments/sslcommerz`,
            },
          );
        } else {
          // Fallback to fake for unknown providers
          resp = this.pay.generatePaymentLink({
            paymentLinkId: link.id,
            amount: link.amount,
          });
        }
      } catch (e: any) {
        this.logger.error(
          `Payment provider error for ${link.provider}: ${String(e?.message ?? e)}`,
        );
        // Fall back to fake so shipment isn't stuck
        resp = this.pay.generatePaymentLink({
          paymentLinkId: link.id,
          amount: link.amount,
        });
      }
    } else {
      // No credentials configured — use fake
      resp = this.pay.generatePaymentLink({
        paymentLinkId: link.id,
        amount: link.amount,
      });
    }

    await this.paymentLinks.update(
      { id: link.id, orgId },
      {
        providerRef: resp.providerRef,
        url: resp.url,
        status: 'SENT',
      },
    );

    await this.paymentEvents.save(
      this.paymentEvents.create({
        orgId,
        paymentLinkId: link.id,
        type: 'PAYMENT_LINK_GENERATED',
        payload: resp,
      }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: link.orderId,
        type: 'PAYMENT_LINK_SENT',
        data: { paymentLinkId: link.id, url: resp.url },
      }),
    );
  }

  // private async handlePaymentLinkGenerate(
  //   orgId: string,
  //   payload: { paymentLinkId: string },
  // ) {
  //   const link = await this.paymentLinks.findOne({
  //     where: { id: payload.paymentLinkId, orgId },
  //   });
  //   if (!link) return;

  //   const resp = this.pay.generatePaymentLink({
  //     paymentLinkId: link.id,
  //     amount: link.amount,
  //   });

  //   await this.paymentLinks.update(
  //     { id: link.id, orgId },
  //     {
  //       providerRef: resp.providerRef,
  //       url: resp.url,
  //       status: 'SENT',
  //     },
  //   );

  //   await this.paymentEvents.save(
  //     this.paymentEvents.create({
  //       orgId,
  //       paymentLinkId: link.id,
  //       type: 'PAYMENT_LINK_GENERATED',
  //       payload: resp,
  //     }),
  //   );

  //   await this.orderEvents.save(
  //     this.orderEvents.create({
  //       orgId,
  //       orderId: link.orderId,
  //       type: 'PAYMENT_LINK_SENT',
  //       data: { paymentLinkId: link.id, url: resp.url },
  //     }),
  //   );
  // }

  private async handleShipmentBook(
    orgId: string,
    payload: { shipmentId: string },
  ) {
    const shipment = await this.shipments.findOne({
      where: { id: payload.shipmentId, orgId },
    });
    if (!shipment) return;

    const resp = this.courier.bookShipment({
      shipmentId: shipment.id,
      courierProvider: shipment.courierProvider,
    });

    await this.shipments.update(
      { id: shipment.id, orgId },
      {
        consignmentId: resp.consignmentId,
        trackingUrl: resp.trackingUrl,
        status: ShipmentStatus.BOOKED,
        lastUpdateAt: new Date(),
      },
    );

    await this.shipmentEvents.save(
      this.shipmentEvents.create({
        orgId,
        shipmentId: shipment.id,
        type: 'SHIPMENT_BOOKED',
        payload: resp,
      }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: shipment.orderId,
        type: 'SHIPMENT_BOOKED',
        data: {
          shipmentId: shipment.id,
          consignmentId: resp.consignmentId,
          trackingUrl: resp.trackingUrl,
        },
      }),
    );
  }
}
