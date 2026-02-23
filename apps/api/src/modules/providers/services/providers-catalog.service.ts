import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CourierProviderCatalogEntity } from '../entities/courier-provider-catalog.entity';
import { PaymentProviderCatalogEntity } from '../entities/payment-provider-catalog.entity';

@Injectable()
export class ProvidersCatalogService {
  constructor(
    @InjectRepository(PaymentProviderCatalogEntity)
    private payments: Repository<PaymentProviderCatalogEntity>,
    @InjectRepository(CourierProviderCatalogEntity)
    private couriers: Repository<CourierProviderCatalogEntity>,
  ) {}

  async listPayments(country?: string) {
    const qb = this.payments
      .createQueryBuilder('p')
      .where('p.isEnabled = true');

    if (country) {
      // Postgres array contains
      qb.andWhere(':country = ANY(p.supportedCountries)', { country });
    }

    return qb.orderBy('p.name', 'ASC').getMany();
  }

  async listCouriers(country?: string) {
    const qb = this.couriers
      .createQueryBuilder('c')
      .where('c.isEnabled = true');

    if (country) {
      qb.andWhere(':country = ANY(c.supportedCountries)', { country });
    }

    return qb.orderBy('c.name', 'ASC').getMany();
  }
}
