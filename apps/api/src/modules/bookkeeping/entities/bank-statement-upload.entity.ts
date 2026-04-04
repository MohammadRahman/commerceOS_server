import { AbstractEntity } from './../../../../../../libs/common/src/database/base.entity';
// apps/api/src/modules/bookkeeping/entities/bank-statement-upload.entity.ts
//
// Tracks every bank statement PDF upload — one row per file.
// Gives the user a full history of what was parsed, when, and what happened.

import { Entity, Column, Index } from 'typeorm';

export type UploadStatus =
  | 'processing' // currently being parsed
  | 'completed' // all transactions processed (some may be duplicates/errors)
  | 'failed' // parse failed entirely (scanned PDF, wrong format, etc.)
  | 'duplicate_file'; // exact same file already uploaded before

export type ParseMethod = 'rules' | 'ai_fallback' | 'chunked_ai' | 'unknown';

@Entity('bank_statement_uploads')
@Index(['orgId', 'fileHash'], { unique: true })
@Index(['orgId', 'createdAt'])
export class BankStatementUpload extends AbstractEntity<BankStatementUpload> {
  @Column({ name: 'org_id' })
  @Index()
  orgId: string;

  // ── File identity ──────────────────────────────────────────────────────────

  @Column({ name: 'file_hash', length: 64 })
  fileHash: string;

  @Column({ name: 'filename' })
  filename: string;

  @Column({ name: 'file_size_bytes', nullable: true, type: 'bigint' })
  fileSizeBytes: number | null;

  @Column({ name: 'estimated_pages', nullable: true, type: 'int' })
  estimatedPages: number | null;

  // ── Bank / statement metadata (populated after parse) ─────────────────────

  @Column({ name: 'bank_name', nullable: true, type: 'varchar' })
  bankName: string | null;

  @Column({ name: 'account_iban', nullable: true, type: 'varchar' })
  accountIban: string | null;

  @Column({ name: 'account_holder', nullable: true, type: 'varchar' })
  accountHolder: string | null;

  @Column({ name: 'period_from', nullable: true, type: 'date' })
  periodFrom: string | null; // YYYY-MM-DD

  @Column({ name: 'period_to', nullable: true, type: 'date' })
  periodTo: string | null; // YYYY-MM-DD

  // ── Parse result summary ───────────────────────────────────────────────────

  @Column({
    type: 'varchar',
    default: 'processing',
  })
  status: UploadStatus;

  @Column({
    name: 'parse_method',
    type: 'varchar',
    nullable: true,
  })
  parseMethod: ParseMethod | null;

  /** Total transactions found in the statement */
  @Column({ name: 'tx_total', default: 0 })
  txTotal: number;

  /** New entries written to BookkeepingEntry */
  @Column({ name: 'tx_created', default: 0 })
  txCreated: number;

  /** Skipped because an identical entry already existed (bank dedup OR manual entry dedup) */
  @Column({ name: 'tx_duplicate', default: 0 })
  txDuplicate: number;

  /** Transactions that caused an error and were not stored */
  @Column({ name: 'tx_errors', default: 0 })
  txErrors: number;

  /** Of txCreated, how many are income */
  @Column({ name: 'tx_income', default: 0 })
  txIncome: number;

  /** Of txCreated, how many are expense */
  @Column({ name: 'tx_expense', default: 0 })
  txExpense: number;

  /** Total income amount (sum of positive transactions) */
  @Column({
    name: 'total_income_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalIncomeAmount: string;

  /** Total expense amount (sum of absolute values of negative transactions) */
  @Column({
    name: 'total_expense_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalExpenseAmount: string;

  /** AI confidence score 0–1 for the parse */
  @Column({
    name: 'confidence',
    type: 'decimal',
    precision: 5,
    scale: 3,
    nullable: true,
  })
  confidence: string | null;

  // ── Chunking info (for large files) ──────────────────────────────────────

  /** Number of chunks the text was split into for AI processing (1 = no chunking) */
  @Column({ name: 'chunk_count', default: 1 })
  chunkCount: number;

  // ── Error detail ──────────────────────────────────────────────────────────

  /** Human-readable error message if status = 'failed' */
  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage: string | null;

  // ── Duplicate file reference ──────────────────────────────────────────────

  /** If status = 'duplicate_file', points to the original upload id */
  @Column({ name: 'duplicate_of_id', nullable: true, type: 'varchar' })
  duplicateOfId: string | null;
}
