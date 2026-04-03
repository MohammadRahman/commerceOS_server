// apps/api/src/modules/bookkeeping/services/receipt-scanner.service.ts

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../../ai/ai.service';
import {
  BookkeepingEntry,
  EntryCategory,
  ReceiptParsedData,
  TaxProfile,
} from '../entities/bookkeeping.entities';
import { EntryService } from './entry.service';
import { ScanReceiptDto } from '../dto/bookkeeping.dto';

// ─── Category auto-detection ──────────────────────────────────────────────────

const CATEGORY_HINTS: Array<{ keywords: string[]; category: EntryCategory }> = [
  {
    keywords: ['meat', 'butcher', 'liha', 'poultry', 'seafood', 'fish', 'kala'],
    category: EntryCategory.SUPPLIER_FOOD,
  },
  {
    keywords: [
      'vegetables',
      'fruit',
      'grocery',
      'toidupood',
      'market',
      'pood',
      'köögivili',
    ],
    category: EntryCategory.SUPPLIER_FOOD,
  },
  {
    keywords: [
      'electricity',
      'gas',
      'water',
      'elekter',
      'gaas',
      'vesi',
      'elering',
    ],
    category: EntryCategory.UTILITIES,
  },
  {
    keywords: ['rent', 'üür', 'lease', 'rental', 'üürileping'],
    category: EntryCategory.RENT,
  },
  {
    keywords: [
      'amazon',
      'apple',
      'microsoft',
      'google',
      'software',
      'subscription',
      'saas',
    ],
    category: EntryCategory.SOFTWARE,
  },
  {
    keywords: [
      'transport',
      'taxi',
      'uber',
      'bolt',
      'fuel',
      'petrol',
      'kütus',
      'buss',
    ],
    category: EntryCategory.TRANSPORT,
  },
  {
    keywords: [
      'facebook',
      'instagram',
      'google ads',
      'marketing',
      'reklaam',
      'advertising',
    ],
    category: EntryCategory.MARKETING,
  },
];

