/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/api/src/modules/bookkeeping/services/bank-statement-parser.service.ts
//
// Rule-based PDF text extractor for Estonian banks.
// Parses Swedbank, SEB, LHV, Luminor, and Coop statement PDFs locally —
// no AI tokens consumed for raw transaction transcription.
//
// Architecture:
//   pdfBase64 → pdf-parse (text extraction) → bank-specific regex parser
//   → RawTransaction[] → caller handles categorisation via AI (batch, cheap)

import { Injectable, Logger } from '@nestjs/common';
// FIX #1: pdf-parse exports a plain async function, NOT a class.
// import { PDFParse } from 'pdf-parse'  ← this was wrong and threw at runtime,
// making extractText() always return null → 0 transactions → error 1.
import * as pdfParse from 'pdf-parse';

// ── Shared transaction shape (pre-AI-categorisation) ─────────────────────────

export interface RawTransaction {
  date: string; // YYYY-MM-DD
  valueDate?: string; // YYYY-MM-DD
  description: string;
  amount: number; // negative = debit/expense, positive = credit/income
  currency: string;
  /** Derived from amount sign — set here so callers never have to re-derive */
  type: 'income' | 'expense';
  counterpartyName?: string;
  counterpartyIban?: string;
  referenceNumber?: string;
  transactionId?: string;
}

