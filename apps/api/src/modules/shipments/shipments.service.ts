/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { ShipmentEventEntity } from './entities/shipment-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { IdempotencyService, OutboxService } from '@app/common';
import { PathaoProvider } from '@app/common/couriers/pathao.provider';
import { SteadfastProvider } from '@app/common/couriers/steadfast.provider';
import { OrgCourierProviderEntity } from '../providers/entities/org-courier-provider.entity';

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

    @InjectRepository(OrgCourierProviderEntity)
    private orgCouriers: Repository<OrgCourierProviderEntity>,
    private steadfast: SteadfastProvider,
    private pathao: PathaoProvider,
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

  async getShipment(orgId: string, id: string) {
    const shipment = await this.shipments.findOne({
      where: { id, orgId },
      relations: ['events'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }
  async trackShipment(orgId: string, shipmentId: string) {
    const shipment = await this.shipments.findOne({
      where: { id: shipmentId, orgId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!shipment.consignmentId)
      throw new BadRequestException('No consignment ID yet');

    const cfg = await this.getOrgCourierConfig(orgId, shipment.courierProvider);

    let result: any;
    if (shipment.courierProvider === 'steadfast') {
      result = await this.steadfast.trackOrder(cfg, shipment.consignmentId);
    } else if (shipment.courierProvider === 'pathao') {
      result = await this.pathao.trackOrder(cfg, shipment.consignmentId);
    } else {
      result = { status: shipment.status };
    }

    const next = this.mapStatus(result.status?.toUpperCase() ?? '');
    if (next && next !== shipment.status) {
      await this.shipments.update(
        { id: shipmentId, orgId },
        {
          status: next,
          lastUpdateAt: new Date(),
        },
      );
    }

    return { ...result, shipmentId, currentStatus: next ?? shipment.status };
  }

  async cancelShipment(orgId: string, shipmentId: string) {
    const shipment = await this.shipments.findOne({
      where: { id: shipmentId, orgId },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    const cfg = await this.getOrgCourierConfig(orgId, shipment.courierProvider);

    let result: any;
    if (shipment.courierProvider === 'steadfast') {
      result = await this.steadfast.cancelOrder(
        cfg,
        shipment.consignmentId ?? '',
      );
    } else if (shipment.courierProvider === 'pathao') {
      result = await this.pathao.cancelOrder(cfg, shipment.consignmentId ?? '');
    }

    await this.shipments.update(
      { id: shipmentId, orgId },
      {
        status: ShipmentStatus.CANCELLED,
        lastUpdateAt: new Date(),
      },
    );

    await this.shipmentEvents.save(
      this.shipmentEvents.create({
        orgId,
        shipmentId,
        type: 'SHIPMENT_CANCELLED',
        payload: result,
      }),
    );

    return { cancelled: true, ...result };
  }

  async getZones(
    orgId: string,
    provider: string,
    params: { cityId?: string; zoneId?: string },
  ) {
    const cfg = await this.getOrgCourierConfig(orgId, provider);

    if (provider === 'steadfast') {
      return this.steadfast.getAreas(cfg);
    } else if (provider === 'pathao') {
      if (params.zoneId)
        return this.pathao.getAreas(cfg, Number(params.zoneId));
      if (params.cityId)
        return this.pathao.getZones(cfg, Number(params.cityId));
      return this.pathao.getCities(cfg);
    }
    return { areas: [] };
  }
  async calculateCharge(orgId: string, provider: string, params: any) {
    const cfg = await this.getOrgCourierConfig(orgId, provider);

    if (provider === 'steadfast') {
      return this.steadfast.calculateCharge(cfg, params);
    } else if (provider === 'pathao') {
      return this.pathao.calculateCharge(cfg, params);
    }
    return { total: 0 };
  }

  private async getOrgCourierConfig(orgId: string, provider: string) {
    const row = await this.orgCouriers.findOne({
      where: { orgId, type: provider as any },
    });
    if (!row?.config)
      throw new BadRequestException(`${provider} not configured`);
    return row.config as any;
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
