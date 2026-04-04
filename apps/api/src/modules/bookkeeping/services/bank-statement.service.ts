/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// apps/api/src/modules/bookkeeping/services/bank-statement.service.ts
//
// Parses uploaded PDF bank statements from Estonian banks and writes
// BookkeepingEntry records.
//
// Flow:
//   1. Upload received → file-level dedup check (sha256 hash)
//   2. BankStatementUpload history row created (status=processing)
//   3. PDF parsed: rules-based → AI fallback → chunked AI for large files
//   4. Each transaction:
//        a. Deduped against AutomationLog (same-file re-upload guard)
//        b. Deduped against BookkeepingEntry (catches manually-entered entries)
//        c. Category resolved: AI map → supplier default → keyword heuristic
//        d. Written as BookkeepingEntry (income or expense, vatRate always 0)
//        e. AutomationLog written for audit trail
//   5. BankStatementUpload row updated with final counts
//   6. Returns full BankStatementResult with summary

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AiService, BankStatementTransaction } from '../../ai/ai.service';
import { SupplierService } from './supplier.service';
import { EntryService } from './entry.service';
import { AutomationLog } from '../entities/automation-log.entity';
import { AutomationConfig } from '../entities/automation-config.entity';
import {
  EntryCategory,
  BookkeepingEntry,
  EntryType,
  EntryStatus,
} from '../entities/bookkeeping.entities';
import {
  BankStatementUpload,
  UploadStatus,
  ParseMethod,
} from '../entities/bank-statement-upload.entity';

// ── Result shape ──────────────────────────────────────────────────────────────

export interface BankStatementResult {
  uploadId: string;
  created: number;
  duplicate: number;
  errors: number;
  skippedZero: number;
  entries: BookkeepingEntry[];
  logs: AutomationLog[];
  summary: {
    bankName: string;
    iban: string;
    periodFrom: string;
    periodTo: string;
    totalIncome: number;
    totalExpense: number;
    parseMethod: ParseMethod;
    estimatedPages: number;
    chunkCount: number;
  };
}

// ── AI category → EntryCategory enum mapping ─────────────────────────────────
// AI returns plain strings ("Fuel", "Food", "Rent").
// Map them to valid EntryCategory values before TypeORM writes.

const AI_CATEGORY_MAP: Record<string, EntryCategory> = {
  fuel: EntryCategory.TRANSPORT,
  transport: EntryCategory.TRANSPORT,
  rent: EntryCategory.RENT,
  payroll: EntryCategory.STAFF_SALARY,
  salary: EntryCategory.STAFF_SALARY,
  taxes: EntryCategory.OTHER_EXPENSE,
  tax: EntryCategory.OTHER_EXPENSE,
  utilities: EntryCategory.UTILITIES,
  telecoms: EntryCategory.SOFTWARE,
  software: EntryCategory.SOFTWARE,
  food: EntryCategory.SUPPLIER_FOOD,
  marketing: EntryCategory.MARKETING,
  income: EntryCategory.OTHER_INCOME,
  other: EntryCategory.OTHER_EXPENSE,
};

function mapAiCategory(
  aiCategory: string | undefined,
): EntryCategory | undefined {
  if (!aiCategory) return undefined;
  const key = aiCategory.toLowerCase().trim();
  if (key === 'other') return undefined;
  return AI_CATEGORY_MAP[key];
}

// ── Keyword patterns ──────────────────────────────────────────────────────────
// Regex patterns for common Estonian merchants and categories.
// Applied after AI category and supplier default — catches groceries etc.
// that the AI often misses or labels generically as "Other".

const GROCERY_RE =
  /rimi|maxima|prisma|selver|lidl|aldi|ica\b|spar\b|konsum|coop\b|säästumarket|ühistu/i;

const TRANSPORT_RE =
  /neste|circle\s?k|olerex|alexela|kütu|petrol|parkla|parking|bolt\s?drive|taxify|uber\b|citybee|elmo\s?rent/i;

const UTILITIES_RE =
  /elekter|eesti\s?energia|enefit|gaas\b|elering|adven|utilit|vesi\b|soojus/i;

const TELECOMS_RE =
  /tele2|elisa\b|telia\b|starman|digiTV|tet\b|internet|telefon/i;

const RENT_RE = /üür|rent\b|hire\b|lease|rental|rendile/i;

const SALARY_RE = /palk|töötasu|salary|palga|stipend/i;

const MARKETING_RE =
  /google\s?ads|facebook\s?ads|meta\s?ads|linkedin\s?ads|instagram\s?ads/i;

const SOFTWARE_RE =
  /slack\b|notion\b|github\b|figma\b|vercel\b|\baws\b|azure\b|google\s?cloud|stripe\b|shopify\b|jira\b/i;

// ── Chunking constants ────────────────────────────────────────────────────────
// For the AI fallback path on large files (6-7 pages), we split the extracted
// text into chunks so each Claude call sees ~1-2 pages worth of data.
// The rule-based parser always reads the full text — no chunking needed there.

const CHARS_PER_CHUNK = 3500; // ~1-2 statement pages

function estimatePages(textLength: number): number {
  // Typical bank statement page produces ~1800-2500 chars of extracted text
  return Math.max(1, Math.round(textLength / 2000));
}