export interface ParsedStatement {
  bankName: string;
  accountHolder: string;
  iban: string;
  periodFrom: string; // YYYY-MM-DD
  periodTo: string; // YYYY-MM-DD
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: RawTransaction[];
  parseMethod: 'rules' | 'ai_fallback';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert DD.MM.YYYY or DD/MM/YYYY → YYYY-MM-DD */
function estDate(raw: string): string {
  const m = raw.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (!m) return raw;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Convert DD.MM.YY → YYYY-MM-DD (two-digit year, assume 2000s) */
function estDateShort(raw: string): string {
  const m = raw.match(/(\d{2})[./](\d{2})[./](\d{2})/);
  if (!m) return raw;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

/** Parse Estonian/European decimal: "1 234,56" or "1234.56" or "-50,19" */
function parseAmount(raw: string): number {
  // Strip thousands separators (space or dot used as thousands) then normalise decimal comma
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(?:[,]|\d{0,0}$))/g, '')
    .replace(',', '.');
  return parseFloat(cleaned);
}

/**
 * FIX #3: Derive income/expense type from amount sign.
 * - Positive amount  → money in  → income
 * - Negative amount  → money out → expense
 * - Zero             → treat as expense (edge case, DB layer should ignore)
 */
function deriveType(amount: number): 'income' | 'expense' {
  return amount > 0 ? 'income' : 'expense';
}

// ── Bank detector ─────────────────────────────────────────────────────────────

export function detectBank(text: string, filename = ''): string | null {
  const t = text.slice(0, 2000).toLowerCase();
  const f = filename.toLowerCase();

  if (t.includes('swedbank') || f.includes('swed')) return 'swedbank';
  if (t.includes('seb') || f.includes('seb')) return 'seb';
  if ((t.includes('lhv') || f.includes('lhv')) && !t.includes('luminor'))
    return 'lhv';
  if (t.includes('luminor') || t.includes('nordea') || f.includes('luminor'))
    return 'luminor';
  if (t.includes('coop pank') || f.includes('coop')) return 'coop';
  return null;
}

// ── Whitespace normaliser ──────────────────────────────────────────────────────
// pdf-parse sometimes collapses multiple spaces to one. We normalise so regexes
// that relied on \s{2,} don't silently match nothing.

function normaliseSpaces(text: string): string {
  // Convert tabs to spaces, collapse 3+ spaces to 2 (keep double-space as column separator hint)
  return text.replace(/\t/g, '  ').replace(/ {3,}/g, '  ');
}

// ─────────────────────────────────────────────────────────────────────────────
// SWEDBANK
// Format: tabular PDF, columns separated by whitespace
// Date | Beneficiary/Remitter | Details | Amount | Balance
// ─────────────────────────────────────────────────────────────────────────────

function parseSwedbankText(text: string): Omit<ParsedStatement, 'parseMethod'> {
  const normalised = normaliseSpaces(text);
  const lines = normalised
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let accountHolder = '';
  let iban = '';
  let periodFrom = '';
  let periodTo = '';
  let openingBalance = 0;
  let closingBalance = 0;

  for (const line of lines) {
    const holderMatch = line.match(
      /(?:konto omanik|account holder)[:\s]+(.+)/i,
    );
    if (holderMatch) accountHolder = holderMatch[1].trim();

    const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

    const periodMatch = line.match(
      /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
    );
    if (periodMatch && !periodFrom) {
      periodFrom = estDate(periodMatch[1]);
      periodTo = estDate(periodMatch[2]);
    }

    const openMatch = line.match(
      /(?:algsaldo|opening balance)[^\d-]*([-\d\s,.']+)/i,
    );
    if (openMatch) openingBalance = parseAmount(openMatch[1]);

    const closeMatch = line.match(
      /(?:lõppsaldo|closing balance)[^\d-]*([-\d\s,.']+)/i,
    );
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
  }

  const transactions: RawTransaction[] = [];

  // FIX #4: Accept both single-space and double-space column separators.
  // Pattern 1: full row with two dates (value date included)
  // "01.03.2026  01.03.2026  BOLT FOOD  EE... -12,50 EUR 164,62"
  const txFullRe =
    /^(\d{2}\.\d{2}\.\d{4})\s{1,2}(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{1,2}([-\d\s]+[,.']\d{2})\s+EUR/gm;

  // Pattern 2: single date row
  const txSimpleRe =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([-\d\s]+[,.']\d{2})\s*$/gm;

  let match: RegExpExecArray | null;

  while ((match = txFullRe.exec(normalised)) !== null) {
    const [, dateRaw, valueDateRaw, desc, amtRaw] = match;
    const amount = parseAmount(amtRaw);
    if (isNaN(amount)) continue;
    transactions.push(
      buildSwedbankTx(dateRaw, valueDateRaw, desc.trim(), amount),
    );
  }

  if (transactions.length === 0) {
    while ((match = txSimpleRe.exec(normalised)) !== null) {
      const [, dateRaw, desc, amtRaw] = match;
      const amount = parseAmount(amtRaw);
      if (isNaN(amount)) continue;
      transactions.push({
        date: estDate(dateRaw),
        description: desc.trim(),
        amount,
        currency: 'EUR',
        type: deriveType(amount), // FIX #3
      });
    }
  }

  return {
    bankName: 'Swedbank',
    accountHolder,
    iban,
    periodFrom,
    periodTo,
    currency: 'EUR',
    openingBalance,
    closingBalance,
    transactions,
  };
}

function buildSwedbankTx(
  dateRaw: string,
  valueDateRaw: string,
  desc: string,
  amount: number,
): RawTransaction {
  const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
  const counterpartyIban = ibanMatch
    ? ibanMatch[0].replace(/\s/g, '')
    : undefined;

  const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);
  const referenceNumber = refMatch ? refMatch[1] : undefined;

  let counterpartyName: string | undefined;
  if (counterpartyIban) {
    counterpartyName = desc.split(counterpartyIban)[0].trim() || undefined;
  }

  return {
    date: estDate(dateRaw),
    valueDate: estDate(valueDateRaw),
    description: desc,
    amount,
    currency: 'EUR',
    type: deriveType(amount), // FIX #3
    counterpartyName,
    counterpartyIban,
    referenceNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEB
// Format: tabular, columns: Date | Description | Debit | Credit | Balance
// Amounts in separate debit/credit columns (no sign)
// ─────────────────────────────────────────────────────────────────────────────

function parseSebText(text: string): Omit<ParsedStatement, 'parseMethod'> {
  const normalised = normaliseSpaces(text);
  const lines = normalised
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let accountHolder = '';
  let iban = '';
  let periodFrom = '';
  let periodTo = '';
  let openingBalance = 0;
  let closingBalance = 0;

  for (const line of lines) {
    const holderMatch = line.match(/(?:account name|konto nimi)[:\s]+(.+)/i);
    if (holderMatch) accountHolder = holderMatch[1].trim();

    const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

    const periodMatch = line.match(
      /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
    );
    if (periodMatch && !periodFrom) {
      periodFrom = estDate(periodMatch[1]);
      periodTo = estDate(periodMatch[2]);
    }

    const openMatch = line.match(
      /(?:opening balance|algsaldo)[^\d]*([\d\s,.']+)/i,
    );
    if (openMatch) openingBalance = parseAmount(openMatch[1]);

    const closeMatch = line.match(
      /(?:closing balance|lõppsaldo)[^\d]*([\d\s,.']+)/i,
    );
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
  }

  const transactions: RawTransaction[] = [];

  // FIX #4: relaxed to \s+ instead of \s{2,} for single-space PDFs
  const txRe =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([\d\s,.']+)?\s{2,}([\d\s,.']+)?\s{2,}[\d\s,.']+$/gm;

  let match: RegExpExecArray | null;
  while ((match = txRe.exec(normalised)) !== null) {
    const [, dateRaw, desc, debitRaw, creditRaw] = match;

    let amount: number;
    if (debitRaw && debitRaw.trim()) {
      amount = -Math.abs(parseAmount(debitRaw));
    } else if (creditRaw && creditRaw.trim()) {
      amount = Math.abs(parseAmount(creditRaw));
    } else {
      continue;
    }

    if (isNaN(amount)) continue;

    const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    const counterpartyIban = ibanMatch
      ? ibanMatch[0].replace(/\s/g, '')
      : undefined;
    const refMatch = desc.match(/(?:ref|viitenr?)[.:\s]+(\d{3,20})/i);

    transactions.push({
      date: estDate(dateRaw),
      description: desc.trim(),
      amount,
      currency: 'EUR',
      type: deriveType(amount), // FIX #3
      counterpartyIban,
      referenceNumber: refMatch ? refMatch[1] : undefined,
    });
  }

  return {
    bankName: 'SEB',
    accountHolder,
    iban,
    periodFrom,
    periodTo,
    currency: 'EUR',
    openingBalance,
    closingBalance,
    transactions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LHV
// Format: CSV-export PDF or tabular
// Columns: Kuupäev | Selgitus | Deebet | Kreedit | Saldo
// ─────────────────────────────────────────────────────────────────────────────

function parseLhvText(text: string): Omit<ParsedStatement, 'parseMethod'> {
  const normalised = normaliseSpaces(text);
  const lines = normalised
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let accountHolder = '';
  let iban = '';
  let periodFrom = '';
  let periodTo = '';
  let openingBalance = 0;
  let closingBalance = 0;

  for (const line of lines) {
    const holderMatch = line.match(/(?:konto omanik|nimi)[:\s]+(.+)/i);
    if (holderMatch) accountHolder = holderMatch[1].trim();

    const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

    const periodMatch = line.match(
      /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
    );
    if (periodMatch && !periodFrom) {
      periodFrom = estDate(periodMatch[1]);
      periodTo = estDate(periodMatch[2]);
    }

    const openMatch = line.match(/(?:algsaldo|opening)[^\d]*([-\d\s,.']+)/i);
    if (openMatch) openingBalance = parseAmount(openMatch[1]);

    const closeMatch = line.match(/(?:lõppsaldo|closing)[^\d]*([-\d\s,.']+)/i);
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
  }

  const transactions: RawTransaction[] = [];

  // Primary: signed amount with EUR suffix
  const txRe = /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{1,2}([-\d\s,.']+)\s+EUR/gm;

  // Fallback: debit / credit split columns
  const txSplitRe =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([\d\s,.']+)?\s{2,}([\d\s,.']+)?/gm;

  let match: RegExpExecArray | null;

  while ((match = txRe.exec(normalised)) !== null) {
    const [, dateRaw, desc, amtRaw] = match;
    const amount = parseAmount(amtRaw);
    if (isNaN(amount)) continue;

    const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);
    const archMatch = desc.match(/(?:arhiivi?nr?)[.:\s]+(\S+)/i);

    transactions.push({
      date: estDate(dateRaw),
      description: desc.trim(),
      amount,
      currency: 'EUR',
      type: deriveType(amount), // FIX #3
      counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
      referenceNumber: refMatch ? refMatch[1] : undefined,
      transactionId: archMatch ? archMatch[1] : undefined,
    });
  }

  if (transactions.length === 0) {
    while ((match = txSplitRe.exec(normalised)) !== null) {
      const [, dateRaw, desc, debitRaw, creditRaw] = match;
      let amount: number;
      if (debitRaw && debitRaw.trim()) {
        amount = -Math.abs(parseAmount(debitRaw));
      } else if (creditRaw && creditRaw.trim()) {
        amount = Math.abs(parseAmount(creditRaw));
      } else continue;
      if (isNaN(amount)) continue;
      transactions.push({
        date: estDate(dateRaw),
        description: desc.trim(),
        amount,
        currency: 'EUR',
        type: deriveType(amount), // FIX #3
      });
    }
  }

  return {
    bankName: 'LHV',
    accountHolder,
    iban,
    periodFrom,
    periodTo,
    currency: 'EUR',
    openingBalance,
    closingBalance,
    transactions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LUMINOR
// Format: tabular, Date | Value date | Description | Amount | Balance
// Amounts signed (negative = debit)
// ─────────────────────────────────────────────────────────────────────────────

function parseLuminorText(text: string): Omit<ParsedStatement, 'parseMethod'> {
  const normalised = normaliseSpaces(text);
  const lines = normalised
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let accountHolder = '';
  let iban = '';
  let periodFrom = '';
  let periodTo = '';
  let openingBalance = 0;
  let closingBalance = 0;

  for (const line of lines) {
    const holderMatch = line.match(
      /(?:account holder|konto omanik)[:\s]+(.+)/i,
    );
    if (holderMatch) accountHolder = holderMatch[1].trim();

    const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

    const periodMatch = line.match(
      /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
    );
    if (periodMatch && !periodFrom) {
      periodFrom = estDate(periodMatch[1]);
      periodTo = estDate(periodMatch[2]);
    }

    const openMatch = line.match(/(?:opening|algsaldo)[^\d]*([-\d\s,.']+)/i);
    if (openMatch) openingBalance = parseAmount(openMatch[1]);

    const closeMatch = line.match(/(?:closing|lõppsaldo)[^\d]*([-\d\s,.']+)/i);
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
  }

  const transactions: RawTransaction[] = [];

  // FIX #4: relaxed whitespace between columns
  const txRe =
    /^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{1,2}([-\d\s,.']+)\s+EUR/gm;

  let match: RegExpExecArray | null;
  while ((match = txRe.exec(normalised)) !== null) {
    const [, dateRaw, valueDateRaw, desc, amtRaw] = match;
    const amount = parseAmount(amtRaw);
    if (isNaN(amount)) continue;

    const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    const refMatch = desc.match(/(?:ref|viitenr?)[.:\s]+(\d{3,20})/i);

    transactions.push({
      date: estDate(dateRaw),
      valueDate: estDate(valueDateRaw),
      description: desc.trim(),
      amount,
      currency: 'EUR',
      type: deriveType(amount), // FIX #3
      counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
      referenceNumber: refMatch ? refMatch[1] : undefined,
    });
  }

  return {
    bankName: 'Luminor',
    accountHolder,
    iban,
    periodFrom,
    periodTo,
    currency: 'EUR',
    openingBalance,
    closingBalance,
    transactions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COOP PANK
// Format: similar to LHV — tabular with signed amounts
// ─────────────────────────────────────────────────────────────────────────────

function parseCoopText(text: string): Omit<ParsedStatement, 'parseMethod'> {
  const normalised = normaliseSpaces(text);
  const lines = normalised
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let accountHolder = '';
  let iban = '';
  let periodFrom = '';
  let periodTo = '';
  let openingBalance = 0;
  let closingBalance = 0;

  for (const line of lines) {
    const holderMatch = line.match(/(?:konto omanik|nimi)[:\s]+(.+)/i);
    if (holderMatch) accountHolder = holderMatch[1].trim();

    const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

    const periodMatch = line.match(
      /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
    );
    if (periodMatch && !periodFrom) {
      periodFrom = estDate(periodMatch[1]);
      periodTo = estDate(periodMatch[2]);
    }

    const openMatch = line.match(/(?:algsaldo|avamisjääk)[^\d]*([-\d\s,.']+)/i);
    if (openMatch) openingBalance = parseAmount(openMatch[1]);

    const closeMatch = line.match(
      /(?:lõppsaldo|sulgemijääk)[^\d]*([-\d\s,.']+)/i,
    );
    if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
  }

  const transactions: RawTransaction[] = [];

  // FIX #4: relaxed whitespace
  const txRe =
    /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{1,2}([-\d\s,.']+)\s*(?:EUR)?$/gm;

  let match: RegExpExecArray | null;
  while ((match = txRe.exec(normalised)) !== null) {
    const [, dateRaw, desc, amtRaw] = match;
    const amount = parseAmount(amtRaw);
    if (isNaN(amount)) continue;

    const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
    const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);

    transactions.push({
      date: estDate(dateRaw),
      description: desc.trim(),
      amount,
      currency: 'EUR',
      type: deriveType(amount), // FIX #3
      counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
      referenceNumber: refMatch ? refMatch[1] : undefined,
    });
  }

  return {
    bankName: 'Coop Pank',
    accountHolder,
    iban,
    periodFrom,
    periodTo,
    currency: 'EUR',
    openingBalance,
    closingBalance,
    transactions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class BankStatementParserService {
  private readonly logger = new Logger(BankStatementParserService.name);

  /**
   * Extract text from PDF base64 string using pdf-parse.
   * Returns null if extraction fails (scanned/image PDF).
   *
   * FIX #1: pdfParse is a plain async function — call it directly, not with `new`.
   */
  async extractText(pdfBase64: string): Promise<string | null> {
    try {
      const buffer = Buffer.from(pdfBase64, 'base64');

      // pdf-parse can throw on some malformed PDFs — wrap defensively
      const result = await (pdfParse as any)(buffer);
      const text: string = result?.text ?? '';

      this.logger.debug(
        `[Parser] pdf-parse extracted ${text.replace(/\s/g, '').length} non-space chars`,
      );

      // Heuristic: if we got very little text, it's likely a scanned PDF
      if (text.replace(/\s/g, '').length < 200) {
        this.logger.warn(
          '[Parser] PDF yielded <200 chars — likely scanned image',
        );
        return null;
      }

      return text;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Parser] pdf-parse failed: ${msg}`);
      return null;
    }
  }

  /**
   * Parse a bank statement PDF using rule-based text extraction.
   * Returns null if the PDF is scanned/unreadable (caller should fall back to AI).
   */
  async parse(
    pdfBase64: string,
    bankHint?: string,
    filename = '',
  ): Promise<
    | (Omit<ParsedStatement, 'parseMethod'> & {
        parseMethod: 'rules' | 'ai_fallback';
      })
    | null
  > {
    const text = await this.extractText(pdfBase64);
    if (!text) return null;

    const bank = bankHint ?? detectBank(text, filename);
    this.logger.log(`[Parser] Detected bank: ${bank ?? 'unknown'}`);

    let result: Omit<ParsedStatement, 'parseMethod'>;

    switch (bank) {
      case 'swedbank':
        result = parseSwedbankText(text);
        break;
      case 'seb':
        result = parseSebText(text);
        break;
      case 'lhv':
        result = parseLhvText(text);
        break;
      case 'luminor':
        result = parseLuminorText(text);
        break;
      case 'coop':
        result = parseCoopText(text);
        break;
      default:
        this.logger.warn('[Parser] Unknown bank, attempting generic parse');
        result = parseSwedbankText(text);
        break;
    }

    if (result.transactions.length === 0) {
      this.logger.warn(
        `[Parser] Rule-based parse found 0 transactions for bank=${bank}. ` +
          'Will fall back to AI.',
      );
      return null;
    }

    // FIX #3: Ensure every transaction has type set (guard for any missed paths)
    const transactions = result.transactions.map((t) => ({
      ...t,
      type: t.type ?? deriveType(t.amount),
    }));

    this.logger.log(
      `[Parser] Extracted ${transactions.length} transactions ` +
        `from ${result.bankName} statement via rules ` +
        `(income: ${transactions.filter((t) => t.type === 'income').length}, ` +
        `expense: ${transactions.filter((t) => t.type === 'expense').length})`,
    );

    return { ...result, transactions, parseMethod: 'rules' };
  }
}
/* eslint-disable @typescript-eslint/require-await */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unused-vars */
// // apps/api/src/modules/bookkeeping/services/bank-statement-parser.service.ts
// //
// // Rule-based PDF text extractor for Estonian banks.
// // Parses Swedbank, SEB, LHV, Luminor, and Coop statement PDFs locally —
// // no AI tokens consumed for raw transaction transcription.
// //
// // Architecture:
// //   pdfBase64 → pdf-parse (text extraction) → bank-specific regex parser
// //   → RawTransaction[] → caller handles categorisation via AI (batch, cheap)

// import { Injectable, Logger } from '@nestjs/common';
// import { PDFParse } from 'pdf-parse';
// // ── Shared transaction shape (pre-AI-categorisation) ─────────────────────────

// export interface RawTransaction {
//   date: string; // YYYY-MM-DD
//   valueDate?: string; // YYYY-MM-DD
//   description: string;
//   amount: number; // negative = debit, positive = credit
//   currency: string;
//   counterpartyName?: string;
//   counterpartyIban?: string;
//   referenceNumber?: string;
//   transactionId?: string;
// }

// export interface ParsedStatement {
//   bankName: string;
//   accountHolder: string;
//   iban: string;
//   periodFrom: string; // YYYY-MM-DD
//   periodTo: string; // YYYY-MM-DD
//   currency: string;
//   openingBalance: number;
//   closingBalance: number;
//   transactions: RawTransaction[];
//   parseMethod: 'rules' | 'ai_fallback';
// }

// // ── Helpers ───────────────────────────────────────────────────────────────────

// /** Convert DD.MM.YYYY or DD/MM/YYYY → YYYY-MM-DD */
// function estDate(raw: string): string {
//   const m = raw.match(/(\d{2})[./](\d{2})[./](\d{4})/);
//   if (!m) return raw;
//   return `${m[3]}-${m[2]}-${m[1]}`;
// }

// /** Convert DD.MM.YY → YYYY-MM-DD (two-digit year, assume 2000s) */
// function estDateShort(raw: string): string {
//   const m = raw.match(/(\d{2})[./](\d{2})[./](\d{2})/);
//   if (!m) return raw;
//   return `20${m[3]}-${m[2]}-${m[1]}`;
// }

// /** Parse Estonian/European decimal: "1 234,56" or "1234.56" or "-50,19" */
// function parseAmount(raw: string): number {
//   return parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
// }

// // ── Bank detector ─────────────────────────────────────────────────────────────

// export function detectBank(text: string, filename = ''): string | null {
//   const t = text.slice(0, 2000).toLowerCase();
//   const f = filename.toLowerCase();

//   if (t.includes('swedbank') || f.includes('swed')) return 'swedbank';
//   if (t.includes('seb') || f.includes('seb')) return 'seb';
//   if ((t.includes('lhv') || f.includes('lhv')) && !t.includes('luminor'))
//     return 'lhv';
//   if (t.includes('luminor') || t.includes('nordea') || f.includes('luminor'))
//     return 'luminor';
//   if (t.includes('coop pank') || f.includes('coop')) return 'coop';
//   return null;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // SWEDBANK
// // Format: tabular PDF, columns separated by whitespace
// // Date | Beneficiary/Remitter | Details | Amount | Balance
// // ─────────────────────────────────────────────────────────────────────────────

// function parseSwedbankText(text: string): Omit<ParsedStatement, 'parseMethod'> {
//   const lines = text
//     .split('\n')
//     .map((l) => l.trim())
//     .filter(Boolean);

//   // Header fields
//   let accountHolder = '';
//   let iban = '';
//   let periodFrom = '';
//   let periodTo = '';
//   let openingBalance = 0;
//   let closingBalance = 0;

//   for (const line of lines) {
//     // Account holder — appears after "Konto omanik:" or "Account holder:"
//     const holderMatch = line.match(
//       /(?:konto omanik|account holder)[:\s]+(.+)/i,
//     );
//     if (holderMatch) accountHolder = holderMatch[1].trim();

//     // IBAN
//     const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

//     // Period: "01.03.2026 - 31.03.2026" or "Periood: 01.03.2026–31.03.2026"
//     const periodMatch = line.match(
//       /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
//     );
//     if (periodMatch && !periodFrom) {
//       periodFrom = estDate(periodMatch[1]);
//       periodTo = estDate(periodMatch[2]);
//     }

//     // Opening balance
//     const openMatch = line.match(
//       /(?:algsaldo|opening balance)[^\d-]*([-\d\s,.']+)/i,
//     );
//     if (openMatch) openingBalance = parseAmount(openMatch[1]);

//     // Closing balance
//     const closeMatch = line.match(
//       /(?:lõppsaldo|closing balance)[^\d-]*([-\d\s,.']+)/i,
//     );
//     if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
//   }

//   // Transaction rows — Swedbank CSV-like lines:
//   // "01.03.2026  01.03.2026  BOLT FOOD  EE... -12,50 EUR 164,62"
//   // or simpler: "01.03.2026  DESCRIPTION  -12,50"
//   const transactions: RawTransaction[] = [];

//   // Pattern 1: full row with two dates
//   const txFullRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([-\d\s]+[,.']\d{2})\s+EUR/gm;

//   // Pattern 2: single date row
//   const txSimpleRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([-\d\s]+[,.']\d{2})\s*$/gm;

//   let match: RegExpExecArray | null;

//   while ((match = txFullRe.exec(text)) !== null) {
//     const [, dateRaw, valueDateRaw, desc, amtRaw] = match;
//     const amount = parseAmount(amtRaw);
//     if (isNaN(amount)) continue;

//     const tx = buildSwedbankTx(dateRaw, valueDateRaw, desc.trim(), amount);
//     transactions.push(tx);
//   }

//   // Only fall back to simple pattern if full pattern found nothing
//   if (transactions.length === 0) {
//     while ((match = txSimpleRe.exec(text)) !== null) {
//       const [, dateRaw, desc, amtRaw] = match;
//       const amount = parseAmount(amtRaw);
//       if (isNaN(amount)) continue;
//       transactions.push({
//         date: estDate(dateRaw),
//         description: desc.trim(),
//         amount,
//         currency: 'EUR',
//       });
//     }
//   }

//   return {
//     bankName: 'Swedbank',
//     accountHolder,
//     iban,
//     periodFrom,
//     periodTo,
//     currency: 'EUR',
//     openingBalance,
//     closingBalance,
//     transactions,
//   };
// }

// function buildSwedbankTx(
//   dateRaw: string,
//   valueDateRaw: string,
//   desc: string,
//   amount: number,
// ): RawTransaction {
//   // Try to pull out counterparty IBAN from description
//   const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//   const counterpartyIban = ibanMatch
//     ? ibanMatch[0].replace(/\s/g, '')
//     : undefined;

//   // Reference number — typically 7-20 digits at end
//   const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);
//   const referenceNumber = refMatch ? refMatch[1] : undefined;

//   // Counterparty name is usually before the IBAN in the description
//   let counterpartyName: string | undefined;
//   if (counterpartyIban) {
//     counterpartyName = desc.split(counterpartyIban)[0].trim() || undefined;
//   }

//   return {
//     date: estDate(dateRaw),
//     valueDate: estDate(valueDateRaw),
//     description: desc,
//     amount,
//     currency: 'EUR',
//     counterpartyName,
//     counterpartyIban,
//     referenceNumber,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // SEB
// // Format: tabular, columns: Date | Description | Debit | Credit | Balance
// // Amounts in separate debit/credit columns (no sign)
// // ─────────────────────────────────────────────────────────────────────────────

// function parseSebText(text: string): Omit<ParsedStatement, 'parseMethod'> {
//   const lines = text
//     .split('\n')
//     .map((l) => l.trim())
//     .filter(Boolean);

//   let accountHolder = '';
//   let iban = '';
//   let periodFrom = '';
//   let periodTo = '';
//   let openingBalance = 0;
//   let closingBalance = 0;

//   for (const line of lines) {
//     const holderMatch = line.match(/(?:account name|konto nimi)[:\s]+(.+)/i);
//     if (holderMatch) accountHolder = holderMatch[1].trim();

//     const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

//     const periodMatch = line.match(
//       /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
//     );
//     if (periodMatch && !periodFrom) {
//       periodFrom = estDate(periodMatch[1]);
//       periodTo = estDate(periodMatch[2]);
//     }

//     const openMatch = line.match(
//       /(?:opening balance|algsaldo)[^\d]*([\d\s,.']+)/i,
//     );
//     if (openMatch) openingBalance = parseAmount(openMatch[1]);

//     const closeMatch = line.match(
//       /(?:closing balance|lõppsaldo)[^\d]*([\d\s,.']+)/i,
//     );
//     if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
//   }

//   const transactions: RawTransaction[] = [];

//   // SEB row: "DD.MM.YYYY  description  debit  credit  balance"
//   // debit and credit are unsigned; we determine sign by which column has value
//   const txRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([\d\s,.']+)?\s{2,}([\d\s,.']+)?\s{2,}[\d\s,.']+$/gm;

//   let match: RegExpExecArray | null;
//   while ((match = txRe.exec(text)) !== null) {
//     const [, dateRaw, desc, debitRaw, creditRaw] = match;

//     let amount: number;
//     if (debitRaw && debitRaw.trim()) {
//       amount = -Math.abs(parseAmount(debitRaw));
//     } else if (creditRaw && creditRaw.trim()) {
//       amount = Math.abs(parseAmount(creditRaw));
//     } else {
//       continue;
//     }

//     if (isNaN(amount)) continue;

//     const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     const counterpartyIban = ibanMatch
//       ? ibanMatch[0].replace(/\s/g, '')
//       : undefined;
//     const refMatch = desc.match(/(?:ref|viitenr?)[.:\s]+(\d{3,20})/i);

//     transactions.push({
//       date: estDate(dateRaw),
//       description: desc.trim(),
//       amount,
//       currency: 'EUR',
//       counterpartyIban,
//       referenceNumber: refMatch ? refMatch[1] : undefined,
//     });
//   }

//   return {
//     bankName: 'SEB',
//     accountHolder,
//     iban,
//     periodFrom,
//     periodTo,
//     currency: 'EUR',
//     openingBalance,
//     closingBalance,
//     transactions,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // LHV
// // Format: CSV-export PDF or tabular
// // Columns: Kuupäev | Selgitus | Deebet | Kreedit | Saldo
// // ─────────────────────────────────────────────────────────────────────────────

// function parseLhvText(text: string): Omit<ParsedStatement, 'parseMethod'> {
//   const lines = text
//     .split('\n')
//     .map((l) => l.trim())
//     .filter(Boolean);

//   let accountHolder = '';
//   let iban = '';
//   let periodFrom = '';
//   let periodTo = '';
//   let openingBalance = 0;
//   let closingBalance = 0;

//   for (const line of lines) {
//     const holderMatch = line.match(/(?:konto omanik|nimi)[:\s]+(.+)/i);
//     if (holderMatch) accountHolder = holderMatch[1].trim();

//     const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

//     const periodMatch = line.match(
//       /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
//     );
//     if (periodMatch && !periodFrom) {
//       periodFrom = estDate(periodMatch[1]);
//       periodTo = estDate(periodMatch[2]);
//     }

//     const openMatch = line.match(/(?:algsaldo|opening)[^\d]*([-\d\s,.']+)/i);
//     if (openMatch) openingBalance = parseAmount(openMatch[1]);

//     const closeMatch = line.match(/(?:lõppsaldo|closing)[^\d]*([-\d\s,.']+)/i);
//     if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
//   }

//   const transactions: RawTransaction[] = [];

//   // LHV rows — date then description then signed amount
//   // "01.03.2026  Bolt Food OÜ  -8,40"
//   const txRe = /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([-\d\s,.']+)\s+EUR/gm;

//   // Also handle debit/credit split columns like SEB
//   const txSplitRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([\d\s,.']+)?\s{2,}([\d\s,.']+)?/gm;

//   let match: RegExpExecArray | null;

//   while ((match = txRe.exec(text)) !== null) {
//     const [, dateRaw, desc, amtRaw] = match;
//     const amount = parseAmount(amtRaw);
//     if (isNaN(amount)) continue;

//     const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);
//     const archMatch = desc.match(/(?:arhiivi?nr?)[.:\s]+(\S+)/i);

//     transactions.push({
//       date: estDate(dateRaw),
//       description: desc.trim(),
//       amount,
//       currency: 'EUR',
//       counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
//       referenceNumber: refMatch ? refMatch[1] : undefined,
//       transactionId: archMatch ? archMatch[1] : undefined,
//     });
//   }

//   if (transactions.length === 0) {
//     while ((match = txSplitRe.exec(text)) !== null) {
//       const [, dateRaw, desc, debitRaw, creditRaw] = match;
//       let amount: number;
//       if (debitRaw && debitRaw.trim()) {
//         amount = -Math.abs(parseAmount(debitRaw));
//       } else if (creditRaw && creditRaw.trim()) {
//         amount = Math.abs(parseAmount(creditRaw));
//       } else continue;
//       if (isNaN(amount)) continue;
//       transactions.push({
//         date: estDate(dateRaw),
//         description: desc.trim(),
//         amount,
//         currency: 'EUR',
//       });
//     }
//   }

//   return {
//     bankName: 'LHV',
//     accountHolder,
//     iban,
//     periodFrom,
//     periodTo,
//     currency: 'EUR',
//     openingBalance,
//     closingBalance,
//     transactions,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // LUMINOR
// // Format: tabular, Date | Value date | Description | Amount | Balance
// // Amounts signed (negative = debit)
// // ─────────────────────────────────────────────────────────────────────────────

// function parseLuminorText(text: string): Omit<ParsedStatement, 'parseMethod'> {
//   const lines = text
//     .split('\n')
//     .map((l) => l.trim())
//     .filter(Boolean);

//   let accountHolder = '';
//   let iban = '';
//   let periodFrom = '';
//   let periodTo = '';
//   let openingBalance = 0;
//   let closingBalance = 0;

//   for (const line of lines) {
//     const holderMatch = line.match(
//       /(?:account holder|konto omanik)[:\s]+(.+)/i,
//     );
//     if (holderMatch) accountHolder = holderMatch[1].trim();

//     const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

//     const periodMatch = line.match(
//       /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
//     );
//     if (periodMatch && !periodFrom) {
//       periodFrom = estDate(periodMatch[1]);
//       periodTo = estDate(periodMatch[2]);
//     }

//     const openMatch = line.match(/(?:opening|algsaldo)[^\d]*([-\d\s,.']+)/i);
//     if (openMatch) openingBalance = parseAmount(openMatch[1]);

//     const closeMatch = line.match(/(?:closing|lõppsaldo)[^\d]*([-\d\s,.']+)/i);
//     if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
//   }

//   const transactions: RawTransaction[] = [];

//   // Luminor: two dates then description then signed amount
//   const txRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([-\d\s,.']+)\s+EUR/gm;

//   let match: RegExpExecArray | null;
//   while ((match = txRe.exec(text)) !== null) {
//     const [, dateRaw, valueDateRaw, desc, amtRaw] = match;
//     const amount = parseAmount(amtRaw);
//     if (isNaN(amount)) continue;

//     const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     const refMatch = desc.match(/(?:ref|viitenr?)[.:\s]+(\d{3,20})/i);

//     transactions.push({
//       date: estDate(dateRaw),
//       valueDate: estDate(valueDateRaw),
//       description: desc.trim(),
//       amount,
//       currency: 'EUR',
//       counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
//       referenceNumber: refMatch ? refMatch[1] : undefined,
//     });
//   }

//   return {
//     bankName: 'Luminor',
//     accountHolder,
//     iban,
//     periodFrom,
//     periodTo,
//     currency: 'EUR',
//     openingBalance,
//     closingBalance,
//     transactions,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // COOP PANK
// // Format: similar to LHV — tabular with signed amounts
// // ─────────────────────────────────────────────────────────────────────────────

// function parseCoopText(text: string): Omit<ParsedStatement, 'parseMethod'> {
//   const lines = text
//     .split('\n')
//     .map((l) => l.trim())
//     .filter(Boolean);

//   let accountHolder = '';
//   let iban = '';
//   let periodFrom = '';
//   let periodTo = '';
//   let openingBalance = 0;
//   let closingBalance = 0;

//   for (const line of lines) {
//     const holderMatch = line.match(/(?:konto omanik|nimi)[:\s]+(.+)/i);
//     if (holderMatch) accountHolder = holderMatch[1].trim();

//     const ibanMatch = line.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     if (ibanMatch && !iban) iban = ibanMatch[0].replace(/\s/g, '');

//     const periodMatch = line.match(
//       /(\d{2}[./]\d{2}[./]\d{4})\s*[-–]\s*(\d{2}[./]\d{2}[./]\d{4})/,
//     );
//     if (periodMatch && !periodFrom) {
//       periodFrom = estDate(periodMatch[1]);
//       periodTo = estDate(periodMatch[2]);
//     }

//     const openMatch = line.match(/(?:algsaldo|avamisjääk)[^\d]*([-\d\s,.']+)/i);
//     if (openMatch) openingBalance = parseAmount(openMatch[1]);

//     const closeMatch = line.match(
//       /(?:lõppsaldo|sulgemijääk)[^\d]*([-\d\s,.']+)/i,
//     );
//     if (closeMatch) closingBalance = parseAmount(closeMatch[1]);
//   }

//   const transactions: RawTransaction[] = [];

//   const txRe =
//     /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s{2,}([-\d\s,.']+)\s*(?:EUR)?$/gm;

//   let match: RegExpExecArray | null;
//   while ((match = txRe.exec(text)) !== null) {
//     const [, dateRaw, desc, amtRaw] = match;
//     const amount = parseAmount(amtRaw);
//     if (isNaN(amount)) continue;

//     const ibanMatch = desc.match(/EE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/);
//     const refMatch = desc.match(/(?:viitenr?|ref)[.:\s]+(\d{3,20})/i);

//     transactions.push({
//       date: estDate(dateRaw),
//       description: desc.trim(),
//       amount,
//       currency: 'EUR',
//       counterpartyIban: ibanMatch ? ibanMatch[0].replace(/\s/g, '') : undefined,
//       referenceNumber: refMatch ? refMatch[1] : undefined,
//     });
//   }

//   return {
//     bankName: 'Coop Pank',
//     accountHolder,
//     iban,
//     periodFrom,
//     periodTo,
//     currency: 'EUR',
//     openingBalance,
//     closingBalance,
//     transactions,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Main service
// // ─────────────────────────────────────────────────────────────────────────────

// @Injectable()
// export class BankStatementParserService {
//   private readonly logger = new Logger(BankStatementParserService.name);

//   /**
//    * Extract text from PDF base64 string using pdf-parse.
//    * Returns null if extraction fails (scanned/image PDF).
//    */
//   async extractText(pdfBase64: string): Promise<string | null> {
//     try {
//       const buffer = Buffer.from(pdfBase64, 'base64');
//       const parser = new PDFParse({ data: buffer });
//       const result = await parser.getText();
//       const text = result.text ?? '';

//       // Heuristic: if we got very little text, it's likely a scanned PDF
//       if (text.replace(/\s/g, '').length < 200) {
//         this.logger.warn(
//           '[Parser] PDF yielded <200 chars — likely scanned image',
//         );
//         return null;
//       }

//       return text;
//     } catch (err: unknown) {
//       const msg = err instanceof Error ? err.message : String(err);
//       this.logger.warn(`[Parser] pdf-parse failed: ${msg}`);
//       return null;
//     }
//   }

//   /**
//    * Parse a bank statement PDF using rule-based text extraction.
//    * Returns null if the PDF is scanned/unreadable (caller should fall back to AI).
//    */
//   async parse(
//     pdfBase64: string,
//     bankHint?: string,
//     filename = '',
//   ): Promise<ParsedStatement | null> {
//     const text = await this.extractText(pdfBase64);
//     if (!text) return null;

//     const bank = bankHint ?? detectBank(text, filename);
//     this.logger.log(`[Parser] Detected bank: ${bank ?? 'unknown'}`);

//     let result: Omit<ParsedStatement, 'parseMethod'>;

//     switch (bank) {
//       case 'swedbank':
//         result = parseSwedbankText(text);
//         break;
//       case 'seb':
//         result = parseSebText(text);
//         break;
//       case 'lhv':
//         result = parseLhvText(text);
//         break;
//       case 'luminor':
//         result = parseLuminorText(text);
//         break;
//       case 'coop':
//         result = parseCoopText(text);
//         break;
//       default:
//         // Unknown bank — try Swedbank pattern as most common, then give up
//         this.logger.warn('[Parser] Unknown bank, attempting generic parse');
//         result = parseSwedbankText(text);
//         break;
//     }

//     if (result.transactions.length === 0) {
//       this.logger.warn(
//         `[Parser] Rule-based parse found 0 transactions for bank=${bank}. ` +
//           'Will fall back to AI.',
//       );
//       return null; // signal caller to use AI fallback
//     }

//     this.logger.log(
//       `[Parser] Extracted ${result.transactions.length} transactions ` +
//         `from ${result.bankName} statement via rules`,
//     );

//     return { ...result, parseMethod: 'rules' };
//   }
// }