function guessCategory(text: string, hint?: EntryCategory): EntryCategory {
  if (hint) return hint;
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_HINTS) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.category;
  }
  return EntryCategory.OTHER_EXPENSE;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ReceiptScannerService {
  private readonly logger = new Logger(ReceiptScannerService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly entryService: EntryService,
    @InjectRepository(TaxProfile)
    private readonly profileRepo: Repository<TaxProfile>,
    @InjectRepository(BookkeepingEntry)
    private readonly entryRepo: Repository<BookkeepingEntry>,
  ) {}

  // ─── Main scan entry point ────────────────────────────────────────────────

  async scanReceipt(
    orgId: string,
    dto: ScanReceiptDto,
    createdByUserId?: string,
  ): Promise<{ parsed: ReceiptParsedData; entry?: BookkeepingEntry }> {
    const { base64, mimeType } = await this.fetchImageAsBase64(dto.imageUrl);
    const parsed = await this.extractReceiptData(base64, mimeType);

    this.logger.log(
      `Receipt scanned org=${orgId} ` +
        `merchant=${parsed.merchantName ?? 'unknown'} ` +
        `amount=${parsed.totalAmount ?? '?'} ` +
        `confidence=${parsed.confidence}`,
    );

    // Return for manual review if confidence is too low or no amount found
    if (!dto.autoConfirm || parsed.confidence < 0.6 || !parsed.totalAmount) {
      return { parsed };
    }

    const category = guessCategory(
      `${parsed.merchantName ?? ''} ${parsed.rawText ?? ''}`,
      dto.expectedCategory,
    );

    // FIX: expectedDate may not exist on all DTO shapes — guard with optional
    // chaining. ScanReceiptDto should declare it as optional: expectedDate?: string.
    const entryDate =
      parsed.receiptDate ??
      (dto as { expectedDate?: string }).expectedDate ??
      new Date().toISOString().split('T')[0];

    const entry = await this.entryService.addExpense(
      orgId,
      {
        date: entryDate,
        grossAmount: parsed.totalAmount,
        category,
        description: parsed.merchantName ?? 'Receipt scan',
        vatRate: parsed.vatRate ?? 0,
        receiptImageUrl: dto.imageUrl,
        counterpartyName: parsed.merchantName,
        counterpartyVatNumber: parsed.merchantVatNumber,
        notes: `Auto-scanned · confidence ${Math.round(parsed.confidence * 100)}%`,
      },
      createdByUserId,
    );

    // FIX: patch receiptParsedData onto the saved entry and persist it.
    // Previously the field was set in memory but never saved — the JSONB
    // column would remain null in the DB.
    entry.receiptParsedData = parsed;
    const savedEntry = await this.entryRepo.save(entry);

    return { parsed, entry: savedEntry };
  }

  // ─── Claude Vision extraction ─────────────────────────────────────────────

  private async extractReceiptData(
    base64: string,
    mimeType: string,
  ): Promise<ReceiptParsedData> {
    const prompt = `You are a receipt and invoice parser for an Estonian accounting platform.

Estonian context:
- VAT (käibemaks) shown as KM, VAT, or käibemaks on receipts
- Common rates: 24% (standard), 13% (accommodation), 9% (press/books), 0% (exempt)
- Estonian VAT numbers start with EE followed by 9 digits
- Dates may be in DD.MM.YYYY or YYYY-MM-DD — always output YYYY-MM-DD
- Currency is EUR (€)

Extract all financial data from this receipt/invoice image.
Return ONLY valid JSON, no markdown, no explanation:
{
  "merchantName": "string or null",
  "merchantVatNumber": "EE + 9 digits or null",
  "receiptDate": "YYYY-MM-DD or null",
  "totalAmount": <final total incl. VAT as number, or null>,
  "vatAmount": <VAT portion as number, or null>,
  "vatRate": <24, 13, 9, or 0 as number, or null>,
  "currency": "EUR",
  "lineItems": [
    { "description": "string", "quantity": <number or null>, "unitPrice": <number or null>, "total": <number> }
  ],
  "confidence": <0.0-1.0 — how readable/complete the receipt is>,
  "rawText": "all readable text from the image for audit"
}`;

    const raw = await this.aiService.scanReceiptImage(base64, mimeType, prompt);
    return this.aiService.parseReceiptJSON(raw);
  }

  // ─── Image fetcher ────────────────────────────────────────────────────────

  private async fetchImageAsBase64(
    url: string,
  ): Promise<{ base64: string; mimeType: string }> {
    if (url.startsWith('data:')) {
      const [header, data] = url.split(',');
      const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
      return { base64: data, mimeType };
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new BadRequestException(
        `Could not fetch image from URL: ${response.status}`,
      );
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = this.detectMimeType(
      url,
      response.headers.get('content-type'),
    );
    return { base64, mimeType };
  }

  private detectMimeType(url: string, contentType: string | null): string {
    if (contentType?.includes('png')) return 'image/png';
    if (contentType?.includes('webp')) return 'image/webp';
    if (contentType?.includes('pdf')) return 'application/pdf';
    const lower = url.toLowerCase();
    if (lower.includes('.png')) return 'image/png';
    if (lower.includes('.webp')) return 'image/webp';
    if (lower.includes('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }
}
// apps/api/src/modules/bookkeeping/services/receipt-scanner.service.ts
// //
// // REFACTORED — uses the existing AiService.callClaude() instead of
// // direct Anthropic SDK. Drop-in replacement for the previous version.

// import { Injectable, Logger, BadRequestException } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { AiService } from '../../ai/ai.service';
// import {
//   BookkeepingEntry,
//   EntryCategory,
//   EntryStatus,
//   SourceType,
//   ReceiptParsedData,
//   TaxProfile,
// } from '../entities/bookkeeping.entities';
// import { EntryService } from './entry.service';
// import { ScanReceiptDto } from '../dto/bookkeeping.dto';

// // ─── Category auto-detection from extracted text ──────────────────────────────

// const CATEGORY_HINTS: Array<{ keywords: string[]; category: EntryCategory }> = [
//   {
//     keywords: ['meat', 'butcher', 'liha', 'poultry', 'seafood', 'fish', 'kala'],
//     category: EntryCategory.SUPPLIER_FOOD,
//   },
//   {
//     keywords: [
//       'vegetables',
//       'fruit',
//       'grocery',
//       'toidupood',
//       'market',
//       'pood',
//       'köögivili',
//     ],
//     category: EntryCategory.SUPPLIER_FOOD,
//   },
//   {
//     keywords: [
//       'electricity',
//       'gas',
//       'water',
//       'elekter',
//       'gaas',
//       'vesi',
//       'elering',
//     ],
//     category: EntryCategory.UTILITIES,
//   },
//   {
//     keywords: ['rent', 'üür', 'lease', 'rental', 'üürileping'],
//     category: EntryCategory.RENT,
//   },
//   {
//     keywords: [
//       'amazon',
//       'apple',
//       'microsoft',
//       'google',
//       'software',
//       'subscription',
//       'saas',
//     ],
//     category: EntryCategory.SOFTWARE,
//   },
//   {
//     keywords: [
//       'transport',
//       'taxi',
//       'uber',
//       'bolt',
//       'fuel',
//       'petrol',
//       'kütus',
//       'buss',
//     ],
//     category: EntryCategory.TRANSPORT,
//   },
//   {
//     keywords: [
//       'facebook',
//       'instagram',
//       'google ads',
//       'marketing',
//       'reklaam',
//       'advertising',
//     ],
//     category: EntryCategory.MARKETING,
//   },
// ];

// function guessCategory(text: string, hint?: EntryCategory): EntryCategory {
//   if (hint) return hint;
//   const lower = text.toLowerCase();
//   for (const rule of CATEGORY_HINTS) {
//     if (rule.keywords.some((k) => lower.includes(k))) return rule.category;
//   }
//   return EntryCategory.OTHER_EXPENSE;
// }

// @Injectable()
// export class ReceiptScannerService {
//   private readonly logger = new Logger(ReceiptScannerService.name);

//   constructor(
//     private readonly aiService: AiService, // ← reuse existing service
//     private readonly entryService: EntryService,

//     @InjectRepository(TaxProfile)
//     private readonly profileRepo: Repository<TaxProfile>,
//   ) {}

//   // ─── Main scan entry point ────────────────────────────────────────────────

//   async scanReceipt(
//     orgId: string,
//     dto: ScanReceiptDto,
//     createdByUserId?: string,
//   ): Promise<{ parsed: ReceiptParsedData; entry?: BookkeepingEntry }> {
//     const { base64, mimeType } = await this.fetchImageAsBase64(dto.imageUrl);
//     const parsed = await this.extractReceiptData(base64, mimeType);

//     this.logger.log(
//       `Receipt scanned for org ${orgId} — ` +
//         `merchant: ${parsed.merchantName ?? 'unknown'}, ` +
//         `amount: ${parsed.totalAmount ?? '?'}, ` +
//         `confidence: ${parsed.confidence}`,
//     );

//     // Return for manual review if autoConfirm is off or confidence too low
//     if (!dto.autoConfirm || parsed.confidence < 0.6 || !parsed.totalAmount) {
//       return { parsed };
//     }

//     const category = guessCategory(
//       `${parsed.merchantName ?? ''} ${parsed.rawText ?? ''}`,
//       dto.expectedCategory,
//     );

//     const entry = await this.entryService.addExpense(
//       orgId,
//       {
//         date:
//           parsed.receiptDate ??
//           dto.expectedDate ??
//           new Date().toISOString().split('T')[0],
//         grossAmount: parsed.totalAmount,
//         category,
//         description: parsed.merchantName ?? 'Receipt scan',
//         vatRate: parsed.vatRate ?? 0,
//         receiptImageUrl: dto.imageUrl,
//         counterpartyName: parsed.merchantName,
//         counterpartyVatNumber: parsed.merchantVatNumber,
//         notes: `Auto-scanned · confidence ${Math.round(parsed.confidence * 100)}%`,
//       },
//       createdByUserId,
//     );

//     // Patch the receipt data onto the entry for audit
//     entry.receiptParsedData = parsed;
//     return { parsed, entry };
//   }

//   // ─── Claude Vision call via AiService ────────────────────────────────────
//   // Uses the existing callClaude() private method via a receipt-specific prompt.
//   // We reach callClaude through a new public wrapper added to AiService below.

//   private async extractReceiptData(
//     base64: string,
//     mimeType: string,
//   ): Promise<ReceiptParsedData> {
//     const prompt = `You are a receipt and invoice parser for an Estonian accounting platform.

// Estonian context:
// - VAT (käibemaks) is shown as KM, VAT, or käibemaks on receipts
// - Common rates: 24% (standard), 13% (accommodation), 9% (press/books), 0% (exempt)
// - Estonian VAT numbers start with EE followed by 9 digits
// - Dates may be in DD.MM.YYYY or YYYY-MM-DD — always output YYYY-MM-DD
// - Currency is EUR (€)

// Extract all financial data from this receipt/invoice image.
// Return ONLY valid JSON, no markdown, no explanation:
// {
//   "merchantName": "string or null",
//   "merchantVatNumber": "EE + 9 digits or null",
//   "receiptDate": "YYYY-MM-DD or null",
//   "totalAmount": "number (final total incl. VAT) or null",
//   "vatAmount": "number (VAT portion) or null",
//   "vatRate": "number (24, 13, 9, or 0) or null",
//   "currency": "EUR",
//   "lineItems": [
//     { "description": "string", "quantity": "number or null", "unitPrice": "number or null", "total": "number" }
//   ],
//   "confidence": "number 0.0-1.0 (how readable the receipt is)",
//   "rawText": "all readable text from the image for audit"
// }`;

//     const raw = await this.aiService.scanReceiptImage(base64, mimeType, prompt);
//     return this.aiService.parseReceiptJSON(raw);
//   }

//   // ─── Image fetcher ────────────────────────────────────────────────────────

//   private async fetchImageAsBase64(
//     url: string,
//   ): Promise<{ base64: string; mimeType: string }> {
//     if (url.startsWith('data:')) {
//       const [header, data] = url.split(',');
//       const mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
//       return { base64: data, mimeType };
//     }

//     const response = await fetch(url);
//     if (!response.ok) {
//       throw new BadRequestException(
//         `Could not fetch image from URL: ${response.status}`,
//       );
//     }
//     const buffer = await response.arrayBuffer();
//     const base64 = Buffer.from(buffer).toString('base64');
//     const mimeType = this.detectMimeType(
//       url,
//       response.headers.get('content-type'),
//     );
//     return { base64, mimeType };
//   }

//   private detectMimeType(url: string, contentType: string | null): string {
//     if (contentType?.includes('png')) return 'image/png';
//     if (contentType?.includes('webp')) return 'image/webp';
//     const lower = url.toLowerCase();
//     if (lower.includes('.png')) return 'image/png';
//     if (lower.includes('.webp')) return 'image/webp';
//     return 'image/jpeg';
//   }
// }
