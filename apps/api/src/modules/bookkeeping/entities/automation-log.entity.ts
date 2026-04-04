// apps/api/src/modules/bookkeeping/entities/automation-log.entity.ts

import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { AbstractEntity } from '@app/common';

export type AutomationSourceType =
  | 'email_invoice' // attachment on incoming email
  | 'email_daily_report' // body of a daily sales summary email
  | 'bank_statement_pdf' // uploaded PDF statement
  | 'open_banking'; // PSD2 live feed

export type AutomationStatus =
  | 'pending' // parsed, waiting human review
  | 'confirmed' // human (or auto-confirm rule) accepted
  | 'rejected' // human discarded
  | 'error'; // parse / match failed

// ─── Parsed data shape ────────────────────────────────────────────────────────
// Stored in JSONB — numbers inside JSONB stay as JS numbers (no coercion),
// so `amount` and `confidence` remain typed as `number` here.
export interface AutomationParsedData {
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  date: string; // ISO date YYYY-MM-DD
  description: string;
  category?: string;
  supplierId?: string;
  supplierName?: string;
  vatAmount?: number;
  vatRate?: number;
  receiptUrl?: string;
  confidence: number; // 0–1
}

@Entity('automation_logs')
@Index(['orgId', 'sourceType'])
@Index(['orgId', 'status'])
@Index(['externalRef'], { unique: false })
export class AutomationLog extends AbstractEntity<AutomationLog> {
  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column({ name: 'source_type', type: 'varchar', length: 50 })
  sourceType: AutomationSourceType;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
  status: AutomationStatus;

  /**
   * Deduplication key — message-id for emails, transaction-id for bank feeds,
   * file hash for PDF uploads.
   */
  @Column({ name: 'external_ref', nullable: true, length: 255 })
  externalRef: string;

  /** Raw extracted payload — stored for audit & re-processing */
  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown>;

  /** Parsed & normalised data ready to become a bookkeeping entry.
   *  Extracted into a named interface (AutomationParsedData) so services
   *  can import it without repeating the inline shape.
   */
  @Column({ name: 'parsed_data', type: 'jsonb', nullable: true })
  parsedData: AutomationParsedData | null;

  /** bookkeeping_entry id once confirmed */
  @Column({ name: 'entry_id', nullable: true, type: 'uuid' })
  entryId: string;

  /** supplier id resolved / created */
  @Column({ name: 'supplier_id', nullable: true, type: 'uuid' })
  supplierId: string;

  /** Human-readable error if status=error */
  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: string;

  // FIX: `decimal` columns are returned as strings by the Postgres driver.
  // Typed as `string | null` to reflect runtime reality.
  // Use parseFloat(log.confidence) before any comparison / arithmetic.
  @Column({
    name: 'confidence',
    type: 'decimal',
    precision: 4,
    scale: 3,
    nullable: true,
  })
  confidence: string | null;

  // NOTE: reviewedBy stores a user ID (UUID string). No FK enforced here
  // intentionally — the user may be deleted but we want to keep the audit
  // trail. If strict referential integrity is needed, add a FK with
  // onDelete: 'SET NULL'.
  @Column({ name: 'reviewed_by', nullable: true, type: 'uuid' })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', nullable: true, type: 'timestamp' })
  reviewedAt: Date | null;
}
// apps/api/src/modules/bookkeeping/entities/automation-log.entity.ts

// import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
// import { AbstractEntity } from '@app/common';

// export type AutomationSourceType =
//   | 'email_invoice' // attachment on incoming email
//   | 'email_daily_report' // body of a daily sales summary email
//   | 'bank_statement_pdf' // uploaded PDF statement
//   | 'open_banking'; // PSD2 live feed

// export type AutomationStatus =
//   | 'pending' // parsed, waiting human review
//   | 'confirmed' // human (or auto-confirm rule) accepted
//   | 'rejected' // human discarded
//   | 'error'; // parse / match failed

// @Entity('automation_logs')
// @Index(['orgId', 'sourceType'])
// @Index(['orgId', 'status'])
// @Index(['externalRef'], { unique: false })
// export class AutomationLog extends AbstractEntity<AutomationLog> {
//   @Column({ name: 'org_id', type: 'uuid' })
//   orgId: string;

//   @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
//   @JoinColumn({ name: 'org_id' })
//   organization: OrganizationEntity;

//   @Column({ name: 'source_type', type: 'varchar', length: 50 })
//   sourceType: AutomationSourceType;

//   @Column({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
//   status: AutomationStatus;

//   /**
//    * Deduplication key — message-id for emails, transaction-id for bank feeds,
//    * file hash for PDF uploads.
//    */
//   @Column({ name: 'external_ref', nullable: true, length: 255 })
//   externalRef: string;

//   /** Raw extracted payload — stored for audit & re-processing */
//   @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
//   rawPayload: Record<string, unknown>;

//   /** Parsed & normalised data ready to become a bookkeeping entry */
//   @Column({ name: 'parsed_data', type: 'jsonb', nullable: true })
//   parsedData: {
//     type: 'expense' | 'income';
//     amount: number;
//     currency: string;
//     date: string; // ISO date
//     description: string;
//     category?: string;
//     supplierId?: string;
//     supplierName?: string;
//     vatAmount?: number;
//     vatRate?: number;
//     receiptUrl?: string; // stored file path
//     confidence: number; // 0–1
//   } | null;

//   /** bookkeeping_entry id once confirmed */
//   @Column({ name: 'entry_id', nullable: true })
//   entryId: string;

//   /** supplier id resolved / created */
//   @Column({ name: 'supplier_id', nullable: true })
//   supplierId: string;

//   /** Human-readable error if status=error */
//   @Column({ name: 'error_message', nullable: true, type: 'text' })
//   errorMessage: string;

//   /** AI confidence score 0-1 */
//   @Column({
//     name: 'confidence',
//     type: 'decimal',
//     precision: 4,
//     scale: 3,
//     nullable: true,
//   })
//   confidence: number;

//   /** Who confirmed/rejected (null = auto-rule) */
//   @Column({ name: 'reviewed_by', nullable: true })
//   reviewedBy: string;

//   @Column({ name: 'reviewed_at', nullable: true })
//   reviewedAt: Date;
// }
