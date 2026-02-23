/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

import * as crypto from 'crypto';
import { UpdateOrgProviderDto } from '../dto/update-org-provider.dto';
import {
  CourierProviderCatalogEntity,
  CourierProviderType,
} from '../entities/courier-provider-catalog.entity';
import { OrgCourierProviderEntity } from '../entities/org-courier-provider.entity';
import {
  OrgPaymentProviderEntity,
  ProviderStatus,
} from '../entities/org-payment-provider.entity';
import {
  PaymentProviderCatalogEntity,
  PaymentProviderType,
} from '../entities/payment-provider-catalog.entity';

@Injectable()
export class OrgProvidersService {
  constructor(
    @InjectRepository(OrgPaymentProviderEntity)
    private orgPayments: Repository<OrgPaymentProviderEntity>,
    @InjectRepository(OrgCourierProviderEntity)
    private orgCouriers: Repository<OrgCourierProviderEntity>,
    @InjectRepository(PaymentProviderCatalogEntity)
    private payCatalog: Repository<PaymentProviderCatalogEntity>,
    @InjectRepository(CourierProviderCatalogEntity)
    private courierCatalog: Repository<CourierProviderCatalogEntity>,
  ) {}

  // --- list configured providers for org ---
  listOrgPayments(orgId: string) {
    return this.orgPayments.find({
      where: { orgId } as any,
      order: { createdAt: 'ASC' } as any,
    });
  }

  listOrgCouriers(orgId: string) {
    return this.orgCouriers.find({
      where: { orgId } as any,
      order: { createdAt: 'ASC' } as any,
    });
  }

  // --- upsert org provider config ---
  async upsertPayment(
    orgId: string,
    dto: {
      type: PaymentProviderType;
      status: ProviderStatus;
      config?: Record<string, any>;
    },
  ) {
    const type = dto.type;
    const status = dto.status;

    const row = await this.orgPayments.findOne({
      where: { orgId, type } as any,
    });

    if (!row) {
      const created = this.orgPayments.create({
        orgId,
        type,
        status,
        config: dto.config ?? {},
        webhookKey: crypto.randomBytes(24).toString('hex'),
      } as DeepPartial<OrgPaymentProviderEntity>);

      return this.orgPayments.save(created);
    }

    row.status = status;
    row.config = dto.config ?? row.config;
    if (!row.webhookKey)
      row.webhookKey = crypto.randomBytes(24).toString('hex');

    return this.orgPayments.save(row);
  }
  async upsertOrgCourier(
    orgId: string,
    type: CourierProviderType,
    dto: UpdateOrgProviderDto,
  ) {
    const catalog = await this.courierCatalog.findOne({
      where: { type } as any,
    });

    if (!catalog?.isEnabled) {
      throw new BadRequestException('Provider not available');
    }

    const status = dto.status as ProviderStatus;

    const existing = await this.orgCouriers.findOne({
      where: { orgId, type } as any,
    });

    if (!existing) {
      const created = this.orgCouriers.create({
        orgId,
        type,
        status,
        config: dto.config ?? {},
        webhookKey: crypto.randomBytes(24).toString('hex'),
      } as DeepPartial<OrgCourierProviderEntity>);

      return this.orgCouriers.save(created); // ✅ single-entity save
    }

    existing.status = status;
    if (dto.config !== undefined) existing.config = dto.config;
    if (!existing.webhookKey)
      existing.webhookKey = crypto.randomBytes(24).toString('hex');

    return this.orgCouriers.save(existing); // ✅ existing is not null
  }

  async getPaymentWebhookKey(orgId: string, type: PaymentProviderType) {
    const row = await this.orgPayments.findOne({
      where: { orgId, type } as any,
    });
    if (!row) throw new NotFoundException('Org provider config not found');
    return { webhookKey: row.webhookKey };
  }
}