function chunkText(text: string): string[] {
  if (text.length <= CHARS_PER_CHUNK) return [text];
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';
  for (const line of lines) {
    if (
      current.length + line.length + 1 > CHARS_PER_CHUNK &&
      current.length > 0
    ) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    private readonly ai: AiService,
    private readonly supplierService: SupplierService,
    private readonly entryService: EntryService,
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
    @InjectRepository(BookkeepingEntry)
    private readonly entryRepo: Repository<BookkeepingEntry>,
    @InjectRepository(BankStatementUpload)
    private readonly uploadRepo: Repository<BankStatementUpload>,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  async processUpload(
    organizationId: string,
    pdfBase64: string,
    filename: string,
  ): Promise<BankStatementResult> {
    const fileHash = crypto
      .createHash('sha256')
      .update(pdfBase64)
      .digest('hex');
    const fileSizeBytes = Math.round((pdfBase64.length * 3) / 4);

    // ── 1. File-level dedup ───────────────────────────────────────────────
    const existingUpload = await this.uploadRepo.findOne({
      where: { orgId: organizationId, fileHash },
    });
    if (existingUpload) {
      this.logger.log(`[BankStatement] Duplicate file upload: ${fileHash}`);
      const dupRecord = await this.uploadRepo.save(
        this.uploadRepo.create({
          orgId: organizationId,
          fileHash,
          filename,
          fileSizeBytes,
          status: 'duplicate_file' as UploadStatus,
          duplicateOfId: existingUpload.id,
          parseMethod: null,
        }),
      );
      return this.duplicateFileResult(dupRecord.id, existingUpload);
    }

    // ── 2. Create history row ─────────────────────────────────────────────
    const uploadRecord = await this.uploadRepo.save(
      this.uploadRepo.create({
        orgId: organizationId,
        fileHash,
        filename,
        fileSizeBytes,
        status: 'processing' as UploadStatus,
        parseMethod: null,
      }),
    );

    // ── 3. Config ─────────────────────────────────────────────────────────
    const cfg = await this.configRepo.findOne({
      where: { orgId: organizationId },
    });
    const autoConfirmThreshold = parseFloat(
      cfg?.autoConfirmConfidence ?? '0.90',
    );
    const bankHint = this.detectBankFromFilename(filename);

    // ── 4. Parse ──────────────────────────────────────────────────────────
    let statement: Awaited<
      ReturnType<typeof this.ai.parseBankStatementPdf>
    > | null = null;
    let parseMethod: ParseMethod = 'unknown';
    let chunkCount = 1;
    let estimatedPages = 1;
    let errorMessage: string | null = null;

    try {
      // Extract raw text to measure size (bankParser is injected into AiService)
      const rawText = (await (this.ai as any).bankParser
        ?.extractText?.(pdfBase64)
        .catch(() => null)) as string | null;

      if (rawText) {
        estimatedPages = estimatePages(rawText.length);
        this.logger.log(
          `[BankStatement] ${filename}: ${rawText.length} chars, ~${estimatedPages} pages`,
        );
      }

      // Primary parse attempt (rules → AI fallback internally)
      statement = await this.ai.parseBankStatementPdf(
        pdfBase64,
        bankHint ?? undefined,
        filename,
      );

      if (statement?.transactions?.length) {
        parseMethod =
          (statement.confidence ?? 0) >= 0.94 ? 'rules' : 'ai_fallback';
      } else if (rawText && rawText.length > CHARS_PER_CHUNK * 1.5) {
        // ── Chunked AI for large files ─────────────────────────────────
        this.logger.log(`[BankStatement] Large file — chunked AI parse`);
        const chunks = chunkText(rawText);
        chunkCount = chunks.length;
        parseMethod = 'chunked_ai';

        const allTransactions: BankStatementTransaction[] = [];
        let baseInfo = {
          bankName: '',
          accountHolder: '',
          iban: '',
          periodFrom: '',
          periodTo: '',
          currency: 'EUR',
          openingBalance: 0,
          closingBalance: 0,
          confidence: 0,
        };

        for (let i = 0; i < chunks.length; i++) {
          this.logger.log(`[BankStatement] Chunk ${i + 1}/${chunkCount}`);
          try {
            const chunkB64 = Buffer.from(chunks[i]).toString('base64');
            const chunkResult = await this.ai.parseBankStatementPdf(
              chunkB64,
              bankHint ?? undefined,
              filename,
            );
            if (chunkResult?.transactions?.length) {
              allTransactions.push(...chunkResult.transactions);
              if (!baseInfo.bankName && chunkResult.bankName) {
                baseInfo = { ...baseInfo, ...chunkResult };
              }
            }
          } catch (e) {
            this.logger.warn(`[BankStatement] Chunk ${i + 1} failed: ${e}`);
          }
        }

        if (allTransactions.length > 0) {
          statement = { ...baseInfo, transactions: allTransactions };
        }
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`[BankStatement] Parse error: ${errorMessage}`);
    }

    // ── 5. Handle total parse failure ─────────────────────────────────────
    if (!statement?.transactions?.length) {
      await this.uploadRepo.save(
        Object.assign(uploadRecord, {
          status: 'failed' as UploadStatus,
          estimatedPages,
          errorMessage: errorMessage ?? 'No transactions extracted',
          parseMethod,
          chunkCount,
        }),
      );
      return {
        uploadId: uploadRecord.id,
        created: 0,
        duplicate: 0,
        errors: 1,
        skippedZero: 0,
        entries: [],
        logs: [],
        summary: {
          bankName: '',
          iban: '',
          periodFrom: '',
          periodTo: '',
          totalIncome: 0,
          totalExpense: 0,
          parseMethod,
          estimatedPages,
          chunkCount,
        },
      };
    }

    this.logger.log(
      `[BankStatement] ${filename}: bank=${statement.bankName} ` +
        `tx=${statement.transactions.length} method=${parseMethod} chunks=${chunkCount}`,
    );

    // ── 6. Process transactions ───────────────────────────────────────────
    const entries: BookkeepingEntry[] = [];
    const logs: AutomationLog[] = [];
    let duplicates = 0,
      errors = 0,
      skippedZero = 0;
    let totalIncome = 0,
      totalExpense = 0;

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
        } else if (result === 'zero') {
          skippedZero++;
        } else {
          entries.push(result.entry);
          logs.push(result.log);
          if (tx.type === 'income') totalIncome += Math.abs(tx.amount);
          else totalExpense += Math.abs(tx.amount);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[BankStatement] TX error: ${msg}`, { tx });
        errors++;
      }
    }

    // ── 7. Finalise history row ───────────────────────────────────────────
    await this.uploadRepo.save(
      Object.assign(uploadRecord, {
        bankName: statement.bankName,
        accountIban: statement.iban,
        accountHolder: (statement as any).accountHolder ?? null,
        periodFrom: statement.periodFrom,
        periodTo: statement.periodTo,
        estimatedPages,
        status: (errors > 0 && entries.length === 0
          ? 'failed'
          : 'completed') as UploadStatus,
        parseMethod,
        chunkCount,
        txTotal: statement.transactions.length,
        txCreated: entries.length,
        txDuplicate: duplicates,
        txErrors: errors,
        txIncome: statement.transactions.filter((t) => t.type === 'income')
          .length,
        txExpense: statement.transactions.filter((t) => t.type === 'expense')
          .length,
        totalIncomeAmount: totalIncome.toFixed(2),
        totalExpenseAmount: totalExpense.toFixed(2),
        confidence: statement.confidence?.toFixed(3) ?? null,
      }),
    );

    this.logger.log(
      `[BankStatement] Done: created=${entries.length} ` +
        `duplicate=${duplicates} errors=${errors} zero=${skippedZero}`,
    );

    return {
      uploadId: uploadRecord.id,
      created: entries.length,
      duplicate: duplicates,
      errors,
      skippedZero,
      entries,
      logs,
      summary: {
        bankName: statement.bankName,
        iban: statement.iban,
        periodFrom: statement.periodFrom,
        periodTo: statement.periodTo,
        totalIncome,
        totalExpense,
        parseMethod,
        estimatedPages,
        chunkCount,
      },
    };
  }

  // ── Per-transaction processing ────────────────────────────────────────────

  private async processTransaction(
    organizationId: string,
    tx: BankStatementTransaction,
    statementConfidence: number,
    autoConfirmThreshold: number,
    fileHash: string,
  ): Promise<
    'duplicate' | 'zero' | { entry: BookkeepingEntry; log: AutomationLog }
  > {
    // Skip zero-amount transactions (bank fees waived, internal bookings, etc.)
    if (tx.amount === 0) return 'zero';

    const isExpense =
      (tx.type ?? (tx.amount < 0 ? 'expense' : 'income')) === 'expense';
    const absAmount = Math.abs(tx.amount);

    // ── Dedup 1: AutomationLog — same-file re-upload ───────────────────────
    // Bank's own transaction ID is the most reliable dedup key.
    // Fallback composite key covers banks that don't provide transaction IDs.
    const dedupKey = tx.transactionId
      ? `tx:${tx.transactionId}`
      : `pdf:${fileHash}:${tx.date}:${tx.amount}:${tx.description.slice(0, 40)}`;

    const existingLog = await this.logRepo.findOne({
      where: { orgId: organizationId, externalRef: dedupKey },
    });
    if (existingLog) return 'duplicate';

    // ── Dedup 2: BookkeepingEntry — catches manually-entered entries ────────
    // A human entered "Rimi, 15.03.2026, €23.40" before uploading the statement.
    // We match on: date + absAmount + normalised counterparty/description.
    // This prevents double-counting without preventing legitimate same-day
    // same-amount transactions to different parties.
    const manualDup = await this.findManualDuplicate(
      organizationId,
      tx.date,
      absAmount,
      isExpense,
      tx.counterpartyName ?? tx.description,
    );

    if (manualDup) {
      this.logger.debug(
        `[BankStatement] Manual duplicate: ${tx.date} €${absAmount} ` +
          `"${tx.counterpartyName ?? tx.description}" → entry ${manualDup.id}`,
      );
      // Record in AutomationLog for audit — link to the existing entry
      await this.logRepo.save(
        this.logRepo.create({
          orgId: organizationId,
          sourceType: 'bank_statement_pdf',
          status: 'confirmed',
          externalRef: dedupKey,
          entryId: manualDup.id,
          confidence: '1.000',
          rawPayload: { fileHash, manualDuplicateOf: manualDup.id },
          parsedData: {
            type: isExpense ? 'expense' : 'income',
            amount: absAmount,
            currency: tx.currency,
            date: tx.date,
            description: tx.description,
            skippedReason: 'manual_duplicate',
          },
        } as unknown as Partial<AutomationLog>),
      );
      return 'duplicate';
    }

    // ── Supplier matching (expenses only) ──────────────────────────────────
    let supplierId: string | undefined;
    let supplierName: string | undefined;
    let defaultCategory: string | undefined;

    if (isExpense && (tx.counterpartyName || tx.counterpartyIban)) {
      try {
        const { supplier } = await this.supplierService.findOrCreate(
          organizationId,
          { name: tx.counterpartyName ?? 'Unknown', iban: tx.counterpartyIban },
          'bank_statement_pdf',
        );
        supplierId = supplier.id;
        supplierName = supplier.name;
        defaultCategory = supplier.defaultCategory ?? undefined;
      } catch {
        // Non-fatal — proceed without supplier link
      }
    }

    // ── Confidence ─────────────────────────────────────────────────────────
    let confidence = statementConfidence;
    if (tx.transactionId) confidence = Math.min(1, confidence + 0.05);
    if (tx.counterpartyName) confidence = Math.min(1, confidence + 0.05);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tx.date))
      confidence = Math.min(1, confidence + 0.03);
    confidence = Math.round(confidence * 1000) / 1000;

    // ── Category ───────────────────────────────────────────────────────────
    const category = isExpense
      ? this.resolveExpenseCategory(
          tx.category,
          defaultCategory,
          tx.description,
          tx.counterpartyName,
        )
      : this.resolveIncomeCategory(
          tx.category,
          tx.description,
          tx.counterpartyName,
        );

    // ── Notes ──────────────────────────────────────────────────────────────
    const notes =
      [
        tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
        tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
        tx.transactionId ? `TxID: ${tx.transactionId}` : '',
      ]
        .filter(Boolean)
        .join(' | ') || undefined;

    // ── Write BookkeepingEntry ─────────────────────────────────────────────
    let entry: BookkeepingEntry;

    if (isExpense) {
      entry = await this.entryService.addExpense(organizationId, {
        date: tx.date,
        grossAmount: absAmount,
        category: category as EntryCategory,
        description:
          tx.description ||
          `Payment to ${supplierName ?? tx.counterpartyName ?? 'unknown'}`,
        vatRate: 0, // VAT cannot be determined from a bank statement line
        counterpartyName: tx.counterpartyName ?? supplierName,
        notes,
      });
    } else {
      entry = await this.entryService.addIncome(organizationId, {
        date: tx.date,
        grossAmount: absAmount,
        category: category as EntryCategory,
        description:
          tx.description ||
          `Bank credit${tx.counterpartyName ? ` from ${tx.counterpartyName}` : ''}`,
        vatRate: 0, // Never assume VAT from a bank statement
        excludeFromVat: true, // Accountant can override if VAT applies
        counterpartyName: tx.counterpartyName,
        notes,
      });
    }

    // ── Write AutomationLog ────────────────────────────────────────────────
    const log = await this.logRepo.save(
      this.logRepo.create({
        orgId: organizationId,
        sourceType: 'bank_statement_pdf',
        status: confidence >= autoConfirmThreshold ? 'confirmed' : 'pending',
        externalRef: dedupKey,
        supplierId: supplierId ?? null,
        entryId: entry.id,
        confidence: confidence as unknown as string,
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

  // ── Manual duplicate detection ────────────────────────────────────────────
  //
  // Checks BookkeepingEntry for an existing record that was entered manually
  // (or via receipt scan) that matches this bank transaction.
  //
  // Match criteria:
  //   ✓ Same org
  //   ✓ Same date
  //   ✓ Same absolute amount (±€0.01 for float safety)
  //   ✓ Same entry type (both income or both expense)
  //   ✓ Counterparty name or description overlaps (normalised, 20-char prefix)
  //
  // We use a 20-char prefix match because bank statements often truncate names:
  // "Rimi Eesti Food OÜ Tallinn" → stored as "Rimi Eesti Food OÜ" in the receipt.

  private async findManualDuplicate(
    orgId: string,
    date: string,
    absAmount: number,
    isExpense: boolean,
    counterpartyHint: string,
  ): Promise<BookkeepingEntry | null> {
    if (!counterpartyHint?.trim()) return null;

    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

    const hintNorm = norm(counterpartyHint).slice(0, 30);

    const candidates = await this.entryRepo.find({
      where: {
        orgId,
        date: date as unknown as string,
        entryType: isExpense ? EntryType.EXPENSE : EntryType.INCOME,
        status: EntryStatus.CONFIRMED,
      },
    });

    for (const c of candidates) {
      // Amount must match within 1 cent
      if (Math.abs(Math.abs(Number(c.grossAmount)) - absAmount) > 0.01)
        continue;

      const cName = norm(c.counterpartyName ?? '').slice(0, 30);
      const cDesc = norm(c.description ?? '').slice(0, 30);

      // At least one of the stored strings must contain the first 20 chars of the hint
      const prefix = hintNorm.slice(0, 20);
      if (prefix && (cName.includes(prefix) || cDesc.includes(prefix))) {
        return c;
      }
      // Or the hint contains the stored counterparty (bank truncation the other way)
      if (cName.length >= 10 && hintNorm.includes(cName.slice(0, 15))) {
        return c;
      }
    }

    return null;
  }

  // ── Category resolvers ────────────────────────────────────────────────────

  private resolveExpenseCategory(
    aiCategory: string | undefined,
    supplierDefault: string | undefined,
    description: string,
    counterpartyName: string | undefined,
  ): EntryCategory {
    // 1. AI category mapped to valid enum value
    const mapped = mapAiCategory(aiCategory);
    if (mapped && mapped !== EntryCategory.OTHER_EXPENSE) return mapped;

    // 2. Supplier's stored default (validated)
    if (supplierDefault) {
      const valid = Object.values(EntryCategory) as string[];
      if (valid.includes(supplierDefault))
        return supplierDefault as EntryCategory;
    }

    // 3. Keyword heuristics — Estonian merchants and common patterns
    const text = `${description} ${counterpartyName ?? ''}`;

    if (GROCERY_RE.test(text)) return EntryCategory.SUPPLIER_FOOD;
    if (TRANSPORT_RE.test(text)) return EntryCategory.TRANSPORT;
    if (UTILITIES_RE.test(text)) return EntryCategory.UTILITIES;
    if (TELECOMS_RE.test(text)) return EntryCategory.SOFTWARE;
    if (RENT_RE.test(text)) return EntryCategory.RENT;
    if (SALARY_RE.test(text)) return EntryCategory.STAFF_SALARY;
    if (MARKETING_RE.test(text)) return EntryCategory.MARKETING;
    if (SOFTWARE_RE.test(text)) return EntryCategory.SOFTWARE;

    return EntryCategory.OTHER_EXPENSE;
  }

  private resolveIncomeCategory(
    aiCategory: string | undefined,
    description: string,
    counterpartyName: string | undefined,
  ): EntryCategory {
    const text = `${description} ${counterpartyName ?? ''}`;

    if (/wolt|bolt\s?food|glovo|uber\s?eats/i.test(text))
      return EntryCategory.SALES_THIRD_PARTY;
    if (
      /sumup|zettle|izettle|payterm|makseterminal|terminal\s?settlement/i.test(
        text,
      )
    )
      return EntryCategory.SALES_CARD;
    if (aiCategory?.toLowerCase() === 'income')
      return EntryCategory.OTHER_INCOME;

    return EntryCategory.OTHER_INCOME;
  }

  // ── History queries ───────────────────────────────────────────────────────

  async getUploadHistory(
    organizationId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: BankStatementUpload[]; total: number }> {
    const [items, total] = await this.uploadRepo.findAndCount({
      where: { orgId: organizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  async getUploadById(
    organizationId: string,
    uploadId: string,
  ): Promise<BankStatementUpload | null> {
    return this.uploadRepo.findOne({
      where: { orgId: organizationId, id: uploadId },
    });
  }

  // ── Review queue ──────────────────────────────────────────────────────────

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

  // ── Private helpers ───────────────────────────────────────────────────────

  private detectBankFromFilename(filename: string): string | null {
    const lower = filename.toLowerCase();
    if (lower.includes('lhv')) return 'lhv';
    if (lower.includes('seb')) return 'seb';
    if (lower.includes('swed')) return 'swedbank';
    if (lower.includes('luminor') || lower.includes('nordea')) return 'luminor';
    if (lower.includes('coop')) return 'coop';
    return null;
  }

  private duplicateFileResult(
    uploadId: string,
    original: BankStatementUpload,
  ): BankStatementResult {
    return {
      uploadId,
      created: 0,
      duplicate: 1,
      errors: 0,
      skippedZero: 0,
      entries: [],
      logs: [],
      summary: {
        bankName: original.bankName ?? '',
        iban: original.accountIban ?? '',
        periodFrom: original.periodFrom ?? '',
        periodTo: original.periodTo ?? '',
        totalIncome: 0,
        totalExpense: 0,
        parseMethod: original.parseMethod ?? 'unknown',
        estimatedPages: original.estimatedPages ?? 0,
        chunkCount: 1,
      },
    };
  }
}
// this file is a bit rough around the edges and has some FIX comments,
// but it's a critical piece of functionality so I'm leaving it in for
// now to avoid accidentally breaking it while refactoring. It will be cleaned
// up in a future PR.
/* eslint-disable @typescript-eslint/no-unused-vars */
// /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// // apps/api/src/modules/bookkeeping/services/bank-statement.service.ts
// //
// // Parses uploaded PDF bank statements from Estonian banks and writes
// // BookkeepingEntry records directly.
// //
// // Flow:
// //   1. User uploads PDF → base64 passed here
// //   2. AiService.parseBankStatementPdf() extracts all transactions
// //   3. Each transaction is deduped, supplier-matched, and written as a
// //      confirmed BookkeepingEntry (income or expense) via EntryService
// //   4. An AutomationLog is created per transaction for the audit trail
// //   5. Returns { created, duplicate, errors } counts

// import { Injectable, Logger } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import * as crypto from 'crypto';
// import { AiService, BankStatementTransaction } from '../../ai/ai.service';
// import { SupplierService } from './supplier.service';
// import { EntryService } from './entry.service';
// import { AutomationLog } from '../entities/automation-log.entity';
// import { AutomationConfig } from '../entities/automation-config.entity';
// import { EntryCategory } from '../entities/bookkeeping.entities';
// import { BookkeepingEntry } from '../entities/bookkeeping.entities';

// // ── Result shape ──────────────────────────────────────────────────────────────

// export interface BankStatementResult {
//   created: number;
//   duplicate: number;
//   errors: number;
//   entries: BookkeepingEntry[];
//   logs: AutomationLog[];
// }

// // ── AI category → EntryCategory mapping ──────────────────────────────────────
// //
// // The AI categoriser returns strings like "Fuel", "Rent", "Income", etc.
// // These must be mapped to actual EntryCategory enum values before hitting the DB.
// // An unmapped or invalid value falls through to the generic fallbacks below.

// const AI_CATEGORY_MAP: Record<string, EntryCategory> = {
//   fuel: EntryCategory.TRANSPORT,
//   transport: EntryCategory.TRANSPORT,
//   rent: EntryCategory.RENT,
//   payroll: EntryCategory.STAFF_SALARY,
//   salary: EntryCategory.STAFF_SALARY,
//   taxes: EntryCategory.OTHER_EXPENSE,
//   tax: EntryCategory.OTHER_EXPENSE,
//   utilities: EntryCategory.UTILITIES,
//   telecoms: EntryCategory.SOFTWARE, // closest available
//   software: EntryCategory.SOFTWARE,
//   food: EntryCategory.SUPPLIER_FOOD,
//   marketing: EntryCategory.MARKETING,
//   income: EntryCategory.OTHER_INCOME,
//   other: EntryCategory.OTHER_EXPENSE,
// };

// function mapAiCategory(
//   aiCategory: string | undefined,
//   isExpense: boolean,
// ): EntryCategory | undefined {
//   if (!aiCategory) return undefined;
//   const key = aiCategory.toLowerCase().trim();
//   if (key === 'other') return undefined; // let caller pick the fallback
//   return AI_CATEGORY_MAP[key]; // undefined if not in map
// }

// // ── Service ───────────────────────────────────────────────────────────────────

// @Injectable()
// export class BankStatementService {
//   private readonly logger = new Logger(BankStatementService.name);

//   constructor(
//     private readonly ai: AiService,
//     private readonly supplierService: SupplierService,
//     private readonly entryService: EntryService,
//     @InjectRepository(AutomationLog)
//     private readonly logRepo: Repository<AutomationLog>,
//     @InjectRepository(AutomationConfig)
//     private readonly configRepo: Repository<AutomationConfig>,
//   ) {}

//   // ── Public entry point ────────────────────────────────────────────────────

//   /**
//    * Process an uploaded bank statement PDF for any date range.
//    * The statement can cover a mid-month slice, full month, or even multiple
//    * months — each transaction is bucketed into the correct tax period by its
//    * own date, so partial uploads are safe and idempotent.
//    */
//   async processUpload(
//     organizationId: string,
//     pdfBase64: string,
//     filename: string,
//   ): Promise<BankStatementResult> {
//     // ── 1. Whole-file dedup ───────────────────────────────────────────────
//     const fileHash = crypto
//       .createHash('sha256')
//       .update(pdfBase64)
//       .digest('hex');

//     const alreadyProcessed = await this.logRepo.findOne({
//       where: { orgId: organizationId, externalRef: `pdf_file:${fileHash}` },
//     });
//     if (alreadyProcessed) {
//       this.logger.log(`[BankStatement] Duplicate file upload: ${fileHash}`);
//       return { created: 0, duplicate: 1, errors: 0, entries: [], logs: [] };
//     }

//     // ── 2. Load org automation config ─────────────────────────────────────
//     const cfg = await this.configRepo.findOne({
//       where: { orgId: organizationId },
//     });

//     // ── 3. Detect bank from filename for a better AI hint ─────────────────
//     const bankHint = this.detectBankFromFilename(filename);

//     // ── 4. Parse the PDF via AiService ────────────────────────────────────
//     // FIX (minor): pass filename as third arg so the rule-based parser's own
//     // detectBank() can also benefit from it — previously it only saw the text.
//     const statement = await this.ai.parseBankStatementPdf(
//       pdfBase64,
//       bankHint ?? undefined,
//       filename, // ← was missing; rule-based parser uses this for bank detection
//     );

//     if (!statement || statement.transactions.length === 0) {
//       this.logger.warn(
//         `[BankStatement] No transactions extracted from ${filename}`,
//       );
//       return { created: 0, duplicate: 0, errors: 1, entries: [], logs: [] };
//     }

//     this.logger.log(
//       `[BankStatement] org=${organizationId} file=${filename} ` +
//         `bank=${statement.bankName} txCount=${statement.transactions.length} ` +
//         `income=${statement.transactions.filter((t) => t.type === 'income').length} ` +
//         `expense=${statement.transactions.filter((t) => t.type === 'expense').length}`,
//     );

//     // ── 5. Process each transaction ───────────────────────────────────────
//     const autoConfirmThreshold = parseFloat(
//       cfg?.autoConfirmConfidence ?? '0.90',
//     );

//     const entries: BookkeepingEntry[] = [];
//     const logs: AutomationLog[] = [];
//     let duplicates = 0;
//     let errors = 0;

//     for (const tx of statement.transactions) {
//       try {
//         const result = await this.processTransaction(
//           organizationId,
//           tx,
//           statement.confidence,
//           autoConfirmThreshold,
//           fileHash,
//         );

//         if (result === 'duplicate') {
//           duplicates++;
//         } else {
//           entries.push(result.entry);
//           logs.push(result.log);
//         }
//       } catch (err: unknown) {
//         const msg = err instanceof Error ? err.message : String(err);
//         this.logger.error(`[BankStatement] TX error: ${msg}`, { tx });
//         errors++;
//       }
//     }

//     // ── 6. Mark the whole file as processed (sentinel log) ────────────────
//     await this.logRepo.save(
//       this.logRepo.create({
//         orgId: organizationId,
//         sourceType: 'bank_statement_pdf',
//         status: 'confirmed',
//         externalRef: `pdf_file:${fileHash}`,
//         rawPayload: {
//           filename,
//           bankName: statement.bankName,
//           iban: statement.iban,
//           periodFrom: statement.periodFrom,
//           periodTo: statement.periodTo,
//           txCount: statement.transactions.length,
//         },
//         parsedData: null,
//       } as Partial<AutomationLog>),
//     );

//     this.logger.log(
//       `[BankStatement] Done org=${organizationId}: ` +
//         `created=${entries.length} duplicate=${duplicates} errors=${errors}`,
//     );

//     return {
//       created: entries.length,
//       duplicate: duplicates,
//       errors,
//       entries,
//       logs,
//     };
//   }

//   // ── Per-transaction processing ────────────────────────────────────────────

//   private async processTransaction(
//     organizationId: string,
//     // FIX: use the properly typed BankStatementTransaction (includes `type` and `valueDate`)
//     tx: BankStatementTransaction,
//     statementConfidence: number,
//     autoConfirmThreshold: number,
//     fileHash: string,
//   ): Promise<'duplicate' | { entry: BookkeepingEntry; log: AutomationLog }> {
//     // ── Dedup key ──────────────────────────────────────────────────────────
//     const dedupKey = tx.transactionId
//       ? `tx:${tx.transactionId}`
//       : `pdf:${fileHash}:${tx.date}:${tx.amount}:${tx.description.slice(0, 40)}`;

//     const existing = await this.logRepo.findOne({
//       where: { orgId: organizationId, externalRef: dedupKey },
//     });
//     if (existing) return 'duplicate';

//     // ── Direction ──────────────────────────────────────────────────────────
//     // Use the `type` field set by the parser/AI — avoids re-deriving from amount.
//     // Guard: if for any reason type is missing, fall back to amount sign.
//     const isExpense =
//       (tx.type ?? (tx.amount < 0 ? 'expense' : 'income')) === 'expense';
//     const absAmount = Math.abs(tx.amount);

//     // Sanity check: if amount is 0 skip — nothing to record
//     if (absAmount === 0) {
//       this.logger.debug(
//         `[BankStatement] Skipping zero-amount tx: ${tx.description}`,
//       );
//       return 'duplicate'; // treat as duplicate to avoid inflating error count
//     }

//     // ── Supplier matching (expenses only) ──────────────────────────────────
//     let supplierId: string | undefined;
//     let supplierName: string | undefined;
//     let defaultCategory: string | undefined;

//     if (isExpense && (tx.counterpartyName || tx.counterpartyIban)) {
//       const { supplier } = await this.supplierService.findOrCreate(
//         organizationId,
//         {
//           name: tx.counterpartyName ?? 'Unknown',
//           iban: tx.counterpartyIban,
//         },
//         'bank_statement_pdf',
//       );
//       supplierId = supplier.id;
//       supplierName = supplier.name;
//       defaultCategory = supplier.defaultCategory ?? undefined;
//     }

//     // ── Confidence score ───────────────────────────────────────────────────
//     let confidence = statementConfidence;
//     if (tx.transactionId) confidence = Math.min(1, confidence + 0.05);
//     if (tx.counterpartyName) confidence = Math.min(1, confidence + 0.05);
//     if (/^\d{4}-\d{2}-\d{2}$/.test(tx.date))
//       confidence = Math.min(1, confidence + 0.03);
//     confidence = Math.round(confidence * 1000) / 1000;

//     // ── Resolve category ───────────────────────────────────────────────────
//     const category = this.resolveCategory(
//       tx.category,
//       defaultCategory,
//       tx.description,
//       tx.counterpartyName,
//       isExpense,
//     );

//     // ── Write the BookkeepingEntry ─────────────────────────────────────────
//     let entry: BookkeepingEntry;

//     if (isExpense) {
//       entry = await this.entryService.addExpense(organizationId, {
//         date: tx.date,
//         grossAmount: absAmount,
//         category: category as EntryCategory,
//         description:
//           tx.description ||
//           `Payment to ${supplierName ?? tx.counterpartyName ?? 'unknown'}`,
//         // vatRate: 0 is already the default in addExpense (dto.vatRate ?? 0) ✓
//         vatRate: 0,
//         counterpartyName: tx.counterpartyName ?? supplierName,
//         notes:
//           [
//             tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
//             tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
//           ]
//             .filter(Boolean)
//             .join(' | ') || undefined,
//       });
//     } else {
//       // FIX #1 (CRITICAL): vatRate MUST be 0 for bank statement income.
//       // Without this, addIncome falls back to profile.defaultVatRate (e.g. 22%)
//       // and incorrectly splits €1000 client payment into €819.67 net + €180.33 VAT.
//       // We cannot know the VAT split from a bank statement line alone.
//       entry = await this.entryService.addIncome(organizationId, {
//         date: tx.date,
//         grossAmount: absAmount,
//         // FIX: use mapped AI income category if available, not always OTHER_INCOME
//         category: isExpense
//           ? (category as EntryCategory)
//           : this.resolveIncomeCategory(
//               tx.category,
//               tx.description,
//               tx.counterpartyName,
//             ),
//         description:
//           tx.description ||
//           `Bank credit${tx.counterpartyName ? ` from ${tx.counterpartyName}` : ''}`,
//         vatRate: 0, // ← THE FIX: never assume VAT from a bank statement
//         excludeFromVat: true, // belt-and-braces: marks it as outside-VAT-scope
//         counterpartyName: tx.counterpartyName,
//         notes:
//           [
//             tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : '',
//             tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : '',
//           ]
//             .filter(Boolean)
//             .join(' | ') || undefined,
//       });
//     }

//     // ── Write the AutomationLog (audit trail) ──────────────────────────────
//     const logStatus =
//       confidence >= autoConfirmThreshold ? 'confirmed' : 'pending';

//     const log = await this.logRepo.save(
//       this.logRepo.create({
//         orgId: organizationId,
//         sourceType: 'bank_statement_pdf',
//         status: logStatus,
//         externalRef: dedupKey,
//         supplierId: supplierId ?? null,
//         entryId: entry.id,
//         confidence: confidence as unknown as string,
//         rawPayload: {
//           counterpartyIban: tx.counterpartyIban,
//           referenceNumber: tx.referenceNumber,
//           transactionId: tx.transactionId,
//           fileHash,
//         },
//         parsedData: {
//           type: isExpense ? 'expense' : 'income',
//           amount: absAmount,
//           currency: tx.currency,
//           date: tx.date,
//           description: tx.description,
//           category,
//           supplierId,
//           supplierName,
//           confidence,
//         },
//       } as Partial<AutomationLog>),
//     );

//     return { entry, log };
//   }

//   // ── Review queue helpers ───────────────────────────────────────────────────

//   async getPendingReview(organizationId: string): Promise<AutomationLog[]> {
//     return this.logRepo.find({
//       where: {
//         orgId: organizationId,
//         sourceType: 'bank_statement_pdf',
//         status: 'pending',
//       },
//       order: { createdAt: 'DESC' },
//       take: 100,
//     });
//   }

//   async confirmEntry(
//     logId: string,
//     reviewedBy: string,
//   ): Promise<AutomationLog> {
//     const log = await this.logRepo.findOneOrFail({ where: { id: logId } });
//     log.status = 'confirmed';
//     log.reviewedBy = reviewedBy;
//     log.reviewedAt = new Date();
//     return this.logRepo.save(log);
//   }

//   async rejectEntry(logId: string, reviewedBy: string): Promise<AutomationLog> {
//     const log = await this.logRepo.findOneOrFail({ where: { id: logId } });
//     log.status = 'rejected';
//     log.reviewedBy = reviewedBy;
//     log.reviewedAt = new Date();
//     return this.logRepo.save(log);
//   }

//   // ── Helpers ───────────────────────────────────────────────────────────────

//   private detectBankFromFilename(filename: string): string | null {
//     const lower = filename.toLowerCase();
//     if (lower.includes('lhv')) return 'lhv';
//     if (lower.includes('seb')) return 'seb';
//     if (lower.includes('swed')) return 'swedbank';
//     if (lower.includes('luminor') || lower.includes('nordea')) return 'luminor';
//     if (lower.includes('coop')) return 'coop';
//     return null;
//   }

//   /**
//    * Resolves the best EntryCategory for EXPENSE transactions in priority order:
//    *   1. AI-guessed category → mapped to EntryCategory enum via AI_CATEGORY_MAP
//    *   2. Supplier's stored default category
//    *   3. Keyword heuristic from description + counterparty name
//    *   4. Generic fallback (OTHER_EXPENSE / OTHER_INCOME)
//    *
//    * FIX #2 (MEDIUM): Raw AI strings like "Fuel" are now mapped through
//    * AI_CATEGORY_MAP before being returned, so we never pass an invalid string
//    * to TypeORM where it expects an EntryCategory enum value.
//    */
//   private resolveCategory(
//     aiCategory: string | undefined,
//     supplierDefault: string | undefined,
//     description: string,
//     counterpartyName: string | undefined,
//     isExpense: boolean,
//   ): EntryCategory {
//     // Priority 1: AI category mapped to enum
//     const mappedAi = mapAiCategory(aiCategory, isExpense);
//     if (mappedAi) return mappedAi;

//     // Priority 2: supplier's stored default (already an EntryCategory string)
//     if (supplierDefault) {
//       // Validate it's actually a known EntryCategory value
//       const validCategories = Object.values(EntryCategory) as string[];
//       if (validCategories.includes(supplierDefault)) {
//         return supplierDefault as EntryCategory;
//       }
//     }

//     // Priority 3: keyword heuristic
//     const text = `${description} ${counterpartyName ?? ''}`.toLowerCase();

//     if (/fuel|petrol|kütu|neste|circle k|olerex/.test(text))
//       return EntryCategory.TRANSPORT;
//     if (/rent|üür|hire/.test(text)) return EntryCategory.RENT;
//     if (/salary|palk|töötasu/.test(text)) return EntryCategory.STAFF_SALARY;
//     if (/electricity|elekter|eesti energia|enefit/.test(text))
//       return EntryCategory.UTILITIES;
//     if (/tele2|elisa|telia|internet|phone/.test(text))
//       return EntryCategory.SOFTWARE;
//     if (/bolt food|wolt|glovo|food|toit/.test(text))
//       return EntryCategory.SUPPLIER_FOOD;
//     if (/marketing|ads|google|facebook|meta/.test(text))
//       return EntryCategory.MARKETING;

//     // Priority 4: generic fallback
//     return isExpense ? EntryCategory.OTHER_EXPENSE : EntryCategory.OTHER_INCOME;
//   }

//   /**
//    * Resolves the best EntryCategory for INCOME transactions.
//    * Income categories are a much smaller set — most bank credits for a
//    * business are client payments (OTHER_INCOME), but we detect a few
//    * common special cases.
//    */
//   private resolveIncomeCategory(
//     aiCategory: string | undefined,
//     description: string,
//     counterpartyName: string | undefined,
//   ): EntryCategory {
//     const text = `${description} ${counterpartyName ?? ''}`.toLowerCase();

//     // Wolt / Bolt Food / Glovo payouts = third-party sales
//     if (/wolt|bolt food|glovo/.test(text))
//       return EntryCategory.SALES_THIRD_PARTY;

//     // AI mapped to an income-relevant category
//     if (aiCategory) {
//       const key = aiCategory.toLowerCase().trim();
//       if (key === 'income') return EntryCategory.OTHER_INCOME;
//     }

//     // Default: generic income (client payment, transfer, etc.)
//     return EntryCategory.OTHER_INCOME;
//   }
// }
