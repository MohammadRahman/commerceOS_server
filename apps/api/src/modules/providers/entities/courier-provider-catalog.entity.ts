import { Column, Entity, Index, Unique } from 'typeorm';
import { AbstractEntity } from '@app/common';

export enum CourierProviderType {
  PATHAO = 'pathao',
  STEADFAST = 'steadfast',
  REDX = 'redx',
  PAPERFLY = 'paperfly',
  SUNDARBAN = 'sundarban',
  // add Nepal later: e.g. 'daraz_logistics', 'parcel_nepal', etc.
}

@Entity('courier_provider_catalog')
@Unique('uq_courier_provider_catalog_type', ['type'])
export class CourierProviderCatalogEntity extends AbstractEntity<CourierProviderCatalogEntity> {
  @Index()
  @Column({ type: 'varchar', length: 50 })
  type: CourierProviderType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: true })
  isEnabled: boolean;

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
