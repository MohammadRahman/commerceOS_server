// apps/api/src/modules/bookkeeping/entities/supplier.entity.ts

import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { AbstractEntity } from '@app/common';

// FIX: Explicit enum instead of an inline string-array in the @Column decorator.
// Consistent with the rest of the codebase and lets services import the type.
export enum SupplierSource {
  MANUAL = 'manual',
  EMAIL_PARSER = 'email_parser',
  BANK_STATEMENT = 'bank_statement',
  OPEN_BANKING = 'open_banking',
}

@Entity('suppliers')
@Index(['orgId', 'email'], { unique: false })
export class Supplier extends AbstractEntity<Supplier> {
  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  /** e.g. "Bolt Food OÜ" */
  @Column({ length: 255 })
  name: string;

  /** Estonian reg number / VAT number extracted from invoice */
  @Column({ name: 'registration_number', nullable: true, length: 50 })
  registrationNumber: string;

  /** VAT / KM number (EE prefix) */
  @Column({ name: 'vat_number', nullable: true, length: 50 })
  vatNumber: string;

  @Column({ nullable: true, length: 255 })
  email: string;

  @Column({ nullable: true, length: 255 })
  website: string;

  /** IBAN used by this supplier — helps bank-statement matching */
  @Column({ nullable: true, length: 34 })
  iban: string;

  // FIX: was `simple-array` which stores as a comma-separated string in Postgres.
  // If any alias contains a comma the data silently corrupts.
  // Changed to `jsonb` (stored as a proper JSON array) which is safe for
  // arbitrary strings and still queryable with the @> operator.
  @Column({ type: 'jsonb', nullable: true, default: '[]' })
  aliases: string[];

  /** Default expense category for entries from this supplier */
  @Column({ name: 'default_category', nullable: true, length: 100 })
  defaultCategory: string;

  // FIX: use the SupplierSource enum for consistency and importability.
  @Column({
    name: 'source',
    type: 'enum',
    enum: SupplierSource,
    default: SupplierSource.MANUAL,
  })
  source: SupplierSource;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
// apps/api/src/modules/bookkeeping/entities/supplier.entity.ts

// import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
// import { AbstractEntity } from '@app/common';

// @Entity('suppliers')
// @Index(['orgId', 'email'], { unique: false })
// export class Supplier extends AbstractEntity<Supplier> {
//   @Column({ name: 'org_id', type: 'uuid' })
//   orgId: string;

//   @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
//   @JoinColumn({ name: 'org_id' })
//   organization: OrganizationEntity;

//   /** e.g. "Bolt Food OÜ" */
//   @Column({ length: 255 })
//   name: string;

//   /** Estonian reg number / VAT number extracted from invoice */
//   @Column({ name: 'registration_number', nullable: true, length: 50 })
//   registrationNumber: string;

//   /** VAT / KM number (EE prefix) */
//   @Column({ name: 'vat_number', nullable: true, length: 50 })
//   vatNumber: string;

//   @Column({ nullable: true, length: 255 })
//   email: string;

//   @Column({ nullable: true, length: 255 })
//   website: string;

//   /** IBAN used by this supplier — helps bank-statement matching */
//   @Column({ nullable: true, length: 34 })
//   iban: string;

//   /** Fuzzy-match keywords extracted from invoice sender names / email domains */
//   @Column({ type: 'simple-array', nullable: true })
//   aliases: string[];

//   /** Default expense category for entries from this supplier */
//   @Column({ name: 'default_category', nullable: true, length: 100 })
//   defaultCategory: string;

//   /** How this supplier was first created */
//   @Column({
//     name: 'source',
//     type: 'enum',
//     enum: ['manual', 'email_parser', 'bank_statement', 'open_banking'],
//     default: 'manual',
//   })
//   source: 'manual' | 'email_parser' | 'bank_statement' | 'open_banking';

//   @Column({ name: 'is_active', default: true })
//   isActive: boolean;
// }
