import { AbstractEntity } from '@app/common';
import { Column, Entity, Index, Unique } from 'typeorm';

export enum PaymentProviderType {
  BKASH = 'bkash',
  NAGAD = 'nagad',
  ROCKET = 'rocket',
  SSLCOMMERZ = 'sslcommerz',
  STRIPE = 'stripe',
}

@Entity('payment_provider_catalog')
@Unique('uq_payment_provider_catalog_type', ['type'])
export class PaymentProviderCatalogEntity extends AbstractEntity<PaymentProviderCatalogEntity> {
  @Index()
  @Column({ type: 'varchar', length: 50 })
  type: PaymentProviderType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

  // ISO 3166-1 alpha-2 codes: "BD", "NP", ...
  @Column({
    type: 'text',
    array: true,
    name: 'supported_countries',
    default: () => "ARRAY['BD']::text[]",
  })
  supportedCountries: string[];

  @Column({ type: 'text', name: 'logo_url', nullable: true })
  logoUrl?: string;

  @Column({ type: 'text', nullable: true })
  website?: string;
}
