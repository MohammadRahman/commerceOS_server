/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable no-constant-binary-expression */
/* eslint-disable @typescript-eslint/no-unsafe-return */
// apps/api/src/modules/ai/ai.service.ts
// Central AI service — all Claude API calls go through here

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BankStatementParserService } from '../bookkeeping/services/bank-statement-parser.service';

export interface InvoiceParsedData {
  supplierName?: string;
  supplierEmail?: string;
  supplierVatNumber?: string;
  supplierRegNumber?: string;
  supplierIban?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  totalAmount?: number;
  subtotalAmount?: number;
  vatAmount?: number;
  vatRate?: number;
  currency: string;
  description?: string;
  lineItems?: {
    description: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    vatRate?: number;
    total: number;
  }[];
  paymentReference?: string;
  notes?: string;
  confidence: number;
}

export interface BankStatementTransaction {
  date: string;
  valueDate?: string;
  description: string;
  amount: number; // negative = expense, positive = income
  currency: string;
  /** Derived from amount sign — income when amount > 0, expense otherwise */
  type: 'income' | 'expense';
  counterpartyName?: string;
  counterpartyIban?: string;
  referenceNumber?: string;
  transactionId?: string;
  category?: string;
}

export interface BankStatementParsedData {
  bankName: string;
  accountHolder: string;
  iban: string;
  periodFrom: string;
  periodTo: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  transactions: BankStatementTransaction[];
  confidence: number;
}

export interface DailyRevenueParsedData {
  date: string;
  reportSource: string;
  totalRevenue: number;
  currency: string;
  paymentBreakdown?: {
    cash: number;
    card: number;
    online: number;
    other: number;
  };
  transactionCount?: number;
  averageTransactionValue?: number;
  vatIncluded?: boolean | null;
  notes?: string;
  confidence: number;
}
export interface ProductAIResult {
  name: string;
  nameBn: string;
  description: string;
  descriptionBn: string;
  price: number;
  comparePrice: number | null;
  category: string;
  keywords: string[];
  captions: { en: string; bn: string }[];
  stockHint: number;
}

export interface StoreSetupResult {
  name: string;
  description: string;
  descriptionBn: string;
  announcement: string;
  themeColor: string;
  keywords: string[];
  deliveryFee: number;
  heroTitle: string;
  heroSubtitle: string;
  heroCta: string;
}

export interface InboxReplyResult {
  replies: { text: string; tone: string }[];
  intent: 'order' | 'inquiry' | 'complaint' | 'payment' | 'tracking' | 'other';
  suggestedAction: string | null;
  language: 'en' | 'bn' | 'mixed';
}

export interface GrowthInsight {
  type: 'warning' | 'opportunity' | 'tip' | 'achievement';
  title: string;
  message: string;
  action: string | null;
  actionRoute: string | null;
}

export interface GrowthReportResult {
  insights: GrowthInsight[];
  topProduct: string | null;
  fbCaption: string | null;
  weekSummary: string;
}

export interface SeoResult {
  title: string;
  description: string;
  keywords: string;
}

export interface ProductDescriptionResult {
  description: string;
}

export interface FbIgPhoto {
  id: string;
  url: string;
  caption?: string;
  createdAt: string;
}

export type CommentIntentResult = {
  intent:
    | 'price_query'
    | 'buy_intent'
    | 'availability'
    | 'complaint'
    | 'spam'
    | 'other';
  confidence: number;
};

/** Derive income/expense from amount sign — single source of truth */
function deriveType(amount: number): 'income' | 'expense' {
  return amount > 0 ? 'income' : 'expense';
}

// ── Bank statement fallback helpers ───────────────────────────────────────────

/**
 * Attempt to salvage a truncated JSON string produced when the model hit the
 * token limit mid-response. Finds the last fully-closed transaction object and
 * closes the array + outer object so JSON.parse can recover everything before
 * the cut point — typically 80-90% of a large statement.
 *
 * Only used in the AI fallback path (scanned PDFs). Normal PDFs never reach
 * this code because the rule-based parser handles them at zero token cost.
 */
function repairTruncatedJson(raw: string): string {
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  // Already valid — return as-is
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    /* fall through */
  }

  // Walk backwards to find the last `}` that closes a top-level object in the
  // transactions array (depth goes 0 → 1 on `{`, back to 0 on matching `}`)
  let depth = 0;
  let lastCompleteClose = -1;
  for (let i = stripped.length - 1; i >= 0; i--) {
    const ch = stripped[i];
    if (ch === '}') {
      depth++;
      if (depth === 1) lastCompleteClose = i;
    } else if (ch === '{') {
      depth--;
      // Found the opening brace that matches our closing brace at depth 0
      if (depth === 0 && lastCompleteClose !== -1) break;
    }
  }

  if (lastCompleteClose === -1) return stripped; // nothing to salvage

  // Slice up to and including the last complete object, then close array + root
  return stripped.slice(0, lastCompleteClose + 1) + '\n  ]\n}';
}

/**
 * Split extracted statement text into chunks that break only on date-line
 * boundaries, so no transaction is split across two API calls.
 *
 * Only used in the AI fallback path for scanned PDFs longer than ~2 pages.
 */
