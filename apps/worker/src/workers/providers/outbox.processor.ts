/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { OutboxEventEntity, OutboxStatus } from '@app/common';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEventEntity } from 'apps/api/src/modules/orders/entities/order-event.entity';
import { PaymentEventEntity } from 'apps/api/src/modules/payments/entities/payment-event.entity';
import { PaymentLinkEntity } from 'apps/api/src/modules/payments/entities/payment-link.entity';
import { ShipmentEventEntity } from 'apps/api/src/modules/shipments/entities/shipment-event.entity';
import {
  ShipmentEntity,
  ShipmentStatus,
} from 'apps/api/src/modules/shipments/entities/shipment.entity';
import { Repository } from 'typeorm';
import { FakeCourierProvider } from './fake-courier.provider';
import { FakePaymentProvider } from './fake-payment.provider';
import { PaymentLinkStatus } from 'apps/api/src/modules/payments/enums/payment-link.enum';
import { PathaoProvider } from '../../../../../libs/common/src/couriers/pathao.provider';
import { SteadfastProvider } from '../../../../../libs/common/src/couriers/steadfast.provider';
import { OrgCourierProviderEntity } from 'apps/api/src/modules/providers/entities/org-courier-provider.entity';

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
    private fakePay: FakePaymentProvider,
    private fakeCourier: FakeCourierProvider,
    @InjectRepository(OrgCourierProviderEntity)
    private orgCouriers: Repository<OrgCourierProviderEntity>,
    private steadfast: SteadfastProvider,
    private pathao: PathaoProvider,
  ) {
    // poll every 2 seconds
    setInterval(() => this.tick().catch((e) => this.logger.error(e)), 2000);
  }

  async tick() {
    // fetch small batch
    const events = await this.outbox.find({
      where: { status: OutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    for (const evt of events) {
      await this.processOne(evt.id);
    }
  }

  private async processOne(outboxEventId: string) {
    // Try to "lock" by moving to PROCESSING.
    // If another worker grabbed it, affected will be 0.
    const res = await this.outbox.update(
      { id: outboxEventId, status: OutboxStatus.PENDING },
      { status: OutboxStatus.PROCESSING },
    );
    if (!res.affected) return;

    const evt = await this.outbox.findOne({ where: { id: outboxEventId } });
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
          throw new Error(`Unknown outbox event type: ${evt.type}`);
      }

      await this.outbox.update({ id: evt.id }, { status: OutboxStatus.SENT });
    } catch (e: any) {
      const attempts = (evt.attempts ?? 0) + 1;
      await this.outbox.update(
        { id: evt.id },
        {
          status: OutboxStatus.FAILED,
          attempts,
          lastError: String(e?.message ?? e),
          // backoff retry after 60s (we'll add retry loop later)
          availableAt: new Date(Date.now() + 60_000),
        },
      );
      this.logger.error(
        `Outbox failed: ${evt.type} ${evt.id} - ${String(e?.message ?? e)}`,
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

    const resp = this.fakePay.generatePaymentLink({
      paymentLinkId: link.id,
      amount: link.amount,
    });

    await this.paymentLinks.update(
      { id: link.id, orgId },
      {
        providerRef: resp.providerRef,
        url: resp.url,
        status: PaymentLinkStatus.SENT,
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

  private async handleShipmentBook(
    orgId: string,
    payload: { shipmentId: string; courierProvider: string; overrides?: any },
  ) {
    const shipment = await this.shipments.findOne({
      where: { id: payload.shipmentId, orgId },
    });
    if (!shipment) return;

    // Load org courier credentials
    const orgCourier = await this.orgCouriers.findOne({
      where: { orgId, type: shipment.courierProvider as any },
    });

    if (!orgCourier?.config) {
      throw new Error(
        `No credentials configured for ${shipment.courierProvider}`,
      );
    }

    const overrides = payload.overrides ?? {};
    let resp: { consignmentId: string; trackingUrl: string; raw?: any };

    if (shipment.courierProvider === 'steadfast') {
      resp = await this.steadfast.bookOrder(orgCourier.config as any, {
        invoiceId: shipment.orderId,
        recipientName: overrides.customerName ?? 'Customer',
        recipientPhone: overrides.customerPhone ?? '',
        recipientAddress: overrides.deliveryAddress ?? '',
        codAmount: overrides.codAmount ?? 0,
        note: overrides.notes ?? '',
        weight: overrides.weight ?? 0.5,
      });
    } else if (shipment.courierProvider === 'pathao') {
      resp = await this.pathao.bookOrder(orgCourier.config as any, {
        storeId: Number(orgCourier.config.storeId),
        merchantOrderId: shipment.orderId,
        recipientName: overrides.customerName ?? 'Customer',
        recipientPhone: overrides.customerPhone ?? '',
        recipientAddress: overrides.deliveryAddress ?? '',
        recipientCity: overrides.cityId ?? 1,
        recipientZone: overrides.zoneId ?? 1,
        deliveryType: 48,
        itemType: 2,
        itemQuantity: 1,
        itemWeight: overrides.weight ?? 0.5,
        amountToCollect: overrides.codAmount ?? 0,
      });
    } else {
      // Fallback to fake for unknown providers
      resp = this.fakeCourier.bookShipment({
        shipmentId: shipment.id,
        courierProvider: shipment.courierProvider,
      });
    }

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
  // private async handleShipmentBook(
  //   orgId: string,
  //   payload: { shipmentId: string; courierProvider: string },
  // ) {
  //   const shipment = await this.shipments.findOne({
  //     where: { id: payload.shipmentId, orgId },
  //   });
  //   if (!shipment) return;

  //   const resp = this.fakeCourier.bookShipment({
  //     shipmentId: shipment.id,
  //     courierProvider: shipment.courierProvider,
  //   });

  //   await this.shipments.update(
  //     { id: shipment.id, orgId },
  //     {
  //       consignmentId: resp.consignmentId,
  //       trackingUrl: resp.trackingUrl,
  //       status: ShipmentStatus.BOOKED,
  //       lastUpdateAt: new Date(),
  //     },
  //   );

  //   await this.shipmentEvents.save(
  //     this.shipmentEvents.create({
  //       orgId,
  //       shipmentId: shipment.id,
  //       type: 'SHIPMENT_BOOKED',
  //       payload: resp,
  //     }),
  //   );

  //   await this.orderEvents.save(
  //     this.orderEvents.create({
  //       orgId,
  //       orderId: shipment.orderId,
  //       type: 'SHIPMENT_BOOKED',
  //       data: {
  //         shipmentId: shipment.id,
  //         consignmentId: resp.consignmentId,
  //         trackingUrl: resp.trackingUrl,
  //       },
  //     }),
  //   );
  // }
}
