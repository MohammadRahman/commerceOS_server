// apps/api/src/modules/bookkeeping/entities/automation-config.entity.ts

import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { AbstractEntity } from '@app/common';

// ── Union types for constrained string columns ────────────────────────────────
// Defined here so services/DTOs can import them without a circular dep.
export type EmailProvider = 'gmail' | 'outlook';
export type BankName = 'lhv' | 'seb' | 'swedbank' | 'coop' | 'luminor';
export type OpenBankingProvider = 'lhv_connect' | 'saltedge' | 'nordigen';

@Entity('automation_configs')
export class AutomationConfig extends AbstractEntity<AutomationConfig> {
  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @OneToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  // ── Email / Inbox channel ──────────────────────────────────────────────────

  @Column({ name: 'email_enabled', default: false })
  emailEnabled: boolean;

  // FIX: select:false so tokens never leak in general SELECT queries.
  @Column({
    name: 'email_access_token',
    nullable: true,
    type: 'text',
    select: false,
  })
  emailAccessToken: string;

  @Column({
    name: 'email_refresh_token',
    nullable: true,
    type: 'text',
    select: false,
  })
  emailRefreshToken: string;

  // FIX: was `length: 20` with a union type but no DB enum — TypeORM would
  // store/return a plain string and the union gave false safety.
  // Now an explicit enum column so the DB enforces the constraint too.
  @Column({
    name: 'email_provider',
    type: 'enum',
    enum: ['gmail', 'outlook'] as const,
    nullable: true,
  })
  emailProvider: EmailProvider | null;

  @Column({ name: 'email_watch_label', nullable: true, length: 100 })
  emailWatchLabel: string;

  // FIX: decimal → string (Postgres driver returns strings for DECIMAL columns)
  @Column({
    name: 'email_auto_confirm_below',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  emailAutoConfirmBelow: string | null;

  @Column({
    name: 'daily_report_subjects',
    type: 'simple-array',
    nullable: true,
  })
  dailyReportSubjects: string[];

  // ── Bank statement upload ──────────────────────────────────────────────────

  @Column({ name: 'bank_statement_enabled', default: true })
  bankStatementEnabled: boolean;

  // FIX: proper enum column; was a plain varchar with a union type annotation.
  @Column({
    name: 'bank_name',
    type: 'enum',
    enum: ['lhv', 'seb', 'swedbank', 'coop', 'luminor'] as const,
    nullable: true,
  })
  bankName: BankName | null;

  // ── Open banking (PSD2) ────────────────────────────────────────────────────

  @Column({ name: 'open_banking_enabled', default: false })
  openBankingEnabled: boolean;

  // FIX: proper enum column
  @Column({
    name: 'open_banking_provider',
    type: 'enum',
    enum: ['lhv_connect', 'saltedge', 'nordigen'] as const,
    nullable: true,
  })
  openBankingProvider: OpenBankingProvider | null;

  // FIX: select:false on both tokens
  @Column({
    name: 'open_banking_access_token',
    nullable: true,
    type: 'text',
    select: false,
  })
  openBankingAccessToken: string;

  @Column({
    name: 'open_banking_refresh_token',
    nullable: true,
    type: 'text',
    select: false,
  })
  openBankingRefreshToken: string;

  @Column({ name: 'open_banking_account_id', nullable: true, length: 100 })
  openBankingAccountId: string;

  @Column({ name: 'open_banking_last_sync', nullable: true })
  openBankingLastSync: Date;

  // ── General rules ──────────────────────────────────────────────────────────

  // FIX: decimal → string
  @Column({
    name: 'auto_confirm_confidence',
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0.9,
  })
  autoConfirmConfidence: string;

  @Column({ name: 'notify_on_queue', default: true })
  notifyOnQueue: boolean;
}
// apps/api/src/modules/bookkeeping/entities/automation-config.entity.ts

// import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
// import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
// import { AbstractEntity } from '@app/common';

// @Entity('automation_configs')
// export class AutomationConfig extends AbstractEntity<AutomationConfig> {
//   @Column({ name: 'org_id', type: 'uuid' })
//   orgId: string;

//   @OneToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
//   @JoinColumn({ name: 'org_id' })
//   organization: OrganizationEntity;

//   // ── Email / Inbox channel ──────────────────────────────────────────────────

//   @Column({ name: 'email_enabled', default: false })
//   emailEnabled: boolean;

//   /** Gmail / Outlook OAuth access token (encrypted at rest) */
//   @Column({ name: 'email_access_token', nullable: true, type: 'text' })
//   emailAccessToken: string;

//   @Column({ name: 'email_refresh_token', nullable: true, type: 'text' })
//   emailRefreshToken: string;

//   @Column({ name: 'email_provider', nullable: true, length: 20 })
//   emailProvider: 'gmail' | 'outlook';

//   /** Gmail filter label or Outlook folder to watch */
//   @Column({ name: 'email_watch_label', nullable: true, length: 100 })
//   emailWatchLabel: string;

//   /** Auto-confirm invoice entries below this amount without human review */
//   @Column({
//     name: 'email_auto_confirm_below',
//     type: 'decimal',
//     precision: 10,
//     scale: 2,
//     nullable: true,
//   })
//   emailAutoConfirmBelow: number;

//   /** Regex / keyword list that identifies daily-report emails */
//   @Column({
//     name: 'daily_report_subjects',
//     type: 'simple-array',
//     nullable: true,
//   })
//   dailyReportSubjects: string[];

//   // ── Bank statement upload ──────────────────────────────────────────────────

//   @Column({ name: 'bank_statement_enabled', default: true })
//   bankStatementEnabled: boolean;

//   /** Default bank — affects PDF parsing strategy */
//   @Column({ name: 'bank_name', nullable: true, length: 50 })
//   bankName: 'lhv' | 'seb' | 'swedbank' | 'coop' | 'luminor';

//   // ── Open banking (PSD2) ────────────────────────────────────────────────────

//   @Column({ name: 'open_banking_enabled', default: false })
//   openBankingEnabled: boolean;

//   @Column({ name: 'open_banking_provider', nullable: true, length: 50 })
//   openBankingProvider: 'lhv_connect' | 'saltedge' | 'nordigen';

//   @Column({ name: 'open_banking_access_token', nullable: true, type: 'text' })
//   openBankingAccessToken: string;

//   @Column({ name: 'open_banking_refresh_token', nullable: true, type: 'text' })
//   openBankingRefreshToken: string;

//   @Column({ name: 'open_banking_account_id', nullable: true, length: 100 })
//   openBankingAccountId: string;

//   /** Last successful sync timestamp */
//   @Column({ name: 'open_banking_last_sync', nullable: true })
//   openBankingLastSync: Date;

//   // ── General rules ──────────────────────────────────────────────────────────

//   /** Auto-confirm any matched entry above this confidence threshold (0–1) */
//   @Column({
//     name: 'auto_confirm_confidence',
//     type: 'decimal',
//     precision: 3,
//     scale: 2,
//     default: 0.9,
//   })
//   autoConfirmConfidence: number;

//   /** Notify by email when new items land in review queue */
//   @Column({ name: 'notify_on_queue', default: true })
//   notifyOnQueue: boolean;
// }