function splitByDateBoundaries(text: string, maxChars = 3500): string[] {
  if (text.length <= maxChars) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const isDateLine = /^\d{2}\.\d{2}\.\d{4}/.test(line.trim());
    if (isDateLine && current.length >= maxChars) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly CLAUDE_API = 'https://api.anthropic.com/v1/messages';
  private readonly MODEL = 'claude-sonnet-4-5';
  private readonly HAIKU = 'claude-haiku-4-5-20251001';

  constructor(
    private config: ConfigService,
    private http: HttpService,
    private readonly bankParser: BankStatementParserService,
  ) {}

  // ── Core API caller ─────────────────────────────────────────────────────────

  private async callClaude(
    prompt: string,
    imageUrl?: string,
    imageBase64?: string,
    imageMime?: string,
    model?: string,
    maxTokens?: number,
  ): Promise<string> {
    try {
      const apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');
      const content: any[] = [];

      if (imageBase64 && imageMime) {
        if (imageMime === 'application/pdf') {
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: imageBase64,
            },
          });
        } else {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMime,
              data: imageBase64,
            },
          });
        }
      } else if (imageUrl) {
        content.push({ type: 'image', source: { type: 'url', url: imageUrl } });
      }
      content.push({ type: 'text', text: prompt });

      const res = await firstValueFrom(
        this.http.post(
          this.CLAUDE_API,
          {
            model: model ?? this.MODEL,
            max_tokens: maxTokens ?? 1500,
            messages: [{ role: 'user', content }],
          },
          {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
          },
        ),
      );

      return res.data?.content?.[0]?.text ?? '';
    } catch (err: any) {
      this.logger.error(
        `[AI] Anthropic API error: ${JSON.stringify(err?.response?.data ?? err?.message)}`,
      );
      throw new Error(
        err?.response?.data?.error?.message ?? 'AI service failed',
      );
    }
  }

  // ── JSON parser ─────────────────────────────────────────────────────────────

  private parseJSON<T>(text: string, fallback: T): T {
    try {
      const clean = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      try {
        return JSON.parse(clean) as T;
      } catch (error) {
        this.logger.debug(
          `[AI] Full JSON parse failed, trying to extract object/array — error: ${(error as Error).message}`,
        );
      }

      const objStart = clean.indexOf('{');
      const objEnd = clean.lastIndexOf('}');
      if (objStart !== -1 && objEnd !== -1) {
        return JSON.parse(clean.slice(objStart, objEnd + 1)) as T;
      }

      const arrStart = clean.indexOf('[');
      const arrEnd = clean.lastIndexOf(']');
      if (arrStart !== -1 && arrEnd !== -1) {
        return JSON.parse(clean.slice(arrStart, arrEnd + 1)) as T;
      }

      return fallback;
    } catch {
      this.logger.warn(`[AI] JSON parse failed — raw: ${text.slice(0, 300)}`);
      return fallback;
    }
  }

  // ── Product from image ──────────────────────────────────────────────────────

  async generateProductFromImage(
    imageUrl?: string,
    imageBase64?: string,
    imageMime?: string,
    storeName?: string,
    currency = 'BDT',
  ): Promise<ProductAIResult> {
    const prompt = `You are an e-commerce product listing expert for Bangladesh market.
Analyze this product image and generate a complete product listing.

Store context: ${storeName ?? 'BD online shop'}, Currency: ${currency}

Return ONLY valid JSON (no markdown, no explanation):
{
  "name": "Product name in English (concise, searchable)",
  "nameBn": "পণ্যের নাম বাংলায়",
  "description": "Compelling 2-3 sentence English description highlighting key features and benefits",
  "descriptionBn": "বাংলায় ২-৩ বাক্যে পণ্যের বিবরণ, মূল বৈশিষ্ট্য সহ",
  "price": <suggested price in ${currency} as integer, realistic for BD market>,
  "comparePrice": <original/MRP price or null>,
  "category": "Most appropriate category (e.g. Clothing, Electronics, Food, Beauty, Home, etc.)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "captions": [
    {"en": "Engaging Facebook/Instagram caption in English with emojis and CTA", "bn": "বাংলায় আকর্ষণীয় ক্যাপশন ইমোজি সহ"},
    {"en": "Second caption variant focusing on price/deal", "bn": "দাম/অফার কেন্দ্রিক দ্বিতীয় ক্যাপশন"},
    {"en": "Third caption variant — storytelling angle", "bn": "গল্প বলার ধরনে তৃতীয় ক্যাপশন"}
  ],
  "stockHint": <suggested initial stock quantity>
}`;

    const text = await this.callClaude(
      prompt,
      imageUrl,
      imageBase64,
      imageMime,
    );
    return this.parseJSON<ProductAIResult>(text, {
      name: 'Product',
      nameBn: 'পণ্য',
      description: '',
      descriptionBn: '',
      price: 0,
      comparePrice: null,
      category: 'General',
      keywords: [],
      captions: [],
      stockHint: 10,
    });
  }

  // ── Store setup ─────────────────────────────────────────────────────────────

  async generateStoreSetup(
    businessName: string,
    businessType: string,
    targetAudience?: string,
  ): Promise<StoreSetupResult> {
    const prompt = `You are a BD e-commerce store setup expert.
Generate complete store settings for:
Business: "${businessName}"
Type: "${businessType}"
Target: "${targetAudience ?? 'general BD customers'}"

Return ONLY valid JSON:
{
  "name": "Catchy store display name",
  "description": "Compelling 1-2 sentence English store description",
  "descriptionBn": "বাংলায় স্টোরের বিবরণ",
  "announcement": "Short promotional announcement bar text (e.g. '🎉 Free delivery on orders over ৳500!')",
  "themeColor": "<hex color that matches the business type>",
  "keywords": ["seo keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"],
  "deliveryFee": <typical BD delivery fee in BDT>,
  "heroTitle": "Catchy hero banner headline",
  "heroSubtitle": "Supporting hero subtitle",
  "heroCta": "Call to action button text"
}`;

    const text = await this.callClaude(prompt);
    return this.parseJSON<StoreSetupResult>(text, {
      name: businessName,
      description: '',
      descriptionBn: '',
      announcement: null as any,
      themeColor: '#6366f1',
      keywords: [],
      deliveryFee: 60,
      heroTitle: businessName,
      heroSubtitle: 'Quality products',
      heroCta: 'Shop Now',
    });
  }

  // ── Store SEO ───────────────────────────────────────────────────────────────

  async generateStoreSeo(
    storeName: string,
    storeDescription?: string,
    storeSlug?: string,
    storeUrl?: string,
  ): Promise<SeoResult> {
    const prompt = `You are an SEO expert. Generate optimized SEO metadata for an e-commerce store.

Store name: ${storeName}
${storeDescription ? `Description: ${storeDescription}` : ''}
${storeSlug ? `URL slug: ${storeSlug}` : ''}
${storeUrl ? `URL: ${storeUrl}` : ''}

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "SEO title 50-60 chars — store name + main product category or key benefit",
  "description": "Meta description 150-160 chars — compelling, include benefits and a call to action",
  "keywords": "comma-separated 8-12 keywords, mix of broad and specific, relevant to the store"
}`;

    const text = await this.callClaude(
      prompt,
      undefined,
      undefined,
      undefined,
      this.HAIKU,
      400,
    );
    return this.parseJSON<SeoResult>(text, {
      title: `${storeName} — Shop Online`,
      description: `Shop quality products at ${storeName}. Fast delivery, great prices, easy returns.`,
      keywords: `${storeName.toLowerCase()}, online shop, buy online`,
    });
  }

  // ── Product SEO ─────────────────────────────────────────────────────────────

  async generateProductSeo(
    productName: string,
    productDescription?: string,
    productUrl?: string,
  ): Promise<SeoResult> {
    const prompt = `You are an SEO expert. Generate optimized SEO metadata for a product page.

Product name: ${productName}
${productDescription ? `Description: ${productDescription}` : ''}
${productUrl ? `URL: ${productUrl}` : ''}

Return ONLY valid JSON (no markdown, no explanation):
{
  "title": "SEO title 50-60 chars — product name + key benefit or use case",
  "description": "Meta description 150-160 chars — product benefits, who it is for, CTA to buy",
  "keywords": "comma-separated 6-10 keywords: product type, materials, use cases, synonyms"
}`;

    const text = await this.callClaude(
      prompt,
      undefined,
      undefined,
      undefined,
      this.HAIKU,
      400,
    );
    return this.parseJSON<SeoResult>(text, {
      title: productName,
      description: `Buy ${productName} online. Quality guaranteed, fast delivery.`,
      keywords: productName.toLowerCase().split(' ').join(', '),
    });
  }

  // ── Product description from name ───────────────────────────────────────────

  async generateProductDescription(
    productName: string,
    storeName?: string,
  ): Promise<ProductDescriptionResult> {
    const prompt = `Write a compelling e-commerce product description for: "${productName}"
${storeName ? `Store: ${storeName}` : ''}

Requirements:
- 2-3 sentences maximum
- Focus on benefits not just features
- Natural persuasive tone
- Suitable for Bangladeshi/South Asian market if relevant
- No bullet points, no markdown

Return ONLY the description text, nothing else.`;

    const text = await this.callClaude(
      prompt,
      undefined,
      undefined,
      undefined,
      this.HAIKU,
      200,
    );
    return { description: text.trim() };
  }

  // ── Instagram photos ─────────────────────────────────────────────────────────

  async fetchInstagramPhotos(
    igBusinessId: string,
    accessToken: string,
    limit = 50,
  ): Promise<FbIgPhoto[]> {
    try {
      const url = new URL(
        `https://graph.facebook.com/v19.0/${igBusinessId}/media`,
      );
      url.searchParams.set(
        'fields',
        'id,media_url,caption,timestamp,media_type',
      );
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('access_token', accessToken);

      const res = await firstValueFrom(this.http.get(url.toString()));
      const data = res.data as any;

      if (!Array.isArray(data?.data)) return [];

      return (data.data as any[])
        .filter(
          (m) => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM',
        )
        .map((m) => ({
          id: m.id as string,
          url: m.media_url as string,
          caption: m.caption as string | undefined,
          createdAt: m.timestamp as string,
        }))
        .filter((m) => !!m.url);
    } catch (err: any) {
      this.logger.warn(`[AI] Instagram photos fetch failed: ${err?.message}`);
      return [];
    }
  }

  // ── Facebook photos ──────────────────────────────────────────────────────────

  async fetchFacebookPagePhotos(
    pageId: string,
    accessToken: string,
    limit = 20,
  ): Promise<FbIgPhoto[]> {
    try {
      const res = await firstValueFrom(
        this.http.get(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
          params: {
            fields: 'images,name,created_time',
            limit,
            type: 'uploaded',
            access_token: accessToken,
          },
        }),
      );

      const photos = (res.data?.data ?? []) as any[];
      return photos
        .map((p) => ({
          id: p.id as string,
          url: (p.images?.[0]?.source ?? '') as string,
          caption: p.name as string | undefined,
          createdAt: p.created_time as string,
        }))
        .filter((p) => !!p.url);
    } catch (err: any) {
      this.logger.warn(`[AI] FB photos fetch failed: ${err?.message}`);
      return [];
    }
  }

  // ── Inbox reply ──────────────────────────────────────────────────────────────

  async generateInboxReply(
    customerMessage: string,
    storeName: string,
    conversationHistory?: string,
    orderContext?: string,
  ): Promise<InboxReplyResult> {
    const prompt = `You are a helpful customer service agent for "${storeName}", a BD e-commerce store.

Customer message: "${customerMessage}"
${conversationHistory ? `Recent conversation:\n${conversationHistory}` : ''}
${orderContext ? `Order context: ${orderContext}` : ''}

Return ONLY valid JSON:
{
  "replies": [
    {"text": "Friendly professional reply", "tone": "professional"},
    {"text": "Warm casual reply", "tone": "friendly"},
    {"text": "Brief direct reply", "tone": "brief"}
  ],
  "intent": "<one of: order|inquiry|complaint|payment|tracking|other>",
  "suggestedAction": "<null or one of: create_order|send_payment_link|book_courier|show_tracking>",
  "language": "<en|bn|mixed>"
}`;

    const text = await this.callClaude(prompt);
    return this.parseJSON<InboxReplyResult>(text, {
      replies: [
        {
          text: 'Thank you for your message! How can I help you?',
          tone: 'professional',
        },
      ],
      intent: 'other',
      suggestedAction: null,
      language: 'en',
    });
  }

  // ── Growth report ────────────────────────────────────────────────────────────

  async generateGrowthReport(
    orgStats: {
      totalOrders: number;
      totalRevenue: number;
      topProducts: string[];
      lowStockProducts: string[];
      noDescriptionProducts: string[];
      avgOrderValue: number;
      pendingOrders: number;
    },
    storeName: string,
  ): Promise<GrowthReportResult> {
    const prompt = `You are a BD e-commerce growth advisor for "${storeName}".

Store stats this week:
- Total orders: ${orgStats.totalOrders}
- Revenue: ৳${orgStats.totalRevenue}
- Avg order: ৳${orgStats.avgOrderValue}
- Pending orders: ${orgStats.pendingOrders}
- Top products: ${orgStats.topProducts.join(', ') || 'none'}
- Low stock: ${orgStats.lowStockProducts.join(', ') || 'none'}
- No description: ${orgStats.noDescriptionProducts.join(', ') || 'none'}

Return ONLY valid JSON:
{
  "insights": [
    {"type": "warning|opportunity|tip|achievement", "title": "Short title", "message": "Actionable 1-2 sentence insight", "action": "Button text or null", "actionRoute": "/route or null"}
  ],
  "topProduct": "Name of top product or null",
  "fbCaption": "Ready-to-post Facebook promotional caption for top product with emojis",
  "weekSummary": "1 sentence positive week summary"
}

Generate 3-5 insights. Be specific and actionable for BD market.`;

    const text = await this.callClaude(prompt);
    return this.parseJSON<GrowthReportResult>(text, {
      insights: [],
      topProduct: null,
      fbCaption: null,
      weekSummary: 'Keep growing!',
    });
  }

  // ── Comment intent classification ────────────────────────────────────────────

  async classifyCommentIntent(text: string): Promise<CommentIntentResult> {
    const prompt = `Classify this social media comment into exactly one intent category.
Comment: "${text}"

Categories:
- price_query: asking about price, cost, rate, কত, দাম
- buy_intent: wants to buy, interested, inbox, DM, order
- availability: asking if available, আছে, stock
- complaint: negative, unhappy, problem
- spam: irrelevant, promotional, repeated
- other: anything else

Respond with JSON only, no markdown: {"intent":"<category>","confidence":<0.0-1.0>}`;

    try {
      const raw = await this.callClaude(
        prompt,
        undefined,
        undefined,
        undefined,
        this.HAIKU,
        100,
      );
      const parsed = this.parseJSON<{ intent: string; confidence: number }>(
        raw,
        {
          intent: 'other',
          confidence: 0.5,
        },
      );
      return {
        intent: (parsed.intent as CommentIntentResult['intent']) ?? 'other',
        confidence: Number(parsed.confidence) ?? 0.5,
      };
    } catch (err: any) {
      this.logger.warn(`[AI] Comment classification failed: ${err?.message}`);
      return { intent: 'other', confidence: 0 };
    }
  }

  async scanReceiptImage(
    imageBase64: string,
    imageMime: string,
    prompt: string,
  ): Promise<string> {
    return this.callClaude(
      prompt,
      undefined,
      imageBase64,
      imageMime,
      this.MODEL,
      1024,
    );
  }

  parseReceiptJSON(
    raw: string,
  ): import('../bookkeeping/entities/bookkeeping.entities').ReceiptParsedData {
    const parsed = this.parseJSON<{
      merchantName?: string;
      merchantVatNumber?: string;
      receiptDate?: string;
      totalAmount?: number;
      vatAmount?: number;
      vatRate?: number;
      currency?: string;
      lineItems?: Array<{
        description: string;
        quantity?: number;
        unitPrice?: number;
        total: number;
      }>;
      confidence: number;
      rawText?: string;
    }>(raw, { confidence: 0 });

    return {
      merchantName: parsed.merchantName,
      merchantVatNumber: parsed.merchantVatNumber,
      receiptDate: parsed.receiptDate,
      totalAmount: parsed.totalAmount ? Number(parsed.totalAmount) : undefined,
      vatAmount: parsed.vatAmount ? Number(parsed.vatAmount) : undefined,
      vatRate: parsed.vatRate ? Number(parsed.vatRate) : undefined,
      currency: parsed.currency ?? 'EUR',
      lineItems: parsed.lineItems ?? [],
      confidence: Number(parsed.confidence) || 0,
      rawText: parsed.rawText,
    };
  }

  async parseInvoicePdf(
    pdfBase64: string,
    hint?: { supplierEmail?: string; subject?: string },
  ): Promise<InvoiceParsedData> {
    const contextHint = hint
      ? `Context: Email from ${hint.supplierEmail ?? 'unknown'}, subject: "${hint.subject ?? ''}".`
      : '';

    const prompt = `You are an expert invoice parser for Estonian and EU businesses.
${contextHint}
Parse this invoice PDF and extract all available financial data.

Return ONLY valid JSON (no markdown, no explanation):
{
  "supplierName": "Seller/vendor company name",
  "supplierEmail": "seller email if visible or null",
  "supplierVatNumber": "VAT/KM registration number e.g. EE123456789 or null",
  "supplierRegNumber": "Company registration number or null",
  "supplierIban": "Seller bank IBAN if shown or null",
  "invoiceNumber": "Invoice number/ID or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "totalAmount": <total payable including VAT as number>,
  "subtotalAmount": <amount before VAT or null>,
  "vatAmount": <VAT amount as number or null>,
  "vatRate": <VAT % e.g. 22 or null>,
  "currency": "EUR",
  "description": "One sentence summary of what was purchased",
  "lineItems": [
    {
      "description": "item/service name",
      "quantity": 1,
      "unit": "unit/hour/kg/etc",
      "unitPrice": 10.00,
      "vatRate": 22,
      "total": 12.20
    }
  ],
  "paymentReference": "Payment reference number or null",
  "notes": "Any important notes or payment terms or null",
  "confidence": <0.0-1.0 confidence in extraction quality>
}

Estonian VAT (KM) rates: 22% standard, 9% reduced (books, medicine, hotels), 0% exports.
If the document is not an invoice, return { "confidence": 0 }.`;

    const raw = await this.callClaude(
      prompt,
      undefined,
      pdfBase64,
      'application/pdf',
      this.MODEL,
      2000,
    );
    return this.parseInvoiceData(raw);
  }

  /**
   * Parse a bank statement PDF.
   *
   * Cost tiers (cheapest → most expensive):
   *
   *   Tier 1 — Rules (0 tokens, ~0ms extra):
   *     pdf-parse extracts text → bank regex pulls all transactions.
   *     Covers 95%+ of real bank PDFs from Swedbank/SEB/LHV/Luminor/Coop.
   *     After this succeeds, one Haiku batch call categorises all tx (~$0.001).
   *
   *   Tier 2 — Haiku text fallback (~$0.001-0.003, scanned PDFs only):
   *     pdf-parse returned null (scanned/image PDF).
   *     We send the RAW TEXT we already extracted (not the PDF binary) to Haiku.
   *     For large statements (>3500 chars extracted text) we chunk by date
   *     boundary and make one Haiku call per chunk, then merge.
   *     max_tokens capped at 4096 per chunk — enough for ~60 transactions.
   *
   *   Tier 3 — Sonnet PDF fallback (~$0.01-0.05, truly unreadable PDFs):
   *     pdf-parse returned null AND we have no extracted text at all
   *     (e.g. a pure image-scan with no text layer whatsoever).
   *     Only then do we send the PDF binary to Sonnet, which can OCR images.
   *     max_tokens 4096 with repairTruncatedJson to salvage partial output.
   */
  async parseBankStatementPdf(
    pdfBase64: string,
    bankHint?: string,
    filename = '',
  ): Promise<BankStatementParsedData> {
    // ── Tier 1: rule-based parse (zero tokens) ────────────────────────────
    const parsed = await this.bankParser.parse(pdfBase64, bankHint, filename);

    if (parsed && parsed.transactions.length > 0) {
      this.logger.log(
        `[BankStatement] Rules extracted ${parsed.transactions.length} tx — ` +
          'running Haiku batch categorisation',
      );

      const descriptions = parsed.transactions.map((t) =>
        [t.description, t.counterpartyName].filter(Boolean).join(' | '),
      );
      const categories = await this.categorizeBatch(descriptions);

      const transactions: BankStatementTransaction[] = parsed.transactions.map(
        (t, i) => ({
          date: t.date,
          valueDate: t.valueDate,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          type: t.type,
          counterpartyName: t.counterpartyName,
          counterpartyIban: t.counterpartyIban,
          referenceNumber: t.referenceNumber,
          transactionId: t.transactionId,
          category: categories[i] ?? 'Other',
        }),
      );

      this.logger.log(
        `[BankStatement] Final: ${transactions.length} transactions ` +
          `(income: ${transactions.filter((t) => t.type === 'income').length}, ` +
          `expense: ${transactions.filter((t) => t.type === 'expense').length})`,
      );

      return {
        bankName: parsed.bankName,
        accountHolder: parsed.accountHolder,
        iban: parsed.iban,
        periodFrom: parsed.periodFrom,
        periodTo: parsed.periodTo,
        currency: parsed.currency,
        openingBalance: parsed.openingBalance,
        closingBalance: parsed.closingBalance,
        transactions,
        confidence: 0.95,
      };
    }

    // ── Tier 2 & 3: AI fallback for scanned/image PDFs ───────────────────
    this.logger.warn(
      '[BankStatement] Rule-based parse returned 0 tx — entering AI fallback',
    );

    // Try to get whatever text the PDF does have — even partial text from a
    // mixed scan can be enough for Haiku to extract transactions cheaply.
    const rawText = await this.bankParser.extractText(pdfBase64);

    if (rawText) {
      // ── Tier 2: send extracted TEXT to Haiku (cheap) ──────────────────
      this.logger.log(
        `[BankStatement] Haiku text fallback — ${rawText.length} chars extracted`,
      );
      return await this.haikustatementFromText(rawText, bankHint, filename);
    }

    // ── Tier 3: truly unreadable — send PDF binary to Sonnet (OCR) ───────
    // This only fires when pdf-parse returned null (pure image scan, no text
    // layer at all). Sonnet can read image-PDFs; Haiku cannot.
    this.logger.warn(
      '[BankStatement] No text extracted — Sonnet OCR fallback (most expensive path)',
    );
    return await this.sonnetStatementFromPdf(pdfBase64, bankHint);
  }

  /**
   * Tier 2: parse extracted text with Haiku.
   * Chunks large statements so each call stays well within 4096 output tokens.
   * Merges results and returns the combined statement.
   */
  private async haikustatementFromText(
    rawText: string,
    bankHint: string | undefined,
    filename: string,
  ): Promise<BankStatementParsedData> {
    const CHUNK_CHARS = 3500; // ~1-2 statement pages per call
    const chunks = splitByDateBoundaries(rawText, CHUNK_CHARS);

    this.logger.log(
      `[BankStatement] Haiku fallback: ${chunks.length} chunk(s) for ${rawText.length} chars`,
    );

    const allTransactions: BankStatementTransaction[] = [];
    let baseInfo: Partial<BankStatementParsedData> = {};

    for (let i = 0; i < chunks.length; i++) {
      this.logger.log(`[BankStatement] Haiku chunk ${i + 1}/${chunks.length}`);
      try {
        const result = await this.callHaikuStatementChunk(
          chunks[i],
          bankHint,
          i === 0, // only ask for header fields on the first chunk
        );
        if (result.transactions.length > 0) {
          allTransactions.push(...result.transactions);
          if (!baseInfo.bankName && result.bankName) {
            baseInfo = { ...result };
          }
        }
      } catch (err) {
        this.logger.warn(`[BankStatement] Haiku chunk ${i + 1} failed: ${err}`);
      }
    }

    if (allTransactions.length === 0) {
      this.logger.warn('[BankStatement] Haiku text fallback found 0 tx');
      return this.emptyStatement();
    }

    return {
      bankName: baseInfo.bankName ?? 'Unknown',
      accountHolder: baseInfo.accountHolder ?? '',
      iban: baseInfo.iban ?? '',
      periodFrom: baseInfo.periodFrom ?? '',
      periodTo: baseInfo.periodTo ?? '',
      currency: baseInfo.currency ?? 'EUR',
      openingBalance: baseInfo.openingBalance ?? 0,
      closingBalance: baseInfo.closingBalance ?? 0,
      transactions: allTransactions,
      confidence: 0.82,
    };
  }

  /**
   * One Haiku call for a single text chunk.
   * Sends plain text — NOT a PDF binary — so input tokens are tiny.
   * max_tokens: 4096 (enough for ~60-80 transactions as JSON).
   * repairTruncatedJson handles the rare case where output is still cut short.
   */
  private async callHaikuStatementChunk(
    textChunk: string,
    bankHint: string | undefined,
    includeHeader: boolean,
  ): Promise<BankStatementParsedData> {
    const bankCtx = bankHint
      ? `This is a ${bankHint.toUpperCase()} bank statement.`
      : '';

    const headerFields = includeHeader
      ? `  "bankName": "LHV / SEB / Swedbank / Luminor / Coop",
  "accountHolder": "Full name",
  "iban": "Account IBAN",
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "currency": "EUR",
  "openingBalance": 0.00,
  "closingBalance": 0.00,`
      : `  "bankName": "",
  "accountHolder": "",
  "iban": "",
  "periodFrom": "",
  "periodTo": "",
  "currency": "EUR",
  "openingBalance": 0,
  "closingBalance": 0,`;

    // Tight prompt — Haiku needs less hand-holding than Sonnet
    const prompt = `Parse all bank transactions from this statement text. ${bankCtx}
Negative amounts = expenses (money out). Positive = income (money in).
Return RAW JSON only — no markdown, no explanation.

{
${headerFields}
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "narration",
      "amount": -12.50,
      "currency": "EUR",
      "type": "expense",
      "counterpartyName": "name or null",
      "counterpartyIban": "IBAN or null",
      "referenceNumber": "ref or null",
      "category": "Food|Fuel|Rent|Telecoms|Payroll|Taxes|Utilities|Software|Marketing|Income|Other"
    }
  ],
  "confidence": 0.85
}

STATEMENT TEXT:
${textChunk}`;

    const raw = await this.callClaude(
      prompt,
      undefined,
      undefined,
      undefined,
      this.HAIKU,
      4096, // enough for ~60-80 transactions; chunking handles larger volumes
    );

    return this.parseBankStatementData(raw);
  }

  /**
   * Tier 3: Sonnet OCR fallback for pure image-scan PDFs (no text layer).
   * Sends the PDF binary — Sonnet can read image content, Haiku cannot.
   * Only reached when pdf-parse returns null (no text extractable at all).
   * max_tokens: 4096 with repair — keeps cost bounded while still capturing
   * the majority of transactions before any truncation point.
   */
  private async sonnetStatementFromPdf(
    pdfBase64: string,
    bankHint: string | undefined,
  ): Promise<BankStatementParsedData> {
    const bankCtx = bankHint
      ? `This is a ${bankHint.toUpperCase()} bank statement.`
      : '';

    const prompt = `You are an expert bank statement parser for Estonian banks. ${bankCtx}
This is a scanned image PDF — extract ALL transactions visible in the document.
Negative amounts = expenses. Positive = income.
Return RAW JSON only — no markdown, no explanation, start with {

{
  "bankName": "LHV / SEB / Swedbank / Luminor / Coop",
  "accountHolder": "Full name",
  "iban": "Account IBAN",
  "periodFrom": "YYYY-MM-DD",
  "periodTo": "YYYY-MM-DD",
  "currency": "EUR",
  "openingBalance": 0.00,
  "closingBalance": 0.00,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "narration",
      "amount": -12.50,
      "currency": "EUR",
      "type": "expense",
      "counterpartyName": "name or null",
      "counterpartyIban": "IBAN or null",
      "referenceNumber": "ref or null",
      "category": "Food|Fuel|Rent|Telecoms|Payroll|Taxes|Utilities|Software|Marketing|Income|Other"
    }
  ],
  "confidence": 0.75
}`;

    const raw = await this.callClaude(
      prompt,
      undefined,
      pdfBase64,
      'application/pdf',
      this.MODEL, // Sonnet — required for image/PDF vision
      4096, // bounded; repairTruncatedJson salvages partial output
    );

    this.logger.debug(`[BankStatement] Sonnet OCR raw: ${raw.slice(0, 200)}`);
    return this.parseBankStatementData(raw);
  }

  async parseDailyRevenueEmail(
    emailBody: string,
    emailSubject: string,
    emailDate: string,
  ): Promise<DailyRevenueParsedData> {
    const prompt = `You are a revenue data extraction expert for restaurants and retail businesses.
Parse this daily sales/revenue report email and extract the total revenue figure.

Email subject: "${emailSubject}"
Email date: ${emailDate}

Look for these fields (not all may be present):
- Total sales / net sales / gross revenue / päevakäive / kogu müük
- Payment method breakdown (cash/card/online)
- Number of transactions/covers
- Average transaction value

Common report formats: Poster POS, iiko, Bolt Food daily summary, Wolt partner report,
Forkeeps, Lightspeed, Square, custom restaurant systems.

Return ONLY valid JSON:
{
  "date": "${emailDate.slice(0, 10)}",
  "reportSource": "System/platform name e.g. Poster POS, Bolt Food, Wolt",
  "totalRevenue": <total revenue as positive number>,
  "currency": "EUR",
  "paymentBreakdown": {
    "cash": 0,
    "card": 0,
    "online": 0,
    "other": 0
  },
  "transactionCount": <number of transactions or null>,
  "averageTransactionValue": <average or null>,
  "vatIncluded": <true if revenue is VAT-inclusive, false if ex-VAT, null if unknown>,
  "notes": "Any special notes or null",
  "confidence": <0.0-1.0>
}

If no revenue figure can be found, return { "confidence": 0, "totalRevenue": 0, "currency": "EUR", "date": "${emailDate.slice(0, 10)}", "reportSource": "unknown" }.`;

    const raw = await this.callClaude(
      prompt + '\n\nEmail body:\n' + emailBody.slice(0, 3000),
      undefined,
      undefined,
      undefined,
      this.HAIKU,
      800,
    );
    return this.parseDailyRevenueData(raw);
  }

  private parseInvoiceData(raw: string): InvoiceParsedData {
    const parsed = this.parseJSON<InvoiceParsedData>(raw, {
      currency: 'EUR',
      confidence: 0,
    });
    return {
      ...parsed,
      totalAmount: parsed.totalAmount ? Number(parsed.totalAmount) : undefined,
      subtotalAmount: parsed.subtotalAmount
        ? Number(parsed.subtotalAmount)
        : undefined,
      vatAmount: parsed.vatAmount ? Number(parsed.vatAmount) : undefined,
      currency: parsed.currency ?? 'EUR',
      confidence: Number(parsed.confidence) || 0,
    };
  }

  /**
   * Parse the raw JSON string from any AI bank statement call.
   * Applies repairTruncatedJson before the final parse attempt so partially-
   * written responses (token limit hit mid-array) still yield valid transactions.
   */
  private parseBankStatementData(raw: string): BankStatementParsedData {
    const empty = this.emptyStatement();

    // 1. Strip markdown fences and try a clean parse
    const clean = raw
      .replace(/^```json\s*/gi, '')
      .replace(/```\s*$/g, '')
      .trim();

    let parsed: BankStatementParsedData | null = null;

    try {
      parsed = JSON.parse(clean) as BankStatementParsedData;
    } catch {
      // 2. Try extracting the outermost JSON object
      const objStart = clean.indexOf('{');
      const objEnd = clean.lastIndexOf('}');
      if (objStart !== -1 && objEnd !== -1) {
        try {
          parsed = JSON.parse(
            clean.slice(objStart, objEnd + 1),
          ) as BankStatementParsedData;
        } catch {
          // 3. Attempt repair for truncated output (token limit hit mid-array)
          try {
            const repaired = repairTruncatedJson(clean.slice(objStart));
            parsed = JSON.parse(repaired) as BankStatementParsedData;
            this.logger.warn(
              `[AI] Repaired truncated JSON — salvaged ` +
                `${(parsed as any)?.transactions?.length ?? 0} transactions`,
            );
          } catch (repairErr) {
            this.logger.warn(`[AI] JSON repair failed: ${repairErr}`);
            return empty;
          }
        }
      } else {
        this.logger.warn(`[AI] JSON parse failed — raw: ${raw.slice(0, 300)}`);
        return empty;
      }
    }

    if (!parsed?.transactions?.length) return empty;

    const transactions: BankStatementTransaction[] = parsed.transactions.map(
      (t) => {
        const amount = Number(t.amount) || 0;
        return { ...t, amount, type: deriveType(amount) };
      },
    );

    return {
      bankName: parsed.bankName ?? 'Unknown',
      accountHolder: parsed.accountHolder ?? '',
      iban: parsed.iban ?? '',
      periodFrom: parsed.periodFrom ?? '',
      periodTo: parsed.periodTo ?? '',
      currency: parsed.currency ?? 'EUR',
      openingBalance: Number(parsed.openingBalance) || 0,
      closingBalance: Number(parsed.closingBalance) || 0,
      transactions,
      confidence: Number(parsed.confidence) || 0,
    };
  }

  private parseDailyRevenueData(raw: string): DailyRevenueParsedData {
    const parsed = this.parseJSON<DailyRevenueParsedData>(raw, {
      date: new Date().toISOString().split('T')[0],
      reportSource: 'unknown',
      totalRevenue: 0,
      currency: 'EUR',
      confidence: 0,
    });
    return {
      ...parsed,
      totalRevenue: Number(parsed.totalRevenue) || 0,
      confidence: Number(parsed.confidence) || 0,
    };
  }

  private emptyStatement(): BankStatementParsedData {
    return {
      bankName: 'Unknown',
      accountHolder: '',
      iban: '',
      periodFrom: '',
      periodTo: '',
      currency: 'EUR',
      openingBalance: 0,
      closingBalance: 0,
      transactions: [],
      confidence: 0,
    };
  }

  /**
   * Batch-categorise transaction descriptions using a single Haiku call.
   * Returns a string[] in the same order as the input.
   * Falls back to 'Other' for any unparseable entries.
   */
  async categorizeBatch(descriptions: string[]): Promise<string[]> {
    if (descriptions.length === 0) return [];

    const BATCH = 150;
    if (descriptions.length > BATCH) {
      const results: string[] = [];
      for (let i = 0; i < descriptions.length; i += BATCH) {
        const chunk = descriptions.slice(i, i + BATCH);
        const cats = await this.categorizeBatch(chunk);
        results.push(...cats);
      }
      return results;
    }

    const prompt = `Categorise each bank transaction into exactly one category.
Valid categories: Fuel, Rent, Telecoms, Payroll, Taxes, Utilities, Food, Income, Software, Marketing, Other

Return a JSON array of strings, one per transaction, in the same order.
Example: ["Food","Fuel","Income","Other"]

Transactions:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY the JSON array, nothing else.`;

    try {
      const raw = await this.callClaude(
        prompt,
        undefined,
        undefined,
        undefined,
        this.HAIKU,
        Math.min(descriptions.length * 15 + 50, 2000),
      );

      const clean = raw
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();
      const arrStart = clean.indexOf('[');
      const arrEnd = clean.lastIndexOf(']');
      if (arrStart === -1 || arrEnd === -1) throw new Error('No array found');

      const categories = JSON.parse(
        clean.slice(arrStart, arrEnd + 1),
      ) as string[];

      while (categories.length < descriptions.length) {
        categories.push('Other');
      }

      return categories.slice(0, descriptions.length);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[AI] categorizeBatch failed: ${msg} — defaulting to Other`,
      );
      return descriptions.map(() => 'Other');
    }
  }
}
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// /* eslint-disable no-constant-binary-expression */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// // apps/api/src/modules/ai/ai.service.ts
// // Central AI service — all Claude API calls go through here

// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';
// import { BankStatementParserService } from '../bookkeeping/services/bank-statement-parser.service';

// export interface InvoiceParsedData {
//   supplierName?: string;
//   supplierEmail?: string;
//   supplierVatNumber?: string;
//   supplierRegNumber?: string;
//   supplierIban?: string;
//   invoiceNumber?: string;
//   invoiceDate?: string;
//   dueDate?: string;
//   totalAmount?: number;
//   subtotalAmount?: number;
//   vatAmount?: number;
//   vatRate?: number;
//   currency: string;
//   description?: string;
//   lineItems?: {
//     description: string;
//     quantity?: number;
//     unit?: string;
//     unitPrice?: number;
//     vatRate?: number;
//     total: number;
//   }[];
//   paymentReference?: string;
//   notes?: string;
//   confidence: number;
// }

// // FIX #3: `type` field added to every transaction so the DB layer can
// // store income vs expense without re-deriving the sign.
// export interface BankStatementTransaction {
//   date: string;
//   valueDate?: string;
//   description: string;
//   amount: number; // negative = expense, positive = income
//   currency: string;
//   /** Derived from amount sign — income when amount > 0, expense otherwise */
//   type: 'income' | 'expense';
//   counterpartyName?: string;
//   counterpartyIban?: string;
//   referenceNumber?: string;
//   transactionId?: string;
//   category?: string;
// }

// export interface BankStatementParsedData {
//   bankName: string;
//   accountHolder: string;
//   iban: string;
//   periodFrom: string;
//   periodTo: string;
//   currency: string;
//   openingBalance: number;
//   closingBalance: number;
//   transactions: BankStatementTransaction[];
//   confidence: number;
// }

// export interface DailyRevenueParsedData {
//   date: string;
//   reportSource: string;
//   totalRevenue: number;
//   currency: string;
//   paymentBreakdown?: {
//     cash: number;
//     card: number;
//     online: number;
//     other: number;
//   };
//   transactionCount?: number;
//   averageTransactionValue?: number;
//   vatIncluded?: boolean | null;
//   notes?: string;
//   confidence: number;
// }
// export interface ProductAIResult {
//   name: string;
//   nameBn: string;
//   description: string;
//   descriptionBn: string;
//   price: number;
//   comparePrice: number | null;
//   category: string;
//   keywords: string[];
//   captions: { en: string; bn: string }[];
//   stockHint: number;
// }

// export interface StoreSetupResult {
//   name: string;
//   description: string;
//   descriptionBn: string;
//   announcement: string;
//   themeColor: string;
//   keywords: string[];
//   deliveryFee: number;
//   heroTitle: string;
//   heroSubtitle: string;
//   heroCta: string;
// }

// export interface InboxReplyResult {
//   replies: { text: string; tone: string }[];
//   intent: 'order' | 'inquiry' | 'complaint' | 'payment' | 'tracking' | 'other';
//   suggestedAction: string | null;
//   language: 'en' | 'bn' | 'mixed';
// }

// export interface GrowthInsight {
//   type: 'warning' | 'opportunity' | 'tip' | 'achievement';
//   title: string;
//   message: string;
//   action: string | null;
//   actionRoute: string | null;
// }

// export interface GrowthReportResult {
//   insights: GrowthInsight[];
//   topProduct: string | null;
//   fbCaption: string | null;
//   weekSummary: string;
// }

// export interface SeoResult {
//   title: string;
//   description: string;
//   keywords: string;
// }

// export interface ProductDescriptionResult {
//   description: string;
// }

// export interface FbIgPhoto {
//   id: string;
//   url: string;
//   caption?: string;
//   createdAt: string;
// }

// export type CommentIntentResult = {
//   intent:
//     | 'price_query'
//     | 'buy_intent'
//     | 'availability'
//     | 'complaint'
//     | 'spam'
//     | 'other';
//   confidence: number;
// };

// /** Derive income/expense from amount sign — single source of truth */
// function deriveType(amount: number): 'income' | 'expense' {
//   return amount > 0 ? 'income' : 'expense';
// }

// @Injectable()
// export class AiService {
//   private readonly logger = new Logger(AiService.name);
//   private readonly CLAUDE_API = 'https://api.anthropic.com/v1/messages';
//   private readonly MODEL = 'claude-sonnet-4-5';
//   private readonly HAIKU = 'claude-haiku-4-5-20251001';

//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//     private readonly bankParser: BankStatementParserService,
//   ) {}

//   // ── Core API caller ─────────────────────────────────────────────────────────

//   private async callClaude(
//     prompt: string,
//     imageUrl?: string,
//     imageBase64?: string,
//     imageMime?: string,
//     model?: string,
//     maxTokens?: number,
//   ): Promise<string> {
//     try {
//       const apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');
//       const content: any[] = [];

//       if (imageBase64 && imageMime) {
//         if (imageMime === 'application/pdf') {
//           content.push({
//             type: 'document',
//             source: {
//               type: 'base64',
//               media_type: 'application/pdf',
//               data: imageBase64,
//             },
//           });
//         } else {
//           content.push({
//             type: 'image',
//             source: {
//               type: 'base64',
//               media_type: imageMime,
//               data: imageBase64,
//             },
//           });
//         }
//       } else if (imageUrl) {
//         content.push({ type: 'image', source: { type: 'url', url: imageUrl } });
//       }
//       content.push({ type: 'text', text: prompt });

//       const res = await firstValueFrom(
//         this.http.post(
//           this.CLAUDE_API,
//           {
//             model: model ?? this.MODEL,
//             max_tokens: maxTokens ?? 1500,
//             messages: [{ role: 'user', content }],
//           },
//           {
//             headers: {
//               'x-api-key': apiKey,
//               'anthropic-version': '2023-06-01',
//               'content-type': 'application/json',
//             },
//           },
//         ),
//       );

//       return res.data?.content?.[0]?.text ?? '';
//     } catch (err: any) {
//       this.logger.error(
//         `[AI] Anthropic API error: ${JSON.stringify(err?.response?.data ?? err?.message)}`,
//       );
//       throw new Error(
//         err?.response?.data?.error?.message ?? 'AI service failed',
//       );
//     }
//   }

//   // ── JSON parser ─────────────────────────────────────────────────────────────

//   private parseJSON<T>(text: string, fallback: T): T {
//     try {
//       const clean = text
//         .replace(/```json\s*/gi, '')
//         .replace(/```\s*/g, '')
//         .trim();

//       try {
//         return JSON.parse(clean) as T;
//       } catch (error) {
//         this.logger.debug(
//           `[AI] Full JSON parse failed, trying to extract object/array — error: ${(error as Error).message}`,
//         );
//       }

//       const objStart = clean.indexOf('{');
//       const objEnd = clean.lastIndexOf('}');
//       if (objStart !== -1 && objEnd !== -1) {
//         return JSON.parse(clean.slice(objStart, objEnd + 1)) as T;
//       }

//       const arrStart = clean.indexOf('[');
//       const arrEnd = clean.lastIndexOf(']');
//       if (arrStart !== -1 && arrEnd !== -1) {
//         return JSON.parse(clean.slice(arrStart, arrEnd + 1)) as T;
//       }

//       return fallback;
//     } catch {
//       this.logger.warn(`[AI] JSON parse failed — raw: ${text.slice(0, 300)}`);
//       return fallback;
//     }
//   }

//   // ── Product from image ──────────────────────────────────────────────────────

//   async generateProductFromImage(
//     imageUrl?: string,
//     imageBase64?: string,
//     imageMime?: string,
//     storeName?: string,
//     currency = 'BDT',
//   ): Promise<ProductAIResult> {
//     const prompt = `You are an e-commerce product listing expert for Bangladesh market.
// Analyze this product image and generate a complete product listing.

// Store context: ${storeName ?? 'BD online shop'}, Currency: ${currency}

// Return ONLY valid JSON (no markdown, no explanation):
// {
//   "name": "Product name in English (concise, searchable)",
//   "nameBn": "পণ্যের নাম বাংলায়",
//   "description": "Compelling 2-3 sentence English description highlighting key features and benefits",
//   "descriptionBn": "বাংলায় ২-৩ বাক্যে পণ্যের বিবরণ, মূল বৈশিষ্ট্য সহ",
//   "price": <suggested price in ${currency} as integer, realistic for BD market>,
//   "comparePrice": <original/MRP price or null>,
//   "category": "Most appropriate category (e.g. Clothing, Electronics, Food, Beauty, Home, etc.)",
//   "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
//   "captions": [
//     {"en": "Engaging Facebook/Instagram caption in English with emojis and CTA", "bn": "বাংলায় আকর্ষণীয় ক্যাপশন ইমোজি সহ"},
//     {"en": "Second caption variant focusing on price/deal", "bn": "দাম/অফার কেন্দ্রিক দ্বিতীয় ক্যাপশন"},
//     {"en": "Third caption variant — storytelling angle", "bn": "গল্প বলার ধরনে তৃতীয় ক্যাপশন"}
//   ],
//   "stockHint": <suggested initial stock quantity>
// }`;

//     const text = await this.callClaude(
//       prompt,
//       imageUrl,
//       imageBase64,
//       imageMime,
//     );
//     return this.parseJSON<ProductAIResult>(text, {
//       name: 'Product',
//       nameBn: 'পণ্য',
//       description: '',
//       descriptionBn: '',
//       price: 0,
//       comparePrice: null,
//       category: 'General',
//       keywords: [],
//       captions: [],
//       stockHint: 10,
//     });
//   }

//   // ── Store setup ─────────────────────────────────────────────────────────────

//   async generateStoreSetup(
//     businessName: string,
//     businessType: string,
//     targetAudience?: string,
//   ): Promise<StoreSetupResult> {
//     const prompt = `You are a BD e-commerce store setup expert.
// Generate complete store settings for:
// Business: "${businessName}"
// Type: "${businessType}"
// Target: "${targetAudience ?? 'general BD customers'}"

// Return ONLY valid JSON:
// {
//   "name": "Catchy store display name",
//   "description": "Compelling 1-2 sentence English store description",
//   "descriptionBn": "বাংলায় স্টোরের বিবরণ",
//   "announcement": "Short promotional announcement bar text (e.g. '🎉 Free delivery on orders over ৳500!')",
//   "themeColor": "<hex color that matches the business type>",
//   "keywords": ["seo keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"],
//   "deliveryFee": <typical BD delivery fee in BDT>,
//   "heroTitle": "Catchy hero banner headline",
//   "heroSubtitle": "Supporting hero subtitle",
//   "heroCta": "Call to action button text"
// }`;

//     const text = await this.callClaude(prompt);
//     return this.parseJSON<StoreSetupResult>(text, {
//       name: businessName,
//       description: '',
//       descriptionBn: '',
//       announcement: null as any,
//       themeColor: '#6366f1',
//       keywords: [],
//       deliveryFee: 60,
//       heroTitle: businessName,
//       heroSubtitle: 'Quality products',
//       heroCta: 'Shop Now',
//     });
//   }

//   // ── Store SEO ───────────────────────────────────────────────────────────────

//   async generateStoreSeo(
//     storeName: string,
//     storeDescription?: string,
//     storeSlug?: string,
//     storeUrl?: string,
//   ): Promise<SeoResult> {
//     const prompt = `You are an SEO expert. Generate optimized SEO metadata for an e-commerce store.

// Store name: ${storeName}
// ${storeDescription ? `Description: ${storeDescription}` : ''}
// ${storeSlug ? `URL slug: ${storeSlug}` : ''}
// ${storeUrl ? `URL: ${storeUrl}` : ''}

// Return ONLY valid JSON (no markdown, no explanation):
// {
//   "title": "SEO title 50-60 chars — store name + main product category or key benefit",
//   "description": "Meta description 150-160 chars — compelling, include benefits and a call to action",
//   "keywords": "comma-separated 8-12 keywords, mix of broad and specific, relevant to the store"
// }`;

//     const text = await this.callClaude(
//       prompt,
//       undefined,
//       undefined,
//       undefined,
//       this.HAIKU,
//       400,
//     );
//     return this.parseJSON<SeoResult>(text, {
//       title: `${storeName} — Shop Online`,
//       description: `Shop quality products at ${storeName}. Fast delivery, great prices, easy returns.`,
//       keywords: `${storeName.toLowerCase()}, online shop, buy online`,
//     });
//   }

//   // ── Product SEO ─────────────────────────────────────────────────────────────

//   async generateProductSeo(
//     productName: string,
//     productDescription?: string,
//     productUrl?: string,
//   ): Promise<SeoResult> {
//     const prompt = `You are an SEO expert. Generate optimized SEO metadata for a product page.

// Product name: ${productName}
// ${productDescription ? `Description: ${productDescription}` : ''}
// ${productUrl ? `URL: ${productUrl}` : ''}

// Return ONLY valid JSON (no markdown, no explanation):
// {
//   "title": "SEO title 50-60 chars — product name + key benefit or use case",
//   "description": "Meta description 150-160 chars — product benefits, who it is for, CTA to buy",
//   "keywords": "comma-separated 6-10 keywords: product type, materials, use cases, synonyms"
// }`;

//     const text = await this.callClaude(
//       prompt,
//       undefined,
//       undefined,
//       undefined,
//       this.HAIKU,
//       400,
//     );
//     return this.parseJSON<SeoResult>(text, {
//       title: productName,
//       description: `Buy ${productName} online. Quality guaranteed, fast delivery.`,
//       keywords: productName.toLowerCase().split(' ').join(', '),
//     });
//   }

//   // ── Product description from name ───────────────────────────────────────────

//   async generateProductDescription(
//     productName: string,
//     storeName?: string,
//   ): Promise<ProductDescriptionResult> {
//     const prompt = `Write a compelling e-commerce product description for: "${productName}"
// ${storeName ? `Store: ${storeName}` : ''}

// Requirements:
// - 2-3 sentences maximum
// - Focus on benefits not just features
// - Natural persuasive tone
// - Suitable for Bangladeshi/South Asian market if relevant
// - No bullet points, no markdown

// Return ONLY the description text, nothing else.`;

//     const text = await this.callClaude(
//       prompt,
//       undefined,
//       undefined,
//       undefined,
//       this.HAIKU,
//       200,
//     );
//     return { description: text.trim() };
//   }

//   // ── Instagram photos ─────────────────────────────────────────────────────────

//   async fetchInstagramPhotos(
//     igBusinessId: string,
//     accessToken: string,
//     limit = 50,
//   ): Promise<FbIgPhoto[]> {
//     try {
//       const url = new URL(
//         `https://graph.facebook.com/v19.0/${igBusinessId}/media`,
//       );
//       url.searchParams.set(
//         'fields',
//         'id,media_url,caption,timestamp,media_type',
//       );
//       url.searchParams.set('limit', String(limit));
//       url.searchParams.set('access_token', accessToken);

//       const res = await firstValueFrom(this.http.get(url.toString()));
//       const data = res.data as any;

//       if (!Array.isArray(data?.data)) return [];

//       return (data.data as any[])
//         .filter(
//           (m) => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM',
//         )
//         .map((m) => ({
//           id: m.id as string,
//           url: m.media_url as string,
//           caption: m.caption as string | undefined,
//           createdAt: m.timestamp as string,
//         }))
//         .filter((m) => !!m.url);
//     } catch (err: any) {
//       this.logger.warn(`[AI] Instagram photos fetch failed: ${err?.message}`);
//       return [];
//     }
//   }

//   // ── Facebook photos ──────────────────────────────────────────────────────────

//   async fetchFacebookPagePhotos(
//     pageId: string,
//     accessToken: string,
//     limit = 20,
//   ): Promise<FbIgPhoto[]> {
//     try {
//       const res = await firstValueFrom(
//         this.http.get(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
//           params: {
//             fields: 'images,name,created_time',
//             limit,
//             type: 'uploaded',
//             access_token: accessToken,
//           },
//         }),
//       );

//       const photos = (res.data?.data ?? []) as any[];
//       return photos
//         .map((p) => ({
//           id: p.id as string,
//           url: (p.images?.[0]?.source ?? '') as string,
//           caption: p.name as string | undefined,
//           createdAt: p.created_time as string,
//         }))
//         .filter((p) => !!p.url);
//     } catch (err: any) {
//       this.logger.warn(`[AI] FB photos fetch failed: ${err?.message}`);
//       return [];
//     }
//   }

//   // ── Inbox reply ──────────────────────────────────────────────────────────────

//   async generateInboxReply(
//     customerMessage: string,
//     storeName: string,
//     conversationHistory?: string,
//     orderContext?: string,
//   ): Promise<InboxReplyResult> {
//     const prompt = `You are a helpful customer service agent for "${storeName}", a BD e-commerce store.

// Customer message: "${customerMessage}"
// ${conversationHistory ? `Recent conversation:\n${conversationHistory}` : ''}
// ${orderContext ? `Order context: ${orderContext}` : ''}

// Return ONLY valid JSON:
// {
//   "replies": [
//     {"text": "Friendly professional reply", "tone": "professional"},
//     {"text": "Warm casual reply", "tone": "friendly"},
//     {"text": "Brief direct reply", "tone": "brief"}
//   ],
//   "intent": "<one of: order|inquiry|complaint|payment|tracking|other>",
//   "suggestedAction": "<null or one of: create_order|send_payment_link|book_courier|show_tracking>",
//   "language": "<en|bn|mixed>"
// }`;

//     const text = await this.callClaude(prompt);
//     return this.parseJSON<InboxReplyResult>(text, {
//       replies: [
//         {
//           text: 'Thank you for your message! How can I help you?',
//           tone: 'professional',
//         },
//       ],
//       intent: 'other',
//       suggestedAction: null,
//       language: 'en',
//     });
//   }

//   // ── Growth report ────────────────────────────────────────────────────────────

//   async generateGrowthReport(
//     orgStats: {
//       totalOrders: number;
//       totalRevenue: number;
//       topProducts: string[];
//       lowStockProducts: string[];
//       noDescriptionProducts: string[];
//       avgOrderValue: number;
//       pendingOrders: number;
//     },
//     storeName: string,
//   ): Promise<GrowthReportResult> {
//     const prompt = `You are a BD e-commerce growth advisor for "${storeName}".

// Store stats this week:
// - Total orders: ${orgStats.totalOrders}
// - Revenue: ৳${orgStats.totalRevenue}
// - Avg order: ৳${orgStats.avgOrderValue}
// - Pending orders: ${orgStats.pendingOrders}
// - Top products: ${orgStats.topProducts.join(', ') || 'none'}
// - Low stock: ${orgStats.lowStockProducts.join(', ') || 'none'}
// - No description: ${orgStats.noDescriptionProducts.join(', ') || 'none'}

// Return ONLY valid JSON:
// {
//   "insights": [
//     {"type": "warning|opportunity|tip|achievement", "title": "Short title", "message": "Actionable 1-2 sentence insight", "action": "Button text or null", "actionRoute": "/route or null"}
//   ],
//   "topProduct": "Name of top product or null",
//   "fbCaption": "Ready-to-post Facebook promotional caption for top product with emojis",
//   "weekSummary": "1 sentence positive week summary"
// }

// Generate 3-5 insights. Be specific and actionable for BD market.`;

//     const text = await this.callClaude(prompt);
//     return this.parseJSON<GrowthReportResult>(text, {
//       insights: [],
//       topProduct: null,
//       fbCaption: null,
//       weekSummary: 'Keep growing!',
//     });
//   }

//   // ── Comment intent classification ────────────────────────────────────────────

//   async classifyCommentIntent(text: string): Promise<CommentIntentResult> {
//     const prompt = `Classify this social media comment into exactly one intent category.
// Comment: "${text}"

// Categories:
// - price_query: asking about price, cost, rate, কত, দাম
// - buy_intent: wants to buy, interested, inbox, DM, order
// - availability: asking if available, আছে, stock
// - complaint: negative, unhappy, problem
// - spam: irrelevant, promotional, repeated
// - other: anything else

// Respond with JSON only, no markdown: {"intent":"<category>","confidence":<0.0-1.0>}`;

//     try {
//       const raw = await this.callClaude(
//         prompt,
//         undefined,
//         undefined,
//         undefined,
//         this.HAIKU,
//         100,
//       );
//       const parsed = this.parseJSON<{ intent: string; confidence: number }>(
//         raw,
//         {
//           intent: 'other',
//           confidence: 0.5,
//         },
//       );
//       return {
//         intent: (parsed.intent as CommentIntentResult['intent']) ?? 'other',
//         confidence: Number(parsed.confidence) ?? 0.5,
//       };
//     } catch (err: any) {
//       this.logger.warn(`[AI] Comment classification failed: ${err?.message}`);
//       return { intent: 'other', confidence: 0 };
//     }
//   }

//   async scanReceiptImage(
//     imageBase64: string,
//     imageMime: string,
//     prompt: string,
//   ): Promise<string> {
//     return this.callClaude(
//       prompt,
//       undefined,
//       imageBase64,
//       imageMime,
//       this.MODEL,
//       1024,
//     );
//   }

//   parseReceiptJSON(
//     raw: string,
//   ): import('../bookkeeping/entities/bookkeeping.entities').ReceiptParsedData {
//     const parsed = this.parseJSON<{
//       merchantName?: string;
//       merchantVatNumber?: string;
//       receiptDate?: string;
//       totalAmount?: number;
//       vatAmount?: number;
//       vatRate?: number;
//       currency?: string;
//       lineItems?: Array<{
//         description: string;
//         quantity?: number;
//         unitPrice?: number;
//         total: number;
//       }>;
//       confidence: number;
//       rawText?: string;
//     }>(raw, { confidence: 0 });

//     return {
//       merchantName: parsed.merchantName,
//       merchantVatNumber: parsed.merchantVatNumber,
//       receiptDate: parsed.receiptDate,
//       totalAmount: parsed.totalAmount ? Number(parsed.totalAmount) : undefined,
//       vatAmount: parsed.vatAmount ? Number(parsed.vatAmount) : undefined,
//       vatRate: parsed.vatRate ? Number(parsed.vatRate) : undefined,
//       currency: parsed.currency ?? 'EUR',
//       lineItems: parsed.lineItems ?? [],
//       confidence: Number(parsed.confidence) || 0,
//       rawText: parsed.rawText,
//     };
//   }

//   async parseInvoicePdf(
//     pdfBase64: string,
//     hint?: { supplierEmail?: string; subject?: string },
//   ): Promise<InvoiceParsedData> {
//     const contextHint = hint
//       ? `Context: Email from ${hint.supplierEmail ?? 'unknown'}, subject: "${hint.subject ?? ''}".`
//       : '';

//     const prompt = `You are an expert invoice parser for Estonian and EU businesses.
// ${contextHint}
// Parse this invoice PDF and extract all available financial data.

// Return ONLY valid JSON (no markdown, no explanation):
// {
//   "supplierName": "Seller/vendor company name",
//   "supplierEmail": "seller email if visible or null",
//   "supplierVatNumber": "VAT/KM registration number e.g. EE123456789 or null",
//   "supplierRegNumber": "Company registration number or null",
//   "supplierIban": "Seller bank IBAN if shown or null",
//   "invoiceNumber": "Invoice number/ID or null",
//   "invoiceDate": "YYYY-MM-DD or null",
//   "dueDate": "YYYY-MM-DD or null",
//   "totalAmount": <total payable including VAT as number>,
//   "subtotalAmount": <amount before VAT or null>,
//   "vatAmount": <VAT amount as number or null>,
//   "vatRate": <VAT % e.g. 22 or null>,
//   "currency": "EUR",
//   "description": "One sentence summary of what was purchased",
//   "lineItems": [
//     {
//       "description": "item/service name",
//       "quantity": 1,
//       "unit": "unit/hour/kg/etc",
//       "unitPrice": 10.00,
//       "vatRate": 22,
//       "total": 12.20
//     }
//   ],
//   "paymentReference": "Payment reference number or null",
//   "notes": "Any important notes or payment terms or null",
//   "confidence": <0.0-1.0 confidence in extraction quality>
// }

// Estonian VAT (KM) rates: 22% standard, 9% reduced (books, medicine, hotels), 0% exports.
// If the document is not an invoice, return { "confidence": 0 }.`;

//     const raw = await this.callClaude(
//       prompt,
//       undefined,
//       pdfBase64,
//       'application/pdf',
//       this.MODEL,
//       2000,
//     );
//     return this.parseInvoiceData(raw);
//   }

//   /**
//    * Parse a bank statement PDF.
//    *
//    * Strategy (cheapest → most expensive):
//    *   1. pdf-parse extracts raw text  (~0 cost, instant)       [FIXED: correct API usage]
//    *   2. Bank-specific regex pulls transactions  (~0 cost)      [FIXED: relaxed whitespace]
//    *   3. Haiku batch-categorises ALL tx in one call  (~$0.001)
//    *   4. AI fallback (Sonnet) only for scanned/image PDFs      [FIXED: type field added]
//    *
//    * FIX #3: Every transaction now carries `type: 'income' | 'expense'`
//    * derived from the sign of `amount`. The DB layer no longer needs to
//    * re-derive it — just read `t.type` and store accordingly.
//    */
//   async parseBankStatementPdf(
//     pdfBase64: string,
//     bankHint?: string,
//     filename = '',
//   ): Promise<BankStatementParsedData> {
//     // ── Step 1 & 2: rule-based parse ─────────────────────────────────────
//     const parsed = await this.bankParser.parse(pdfBase64, bankHint, filename);

//     if (parsed && parsed.transactions.length > 0) {
//       this.logger.log(
//         `[BankStatement] Rules extracted ${parsed.transactions.length} tx — ` +
//           'running batch categorisation',
//       );

//       // ── Step 3: batch categorise with Haiku (1 call for all tx) ────────
//       const descriptions = parsed.transactions.map((t) =>
//         [t.description, t.counterpartyName].filter(Boolean).join(' | '),
//       );
//       const categories = await this.categorizeBatch(descriptions);

//       // FIX #3: Spread RawTransaction fields and add category. The `type`
//       // field is already set on RawTransaction by the parser — no re-derivation needed.
//       const transactions: BankStatementTransaction[] = parsed.transactions.map(
//         (t, i) => ({
//           date: t.date,
//           valueDate: t.valueDate,
//           description: t.description,
//           amount: t.amount,
//           currency: t.currency,
//           type: t.type, // ← already 'income' | 'expense'
//           counterpartyName: t.counterpartyName,
//           counterpartyIban: t.counterpartyIban,
//           referenceNumber: t.referenceNumber,
//           transactionId: t.transactionId,
//           category: categories[i] ?? 'Other',
//         }),
//       );

//       this.logger.log(
//         `[BankStatement] Final: ${transactions.length} transactions ` +
//           `(income: ${transactions.filter((t) => t.type === 'income').length}, ` +
//           `expense: ${transactions.filter((t) => t.type === 'expense').length})`,
//       );

//       return {
//         bankName: parsed.bankName,
//         accountHolder: parsed.accountHolder,
//         iban: parsed.iban,
//         periodFrom: parsed.periodFrom,
//         periodTo: parsed.periodTo,
//         currency: parsed.currency,
//         openingBalance: parsed.openingBalance,
//         closingBalance: parsed.closingBalance,
//         transactions,
//         confidence: 0.95,
//       };
//     }

//     // ── Step 4: AI fallback for scanned/image PDFs ────────────────────────
//     this.logger.warn(
//       '[BankStatement] Rule-based parse failed — falling back to Sonnet AI',
//     );

//     const prompt = `You are an expert bank statement parser for Estonian banks.
// ${bankHint ? `This is a ${bankHint.toUpperCase()} bank statement.` : ''}

// CRITICAL: Respond with RAW JSON only. No markdown. No code fences. No explanation.
// Your entire response must start with { and end with }.

// Parse ALL transactions from this bank statement.

// RULES:
// - Money leaving the account (payments, expenses, purchases, fees) = NEGATIVE amounts
// - Money arriving (client payments, transfers in, refunds received) = POSITIVE amounts
// - For each transaction set "type": "expense" when amount is negative, "income" when positive
// - Include EVERY transaction, do not skip or summarise

// Return ONLY valid JSON:
// {
//   "bankName": "LHV / SEB / Swedbank / Luminor / Coop",
//   "accountHolder": "Full name of account holder",
//   "iban": "Account IBAN",
//   "periodFrom": "YYYY-MM-DD",
//   "periodTo": "YYYY-MM-DD",
//   "currency": "EUR",
//   "openingBalance": 0.00,
//   "closingBalance": 0.00,
//   "transactions": [
//     {
//       "date": "YYYY-MM-DD",
//       "valueDate": "YYYY-MM-DD or null",
//       "description": "Full transaction narration",
//       "amount": -50.00,
//       "currency": "EUR",
//       "type": "expense",
//       "counterpartyName": "Other party name or null",
//       "counterpartyIban": "Other party IBAN or null",
//       "referenceNumber": "Payment reference number or null",
//       "transactionId": "Bank transaction ID or null",
//       "category": "Fuel|Rent|Telecoms|Payroll|Taxes|Utilities|Food|Income|Software|Marketing|Other"
//     }
//   ],
//   "confidence": 0.85
// }`;

//     const raw = await this.callClaude(
//       prompt,
//       undefined,
//       pdfBase64,
//       'application/pdf',
//       this.MODEL,
//       8000,
//     );
//     this.logger.debug(`[BankStatement] AI fallback raw: ${raw.slice(0, 300)}`);
//     return this.parseBankStatementData(raw);
//   }

//   async parseDailyRevenueEmail(
//     emailBody: string,
//     emailSubject: string,
//     emailDate: string,
//   ): Promise<DailyRevenueParsedData> {
//     const prompt = `You are a revenue data extraction expert for restaurants and retail businesses.
// Parse this daily sales/revenue report email and extract the total revenue figure.

// Email subject: "${emailSubject}"
// Email date: ${emailDate}

// Look for these fields (not all may be present):
// - Total sales / net sales / gross revenue / päevakäive / kogu müük
// - Payment method breakdown (cash/card/online)
// - Number of transactions/covers
// - Average transaction value

// Common report formats: Poster POS, iiko, Bolt Food daily summary, Wolt partner report,
// Forkeeps, Lightspeed, Square, custom restaurant systems.

// Return ONLY valid JSON:
// {
//   "date": "${emailDate.slice(0, 10)}",
//   "reportSource": "System/platform name e.g. Poster POS, Bolt Food, Wolt",
//   "totalRevenue": <total revenue as positive number>,
//   "currency": "EUR",
//   "paymentBreakdown": {
//     "cash": 0,
//     "card": 0,
//     "online": 0,
//     "other": 0
//   },
//   "transactionCount": <number of transactions or null>,
//   "averageTransactionValue": <average or null>,
//   "vatIncluded": <true if revenue is VAT-inclusive, false if ex-VAT, null if unknown>,
//   "notes": "Any special notes or null",
//   "confidence": <0.0-1.0>
// }

// If no revenue figure can be found, return { "confidence": 0, "totalRevenue": 0, "currency": "EUR", "date": "${emailDate.slice(0, 10)}", "reportSource": "unknown" }.`;

//     const raw = await this.callClaude(
//       prompt + '\n\nEmail body:\n' + emailBody.slice(0, 3000),
//       undefined,
//       undefined,
//       undefined,
//       this.HAIKU,
//       800,
//     );
//     return this.parseDailyRevenueData(raw);
//   }

//   private parseInvoiceData(raw: string): InvoiceParsedData {
//     const parsed = this.parseJSON<InvoiceParsedData>(raw, {
//       currency: 'EUR',
//       confidence: 0,
//     });
//     return {
//       ...parsed,
//       totalAmount: parsed.totalAmount ? Number(parsed.totalAmount) : undefined,
//       subtotalAmount: parsed.subtotalAmount
//         ? Number(parsed.subtotalAmount)
//         : undefined,
//       vatAmount: parsed.vatAmount ? Number(parsed.vatAmount) : undefined,
//       currency: parsed.currency ?? 'EUR',
//       confidence: Number(parsed.confidence) || 0,
//     };
//   }

//   /**
//    * FIX #3: parseBankStatementData now derives `type` from amount sign
//    * for every transaction returned by the AI fallback path.
//    * This ensures the DB layer always gets `type: 'income' | 'expense'`
//    * regardless of whether rules or AI produced the transactions.
//    */
//   private parseBankStatementData(raw: string): BankStatementParsedData {
//     const parsed = this.parseJSON<BankStatementParsedData>(raw, {
//       bankName: 'Unknown',
//       accountHolder: '',
//       iban: '',
//       periodFrom: '',
//       periodTo: '',
//       currency: 'EUR',
//       openingBalance: 0,
//       closingBalance: 0,
//       transactions: [],
//       confidence: 0,
//     });

//     const transactions: BankStatementTransaction[] = (
//       parsed.transactions ?? []
//     ).map((t) => {
//       const amount = Number(t.amount) || 0;
//       // AI may or may not have set type — always re-derive from amount to be safe
//       const type: 'income' | 'expense' = deriveType(amount);
//       return { ...t, amount, type };
//     });

//     return {
//       ...parsed,
//       openingBalance: Number(parsed.openingBalance) || 0,
//       closingBalance: Number(parsed.closingBalance) || 0,
//       transactions,
//       confidence: Number(parsed.confidence) || 0,
//     };
//   }

//   private parseDailyRevenueData(raw: string): DailyRevenueParsedData {
//     const parsed = this.parseJSON<DailyRevenueParsedData>(raw, {
//       date: new Date().toISOString().split('T')[0],
//       reportSource: 'unknown',
//       totalRevenue: 0,
//       currency: 'EUR',
//       confidence: 0,
//     });
//     return {
//       ...parsed,
//       totalRevenue: Number(parsed.totalRevenue) || 0,
//       confidence: Number(parsed.confidence) || 0,
//     };
//   }

//   /**
//    * Batch-categorise transaction descriptions using a single Haiku call.
//    * Returns a string[] in the same order as the input.
//    * Falls back to 'Other' for any unparseable entries.
//    */
//   async categorizeBatch(descriptions: string[]): Promise<string[]> {
//     if (descriptions.length === 0) return [];

//     const BATCH = 150;
//     if (descriptions.length > BATCH) {
//       const results: string[] = [];
//       for (let i = 0; i < descriptions.length; i += BATCH) {
//         const chunk = descriptions.slice(i, i + BATCH);
//         const cats = await this.categorizeBatch(chunk);
//         results.push(...cats);
//       }
//       return results;
//     }

//     const prompt = `Categorise each bank transaction into exactly one category.
// Valid categories: Fuel, Rent, Telecoms, Payroll, Taxes, Utilities, Food, Income, Software, Marketing, Other

// Return a JSON array of strings, one per transaction, in the same order.
// Example: ["Food","Fuel","Income","Other"]

// Transactions:
// ${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

// Return ONLY the JSON array, nothing else.`;

//     try {
//       const raw = await this.callClaude(
//         prompt,
//         undefined,
//         undefined,
//         undefined,
//         this.HAIKU,
//         Math.min(descriptions.length * 15 + 50, 2000),
//       );

//       const clean = raw
//         .replace(/```json\s*/gi, '')
//         .replace(/```\s*/g, '')
//         .trim();
//       const arrStart = clean.indexOf('[');
//       const arrEnd = clean.lastIndexOf(']');
//       if (arrStart === -1 || arrEnd === -1) throw new Error('No array found');

//       const categories = JSON.parse(
//         clean.slice(arrStart, arrEnd + 1),
//       ) as string[];

//       while (categories.length < descriptions.length) {
//         categories.push('Other');
//       }

//       return categories.slice(0, descriptions.length);
//     } catch (err: unknown) {
//       const msg = err instanceof Error ? err.message : String(err);
//       this.logger.warn(
//         `[AI] categorizeBatch failed: ${msg} — defaulting to Other`,
//       );
//       return descriptions.map(() => 'Other');
//     }
//   }
// }
