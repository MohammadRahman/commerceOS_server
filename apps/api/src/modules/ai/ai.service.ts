/* eslint-disable @typescript-eslint/no-unsafe-return */
// apps/api/src/modules/ai/ai.service.ts
// Central AI service — all Claude API calls go through here
// Each method returns structured JSON Claude generates

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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly CLAUDE_API = 'https://api.anthropic.com/v1/messages';
  private readonly MODEL = 'claude-sonnet-4-20250514';

  constructor(
    private config: ConfigService,
    private http: HttpService,
  ) {}

  private async callClaude(
    prompt: string,
    imageUrl?: string,
    imageBase64?: string,
    imageMime?: string,
  ): Promise<string> {
    const apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');

    const content: any[] = [];

    // Add image if provided
    if (imageBase64 && imageMime) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: imageMime, data: imageBase64 },
      });
    } else if (imageUrl) {
      content.push({
        type: 'image',
        source: { type: 'url', url: imageUrl },
      });
    }

    content.push({ type: 'text', text: prompt });

    const res = await firstValueFrom(
      this.http.post(
        this.CLAUDE_API,
        {
          model: this.MODEL,
          max_tokens: 1500,
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

    const text = res.data?.content?.[0]?.text ?? '';
    return text;
  }

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

  // ── Feature 1+2: Product from image ────────────────────────────────────────

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

  // ── Feature 3: AI Store Setup ───────────────────────────────────────────────

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
  "themeColor": "<hex color that matches the business type, e.g. fashion=#ec4899, food=#f97316, tech=#3b82f6>",
  "keywords": ["seo keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"],
  "deliveryFee": <typical BD delivery fee in BDT, 0 if free shipping business>,
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

  // ── Feature 4: Smart Inbox Reply ────────────────────────────────────────────

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

Detect the language (English/Bengali/mixed) and generate appropriate replies.

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

  // ── Feature 5: Growth Report ────────────────────────────────────────────────

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

Generate actionable insights for a BD seller.

Return ONLY valid JSON:
{
  "insights": [
    {"type": "warning|opportunity|tip|achievement", "title": "Short title", "message": "Actionable 1-2 sentence insight", "action": "Button text or null", "actionRoute": "/route or null"}
  ],
  "topProduct": "Name of top product or null",
  "fbCaption": "Ready-to-post Facebook promotional caption for top product with emojis",
  "weekSummary": "1 sentence positive week summary"
}

Generate 3-5 insights maximum. Be specific and actionable for BD market.`;

    const text = await this.callClaude(prompt);
    return this.parseJSON<GrowthReportResult>(text, {
      insights: [],
      topProduct: null,
      fbCaption: null,
      weekSummary: 'Keep growing!',
    });
  }

  // ── Facebook photo fetcher ──────────────────────────────────────────────────

  async fetchFacebookPagePhotos(
    pageId: string,
    accessToken: string,
    limit = 20,
  ): Promise<
    { id: string; url: string; caption?: string; createdAt: string }[]
  > {
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

      const photos = res.data?.data ?? [];
      return photos
        .map((p: any) => ({
          id: p.id,
          // Get largest image
          url: p.images?.[0]?.source ?? '',
          caption: p.name ?? undefined,
          createdAt: p.created_time,
        }))
        .filter((p: any) => p.url);
    } catch (e: any) {
      this.logger.warn(`[AI] FB photos fetch failed: ${e?.message}`);
      return [];
    }
  }
}
