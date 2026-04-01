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

// ── New result types ───────────────────────────────────────────────────────────

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

// ── Comment intent ─────────────────────────────────────────────────────────────

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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly CLAUDE_API = 'https://api.anthropic.com/v1/messages';
  private readonly MODEL = 'claude-sonnet-4-5';
  private readonly HAIKU = 'claude-haiku-4-5-20251001';

  constructor(
    private config: ConfigService,
    private http: HttpService,
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
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: imageMime, data: imageBase64 },
        });
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
      const clean = text.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) return fallback;
      return JSON.parse(clean.slice(start, end + 1)) as T;
    } catch {
      this.logger.warn('[AI] JSON parse failed');
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

  /**
   * Auto-generates SEO title, description, keywords for a store.
   * Uses haiku — needs to feel instant on tab open.
   */
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

  /**
   * Auto-generates SEO title, description, keywords for a product.
   * Uses haiku — fires on product SEO tab open.
   */
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

  /**
   * Generates a product description from name alone.
   * Fires on blur of product name field — needs to feel instant.
   * Uses haiku.
   */
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

  /**
   * Fetches recent IMAGE posts from an Instagram Business account.
   * Used in the OG image picker and product import flow.
   */
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
        { intent: 'other', confidence: 0.5 },
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
      undefined, // no imageUrl
      imageBase64,
      imageMime,
      this.MODEL, // use Sonnet for best OCR accuracy
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
}
/* eslint-disable no-constant-binary-expression */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// // apps/api/src/modules/ai/ai.service.ts
// // Central AI service — all Claude API calls go through here
// // Each method returns structured JSON Claude generates

// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';

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

// // ── NEW: comment intent classification ────────────────────────────────────────

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
// @Injectable()
// export class AiService {
//   private readonly logger = new Logger(AiService.name);
//   private readonly CLAUDE_API = 'https://api.anthropic.com/v1/messages';
//   private readonly MODEL = 'claude-sonnet-4-5';

//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//   ) {}

//   private async callClaude(
//     prompt: string,
//     imageUrl?: string,
//     imageBase64?: string,
//     imageMime?: string,
//   ): Promise<string> {
//     try {
//       const apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');

//       const content: any[] = [];

//       // Add image if provided
//       if (imageBase64 && imageMime) {
//         content.push({
//           type: 'image',
//           source: { type: 'base64', media_type: imageMime, data: imageBase64 },
//         });
//       } else if (imageUrl) {
//         content.push({
//           type: 'image',
//           source: { type: 'url', url: imageUrl },
//         });
//       }

//       content.push({ type: 'text', text: prompt });

//       const res = await firstValueFrom(
//         this.http.post(
//           this.CLAUDE_API,
//           {
//             model: this.MODEL,
//             max_tokens: 1500,
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

//       const text = res.data?.content?.[0]?.text ?? '';
//       return text;
//     } catch (err) {
//       this.logger.error(
//         `[AI] Anthropic API error: ${JSON.stringify(err?.response?.data ?? err?.message)}`,
//       );
//       throw new Error(
//         err?.response?.data?.error?.message ?? 'AI service failed',
//       );
//     }
//   }

//   private parseJSON<T>(text: string, fallback: T): T {
//     try {
//       const clean = text.replace(/```json|```/g, '').trim();
//       const start = clean.indexOf('{');
//       const end = clean.lastIndexOf('}');
//       if (start === -1 || end === -1) return fallback;
//       return JSON.parse(clean.slice(start, end + 1)) as T;
//     } catch {
//       this.logger.warn('[AI] JSON parse failed');
//       return fallback;
//     }
//   }

//   // ── Feature 1+2: Product from image ────────────────────────────────────────

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

//   // ── Feature 3: AI Store Setup ───────────────────────────────────────────────

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
//   "themeColor": "<hex color that matches the business type, e.g. fashion=#ec4899, food=#f97316, tech=#3b82f6>",
//   "keywords": ["seo keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"],
//   "deliveryFee": <typical BD delivery fee in BDT, 0 if free shipping business>,
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

//   // ── Feature 4: Smart Inbox Reply ────────────────────────────────────────────

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

// Detect the language (English/Bengali/mixed) and generate appropriate replies.

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

//   // ── Feature 5: Growth Report ────────────────────────────────────────────────

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

// Generate actionable insights for a BD seller.

// Return ONLY valid JSON:
// {
//   "insights": [
//     {"type": "warning|opportunity|tip|achievement", "title": "Short title", "message": "Actionable 1-2 sentence insight", "action": "Button text or null", "actionRoute": "/route or null"}
//   ],
//   "topProduct": "Name of top product or null",
//   "fbCaption": "Ready-to-post Facebook promotional caption for top product with emojis",
//   "weekSummary": "1 sentence positive week summary"
// }

// Generate 3-5 insights maximum. Be specific and actionable for BD market.`;

//     const text = await this.callClaude(prompt);
//     return this.parseJSON<GrowthReportResult>(text, {
//       insights: [],
//       topProduct: null,
//       fbCaption: null,
//       weekSummary: 'Keep growing!',
//     });
//   }

//   // ── Facebook photo fetcher ──────────────────────────────────────────────────

//   async fetchFacebookPagePhotos(
//     pageId: string,
//     accessToken: string,
//     limit = 20,
//   ): Promise<
//     { id: string; url: string; caption?: string; createdAt: string }[]
//   > {
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

//       const photos = res.data?.data ?? [];
//       return photos
//         .map((p: any) => ({
//           id: p.id,
//           // Get largest image
//           url: p.images?.[0]?.source ?? '',
//           caption: p.name ?? undefined,
//           createdAt: p.created_time,
//         }))
//         .filter((p: any) => p.url);
//     } catch (e: any) {
//       this.logger.warn(`[AI] FB photos fetch failed: ${e?.message}`);
//       return [];
//     }
//   }
//   // ── Comment intent classification (used by CommentsService) ──────────────
//   /**
//    * Classify a single social media comment into an intent category.
//    * Uses claude-haiku for speed and cost efficiency — classification
//    * runs on every incoming comment so we want the cheapest model.
//    * CommentsService calls this; no other service needs to import Anthropic SDK.
//    */
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
//       const apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');

//       // Use haiku — cheapest model, classification doesn't need sonnet
//       const res = await firstValueFrom(
//         this.http.post(
//           this.CLAUDE_API,
//           {
//             model: 'claude-haiku-4-5-20251001',
//             max_tokens: 100,
//             messages: [{ role: 'user', content: prompt }],
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

//       const raw = (res.data?.content?.[0]?.text ?? '{}').trim();
//       const parsed = this.parseJSON<{ intent: string; confidence: number }>(
//         raw,
//         { intent: 'other', confidence: 0.5 },
//       );
//       return {
//         intent: (parsed.intent as CommentIntentResult['intent']) ?? 'other',
//         confidence: Number(parsed.confidence) ?? 0.5,
//       };
//     } catch (err) {
//       this.logger.warn(`[AI] Comment classification failed: ${err?.message}`);
//       return { intent: 'other', confidence: 0 };
//     }
//   }
// }
