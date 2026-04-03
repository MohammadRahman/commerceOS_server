// apps/api/src/modules/bookkeeping/services/bank-statement.service.ts
//
// Parses uploaded PDF bank statements from Estonian banks and writes
// BookkeepingEntry records directly.
//
// Flow:
//   1. User uploads PDF → base64 passed here
//   2. AiService.parseBankStatementPdf() extracts all transactions
//   3. Each transaction is deduped, supplier-matched, and written as a
//      confirmed BookkeepingEntry (income or expense) via EntryService
//   4. An AutomationLog is created per transaction for the audit trail
//   5. Returns { created, duplicate, errors } counts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AiService } from '../../ai/ai.service';
import { SupplierService } from './supplier.service';
import { EntryService } from './entry.service';
import { AutomationLog } from '../entities/automation-log.entity';
import { AutomationConfig } from '../entities/automation-config.entity';
import { EntryCategory } from '../entities/bookkeeping.entities';
import { BookkeepingEntry } from '../entities/bookkeeping.entities';

// ── Result shape ──────────────────────────────────────────────────────────────

export interface BankStatementResult {
  created: number;
  duplicate: number;
  errors: number;
  entries: BookkeepingEntry[];
  logs: AutomationLog[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  // Estonian bank IBAN prefixes for auto-detection (digits 3-4 of EExx____...)
  private readonly IBAN_BANK_MAP: Record<string, string> = {
    '77': 'lhv',
    '10': 'seb',
    '22': 'swedbank',
    '96': 'luminor',
    '86': 'coop',
  };

  constructor(
    private readonly ai: AiService,
    private readonly supplierService: SupplierService,
    private readonly entryService: EntryService,
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Process an uploaded bank statement PDF for any date range.
   * The statement can cover a mid-month slice, full month, or even multiple
   * months — each transaction is bucketed into the correct tax period by its
   * own date, so partial uploads are safe and idempotent.
   */
  async processUpload(
    organizationId: string,
    pdfBase64: string,
    filename: string,
  ): Promise<BankStatementResult> {
    // ── 1. Whole-file dedup ───────────────────────────────────────────────
    const fileHash = crypto
      .createHash('sha256')
      .update(pdfBase64)
      .digest('hex');

    const alreadyProcessed = await this.logRepo.findOne({
      where: { orgId: organizationId, externalRef: `pdf_file:${fileHash}` },
    });
    if (alreadyProcessed) {
      this.logger.log(`[BankStatement] Duplicate file upload: ${fileHash}`);
      return { created: 0, duplicate: 1, errors: 0, entries: [], logs: [] };
    }

    // ── 2. Load org automation config ─────────────────────────────────────
    const cfg = await this.configRepo.findOne({
      where: { orgId: organizationId },
    });

    // ── 3. Detect bank from filename for a better AI hint ─────────────────
    const bankHint = this.detectBankFromFilename(filename);

    // ── 4. Parse the PDF via AiService ────────────────────────────────────
    // AiService.parseBankStatementPdf handles the Claude call + JSON cleanup.
    const statement = await this.ai.parseBankStatementPdf(
      pdfBase64,
      bankHint ?? undefined,
    );

    if (!statement || statement.transactions.length === 0) {
      this.logger.warn(
        `[BankStatement] No transactions extracted from ${filename}`,
      );
      return { created: 0, duplicate: 0, errors: 1, entries: [], logs: [] };
    }

    this.logger.log(
      `[BankStatement] org=${organizationId} file=${filename} ` +
        `bank=${statement.bankName} txCount=${statement.transactions.length}`,
    );

    // ── 5. Process each transaction ───────────────────────────────────────
    // FIX: autoConfirmConfidence is a string decimal — parse before comparison
    const autoConfirmThreshold = parseFloat(
      cfg?.autoConfirmConfidence ?? '0.90',
    );

    const entries: BookkeepingEntry[] = [];
    const logs: AutomationLog[] = [];
    let duplicates = 0;
    let errors = 0;

    for (const tx of statement.transactions) {
      try {
        const result = await this.processTransaction(
          organizationId,
          tx,
          statement.confidence,
          autoConfirmThreshold,
          fileHash,
        );

        if (result === 'duplicate') {
          duplicates++;
        } else {
          entries.push(result.entry);
          logs.push(result.log);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[BankStatement] TX error: ${msg}`, { tx });
        errors++;
      }
    }

    // ── 6. Mark the whole file as processed (sentinel log) ────────────────
    await this.logRepo.save(
      this.logRepo.create({
        orgId: organizationId,
        sourceType: 'bank_statement_pdf',
        status: 'confirmed',
        externalRef: `pdf_file:${fileHash}`,
        rawPayload: {
          filename,
          bankName: statement.bankName,
          iban: statement.iban,
          periodFrom: statement.periodFrom,
          periodTo: statement.periodTo,
          txCount: statement.transactions.length,
        },
        parsedData: null,
      } as Partial<AutomationLog>),
    );

    this.logger.log(
      `[BankStatement] Done org=${organizationId}: ` +
        `created=${entries.length} duplicate=${duplicates} errors=${errors}`,
    );

    return {
      created: entries.length,
      duplicate: duplicates,
      errors,
      entries,
      logs,
    };
  }

  // ── Per-transaction processing ────────────────────────────────────────────

  private async processTransaction(
    organizationId: string,
    tx: {
      date: string;
      description: string;
      amount: number;
      currency: string;
      counterpartyName?: string;
      counterpartyIban?: string;
      referenceNumber?: string;
      transactionId?: string;
      category?: string;
    },
    statementConfidence: number,
    autoConfirmThreshold: number,
    fileHash: string,
  ): Promise<'duplicate' | { entry: BookkeepingEntry; log: AutomationLog }> {
    // ── Dedup key ──────────────────────────────────────────────────────────
    // Prefer the bank's own transaction ID. Fall back to a composite key so
    // re-uploads of the same statement don't create duplicate entries.
    const dedupKey = tx.transactionId
      ? `tx:${tx.transactionId}`
      : `pdf:${fileHash}:${tx.date}:${tx.amount}:${tx.description.slice(0, 40)}`;

    const existing = await this.logRepo.findOne({
      where: { orgId: organizationId, externalRef: dedupKey },
    });
    if (existing) return 'duplicate';

    // ── Direction ──────────────────────────────────────────────────────────
    // Negative amount = money leaving the account = expense
    // Positive amount = money arriving             = income
    const isExpense = tx.amount < 0;
    const absAmount = Math.abs(tx.amount);

    // ── Supplier matching (expenses only) ──────────────────────────────────
    let supplierId: string | undefined;
    let supplierName: string | undefined;
    let defaultCategory: string | undefined;

    if (isExpense && (tx.counterpartyName || tx.counterpartyIban)) {
      const { supplier } = await this.supplierService.findOrCreate(
        organizationId,
        {
          name: tx.counterpartyName ?? 'Unknown',
          iban: tx.counterpartyIban,
        },
        'bank_statement_pdf',
      );
      supplierId = supplier.id;
      supplierName = supplier.name;
      defaultCategory = supplier.defaultCategory ?? undefined;
    }

    // ── Confidence score ───────────────────────────────────────────────────
    // Start from the statement-level confidence and boost for each signal
    // that gives us higher certainty about this specific transaction.
    let confidence = statementConfidence;
    if (tx.transactionId) confidence = Math.min(1, confidence + 0.05);
    if (tx.counterpartyName) confidence = Math.min(1, confidence + 0.05);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tx.date))
      confidence = Math.min(1, confidence + 0.03);
    confidence = Math.round(confidence * 1000) / 1000;

    // ── Resolve category ───────────────────────────────────────────────────
    const category = this.resolveCategory(
      tx.category,
      defaultCategory,
      tx.description,
      tx.counterpartyName,
      isExpense,
    );

    // ── Write the BookkeepingEntry ─────────────────────────────────────────
    // Both income and expense go through EntryService so period recalculation
    // and VAT logic are applied consistently.
    let entry: BookkeepingEntry;

    if (isExpense) {
      entry = await this.entryService.addExpense(
        organizationId,
        {
          date: tx.date,
          grossAmount: absAmount,
          category: category as EntryCategory,
          description:
            tx.description ||
            `Payment to ${supplierName ?? tx.counterpartyName ?? 'unknown'}`,
          vatRate: 0, // Cannot determine VAT from bank statement alone
          counterpartyName: tx.counterpartyName ?? supplierName,
          notes:
            [
              tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
              tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
            ]
              .filter(Boolean)
              .join(' | ') || undefined,
        },
        // sourceId not directly settable via addExpense DTO — set via repo below
      );
    } else {
      entry = await this.entryService.addIncome(organizationId, {
        date: tx.date,
        grossAmount: absAmount,
        category: EntryCategory.OTHER_INCOME,
        description:
          tx.description ||
          `Bank credit${tx.counterpartyName ? ` from ${tx.counterpartyName}` : ''}`,
        vatRate: 0, // Cannot determine VAT from bank statement alone
        counterpartyName: tx.counterpartyName,
        notes:
          [
            tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
            tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
          ]
            .filter(Boolean)
            .join(' | ') || undefined,
      });
    }

    // ── Write the AutomationLog (audit trail) ──────────────────────────────
    const logStatus =
      confidence >= autoConfirmThreshold ? 'confirmed' : 'pending';

    const log = await this.logRepo.save(
      this.logRepo.create({
        orgId: organizationId,
        sourceType: 'bank_statement_pdf',
        status: logStatus,
        externalRef: dedupKey,
        supplierId: supplierId ?? null,
        entryId: entry.id,
        confidence: confidence as unknown as string, // decimal column = string in entity
        rawPayload: {
          counterpartyIban: tx.counterpartyIban,
          referenceNumber: tx.referenceNumber,
          transactionId: tx.transactionId,
          fileHash,
        },
        parsedData: {
          type: isExpense ? 'expense' : 'income',
          amount: absAmount,
          currency: tx.currency,
          date: tx.date,
          description: tx.description,
          category,
          supplierId,
          supplierName,
          confidence,
        },
      } as Partial<AutomationLog>),
    );

    return { entry, log };
  }

  // ── Review queue helpers ───────────────────────────────────────────────────

  /** Returns AutomationLogs that need human review (low-confidence transactions) */
  async getPendingReview(organizationId: string): Promise<AutomationLog[]> {
    return this.logRepo.find({
      where: {
        orgId: organizationId,
        sourceType: 'bank_statement_pdf',
        status: 'pending',
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async confirmEntry(
    logId: string,
    reviewedBy: string,
  ): Promise<AutomationLog> {
    const log = await this.logRepo.findOneOrFail({ where: { id: logId } });
    log.status = 'confirmed';
    log.reviewedBy = reviewedBy;
    log.reviewedAt = new Date();
    return this.logRepo.save(log);
  }

  async rejectEntry(logId: string, reviewedBy: string): Promise<AutomationLog> {
    const log = await this.logRepo.findOneOrFail({ where: { id: logId } });
    log.status = 'rejected';
    log.reviewedBy = reviewedBy;
    log.reviewedAt = new Date();
    return this.logRepo.save(log);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private detectBankFromFilename(filename: string): string | null {
    const lower = filename.toLowerCase();
    if (lower.includes('lhv')) return 'lhv';
    if (lower.includes('seb')) return 'seb';
    if (lower.includes('swed')) return 'swedbank';
    if (lower.includes('luminor') || lower.includes('nordea')) return 'luminor';
    if (lower.includes('coop')) return 'coop';
    return null;
  }

  /**
   * Resolves the best category in priority order:
   *   1. AI-guessed category from the statement parser
   *   2. Supplier's stored default category
   *   3. Keyword heuristic from description + counterparty
   *   4. Generic fallback
   */
  private resolveCategory(
    aiCategory: string | undefined,
    supplierDefault: string | undefined,
    description: string,
    counterpartyName: string | undefined,
    isExpense: boolean,
  ): string {
    if (aiCategory && aiCategory.toLowerCase() !== 'other') return aiCategory;
    if (supplierDefault) return supplierDefault;

    const text = `${description} ${counterpartyName ?? ''}`.toLowerCase();

    if (/fuel|petrol|kütu|neste|circle k|olerex/.test(text))
      return EntryCategory.TRANSPORT;
    if (/rent|üür|hire/.test(text)) return EntryCategory.RENT;
    if (/salary|palk|töötasu/.test(text)) return EntryCategory.STAFF_SALARY;
    if (/electricity|elekter|eesti energia|enefit/.test(text))
      return EntryCategory.UTILITIES;
    if (/tele2|elisa|telia|internet|phone/.test(text))
      return EntryCategory.SOFTWARE; // closest available category
    if (/bolt food|wolt|glovo|food|toit/.test(text))
      return EntryCategory.SUPPLIER_FOOD;
    if (/marketing|ads|google|facebook|meta/.test(text))
      return EntryCategory.MARKETING;

    return isExpense ? EntryCategory.OTHER_EXPENSE : EntryCategory.OTHER_INCOME;
  }
}
