/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { ShipmentEventEntity } from './entities/shipment-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { IdempotencyService, OutboxService } from '@app/common';

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectRepository(ShipmentEntity)
    private shipments: Repository<ShipmentEntity>,
    @InjectRepository(ShipmentEventEntity)
    private shipmentEvents: Repository<ShipmentEventEntity>,
    @InjectRepository(OrderEntity) private orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private orderEvents: Repository<OrderEventEntity>,
    private outbox: OutboxService,
    private idem: IdempotencyService,
  ) {}

  async bookShipment(
    orgId: string,
    userId: string,
    orderId: string,
    dto: {
      courierProvider: string;
      customerName?: string;
      customerPhone?: string;
      deliveryAddress?: string;
      notes?: string;
    },
  ) {
    const order = await this.orders.findOne({ where: { id: orderId, orgId } });
    if (!order) throw new NotFoundException('Order not found');

    const shipment = await this.shipments.save(
      this.shipments.create({
        orgId,
        orderId: order.id,
        courierProvider: dto.courierProvider,
        status: ShipmentStatus.CREATED,
      }),
    );

    await this.shipmentEvents.save(
      this.shipmentEvents.create({
        orgId,
        shipmentId: shipment.id,
        type: 'SHIPMENT_CREATED',
        payload: { userId, dto },
      }),
    );

    await this.orderEvents.save(
      this.orderEvents.create({
        orgId,
        orderId: order.id,
        type: 'SHIPMENT_REQUESTED',
        data: {
          userId,
          shipmentId: shipment.id,
          courierProvider: dto.courierProvider,
        },
      }),
    );

    // enqueue booking
    await this.outbox.enqueue(orgId, 'shipment.book', {
      shipmentId: shipment.id,
      courierProvider: dto.courierProvider,
      overrides: dto,
    });

    return shipment;
  }

  async handleCourierWebhook(provider: string, orgId: string, payload: any) {
    // Idempotency: requires some provider reference / event id.
    const ref =
      payload?.eventId ||
      payload?.trackingId ||
      payload?.consignmentId ||
      payload?.id;
    if (!ref) return { ok: true, ignored: 'no_ref' };

    const ok = await this.idem.claim(
      orgId,
      `webhook:courier:${provider}`,
      String(ref),
      { ttlSeconds: 60 * 60 * 24 * 14 },
    );
    if (!ok) return { ok: true, duplicate: true };

    // find shipment by consignmentId if present
    const consignmentId = payload?.consignmentId || payload?.trackingId;
    if (!consignmentId) return { ok: true, ignored: 'no_consignment' };

    const shipment = await this.shipments.findOne({
      where: {
        orgId,
        courierProvider: provider,
        consignmentId: String(consignmentId),
      } as any,
    });

    if (!shipment) return { ok: true, ignored: 'unknown_consignment' };

    await this.shipmentEvents.save(
      this.shipmentEvents.create({
        orgId,
        shipmentId: shipment.id,
        type: 'COURIER_WEBHOOK_RECEIVED',
        payload,
      }),
    );

    // Map provider statuses later; for now accept payload.status
    const statusRaw = String(payload?.status ?? '').toUpperCase();
    const next = this.mapStatus(statusRaw);

    if (next && next !== shipment.status) {
      await this.shipments.update(
        { id: shipment.id, orgId },
        { status: next, lastUpdateAt: new Date() },
      );

      await this.shipmentEvents.save(
        this.shipmentEvents.create({
          orgId,
          shipmentId: shipment.id,
          type: 'SHIPMENT_STATUS_UPDATED',
          payload: {
            from: shipment.status,
            to: next,
            providerStatus: statusRaw,
          },
        }),
      );

      await this.orderEvents.save(
        this.orderEvents.create({
          orgId,
          orderId: shipment.orderId,
          type: 'ORDER_SHIPMENT_STATUS_UPDATED',
          data: { shipmentId: shipment.id, from: shipment.status, to: next },
        }),
      );
    }

    return { ok: true };
  }

  private mapStatus(s: string): ShipmentStatus | null {
    // We'll refine per courier later.
    if (['BOOKED', 'PICKED', 'PICKED_UP'].includes(s))
      return ShipmentStatus.BOOKED;
    if (['IN_TRANSIT', 'SHIPPED'].includes(s)) return ShipmentStatus.IN_TRANSIT;
    if (['OUT_FOR_DELIVERY', 'OFD'].includes(s))
      return ShipmentStatus.OUT_FOR_DELIVERY;
    if (['DELIVERED'].includes(s)) return ShipmentStatus.DELIVERED;
    if (['FAILED', 'FAILED_DELIVERY'].includes(s)) return ShipmentStatus.FAILED;
    if (['RETURNED'].includes(s)) return ShipmentStatus.RETURNED;
    if (['CANCELLED', 'CANCELED'].includes(s)) return ShipmentStatus.CANCELLED;
    return null;
  }
}
