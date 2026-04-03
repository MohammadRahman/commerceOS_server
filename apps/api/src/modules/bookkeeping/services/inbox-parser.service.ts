/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/bookkeeping/services/inbox-parser.service.ts
//
// Watches a connected Gmail / Outlook mailbox for:
//   (a) Emails with PDF/image attachments  → parsed as supplier invoices → expense entries
//   (b) Emails matching "daily report" patterns → parsed for revenue totals → income entries
//
// Called by:
//   - InboxParserProcessor (Bull queue, runs every 15 min)
//   - AutomationController (manual "Sync now" trigger)

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { AiService } from '../../ai/ai.service';
import { SupplierService } from './supplier.service';
import { AutomationLog } from '../entities/automation-log.entity';
import { AutomationConfig } from '../entities/automation-config.entity';

// ── Internal Gmail types ───────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  threadId: string;
  payload: {
    headers: { name: string; value: string }[];
    parts?: GmailPart[];
    body?: { data?: string; size: number };
    mimeType: string;
  };
  internalDate: string;
}

interface GmailPart {
  partId: string;
  mimeType: string;
  filename: string;
  body: { attachmentId?: string; data?: string; size: number };
  parts?: GmailPart[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class InboxParserService {
  private readonly logger = new Logger(InboxParserService.name);
  private readonly GMAIL_BASE =
    'https://gmail.googleapis.com/gmail/v1/users/me';

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly ai: AiService,
    private readonly supplierService: SupplierService,
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  // ── Public entry point ─────────────────────────────────────────────────────

  async syncInbox(
    organizationId: string,
  ): Promise<{ invoices: number; reports: number; errors: number }> {
    // FIX: emailAccessToken has select:false — must addSelect explicitly.
    // A plain findOne() would return undefined for the token even when set.
    const cfg = await this.configRepo
      .createQueryBuilder('ac')
      .addSelect('ac.emailAccessToken')
      .addSelect('ac.emailRefreshToken')
      .where('ac.orgId = :orgId', { orgId: organizationId })
      .getOne();

    if (!cfg?.emailEnabled || !cfg.emailAccessToken) {
      return { invoices: 0, reports: 0, errors: 0 };
    }

    const messages = await this.fetchUnreadMessages(
      cfg.emailAccessToken,
      cfg.emailProvider ?? 'gmail',
    );
    let invoices = 0,
      reports = 0,
      errors = 0;

    for (const msg of messages) {
      try {
        const exists = await this.logRepo.findOne({
          where: { orgId: organizationId, externalRef: msg.id },
        });
        if (exists) continue;

        const hasAttachments = this.hasRelevantAttachments(msg);
        const subjectLine = this.getHeader(msg, 'Subject') ?? '';
        const isDailyReport = this.matchesDailyReportPatterns(
          subjectLine,
          cfg.dailyReportSubjects ?? [],
        );

        if (hasAttachments) {
          const log = await this.processInvoiceEmail(organizationId, msg, cfg);
          if (log) invoices++;
        } else if (isDailyReport) {
          const log = await this.processDailyReportEmail(
            organizationId,
            msg,
            cfg,
          );
          if (log) reports++;
        }
      } catch (err: unknown) {
        const msg_ = err instanceof Error ? err.message : String(err);
        this.logger.error(`[InboxParser] Failed on msg ${msg.id}: ${msg_}`);
        errors++;
      }
    }

    this.logger.log(
      `[InboxParser] org=${organizationId} invoices=${invoices} reports=${reports} errors=${errors}`,
    );
    return { invoices, reports, errors };
  }

  // ── Invoice email processing ───────────────────────────────────────────────

  private async processInvoiceEmail(
    organizationId: string,
    msg: GmailMessage,
    cfg: AutomationConfig,
  ): Promise<AutomationLog | null> {
    const senderEmail = this.extractEmail(this.getHeader(msg, 'From') ?? '');
    const subject = this.getHeader(msg, 'Subject') ?? '';

    // Uses the richer parseInvoicePdf path via AiService for better accuracy
    const attachment = await this.downloadFirstRelevantAttachment(
      msg,
      cfg.emailAccessToken!,
    );
    if (!attachment) return null;

    // Route to the appropriate AiService method based on attachment type
    let parsed: Awaited<ReturnType<AiService['parseInvoicePdf']>>;
    if (attachment.mimeType === 'application/pdf') {
      parsed = await this.ai.parseInvoicePdf(attachment.base64, {
        supplierEmail: senderEmail ?? undefined,
        subject,
      });
    } else {
      // Image receipt — use scanReceiptImage with the invoice prompt
      const raw = await this.ai.scanReceiptImage(
        attachment.base64,
        attachment.mimeType,
        this.buildInvoicePrompt(),
      );
      // Map from ReceiptParsedData shape to InvoiceParsedData shape
      const receipt = this.ai.parseReceiptJSON(raw);
      parsed = {
        supplierName: receipt.merchantName,
        supplierVatNumber: receipt.merchantVatNumber,
        invoiceDate: receipt.receiptDate,
        totalAmount: receipt.totalAmount,
        vatAmount: receipt.vatAmount,
        vatRate: receipt.vatRate,
        currency: receipt.currency ?? 'EUR',
        confidence: receipt.confidence,
      };
    }

    const { supplier, created } = await this.supplierService.findOrCreate(
      organizationId,
      {
        name: parsed.supplierName ?? senderEmail ?? 'Unknown Supplier',
        vatNumber: parsed.supplierVatNumber,
        email: senderEmail ?? undefined,
      },
      'email_invoice',
    );

    if (created) {
      this.logger.log(`[InboxParser] New supplier created: ${supplier.name}`);
    }

    const confidence = parsed.confidence ?? 0;

    // FIX: autoConfirmConfidence and emailAutoConfirmBelow are string decimals.
    // Always parseFloat before numeric comparison.
    const autoConfirmThreshold = parseFloat(
      cfg.autoConfirmConfidence ?? '0.90',
    );
    const autoConfirmBelowLimit =
      cfg.emailAutoConfirmBelow != null
        ? parseFloat(cfg.emailAutoConfirmBelow)
        : null;

    const shouldAutoConfirm =
      confidence >= autoConfirmThreshold &&
      (autoConfirmBelowLimit == null ||
        (parsed.totalAmount ?? 0) <= autoConfirmBelowLimit);

    const log = this.logRepo.create({
      orgId: organizationId,
      sourceType: 'email_invoice',
      status: shouldAutoConfirm ? 'confirmed' : 'pending',
      externalRef: msg.id,
      supplierId: supplier.id,
      // FIX: confidence column is string in the entity — cast to satisfy TypeORM
      confidence: confidence as unknown as string,
      rawPayload: { subject, senderEmail, filename: attachment.filename },
      parsedData: {
        type: 'expense',
        amount: parsed.totalAmount ?? 0,
        currency: parsed.currency ?? 'EUR',
        date:
          parsed.invoiceDate ??
          new Date(parseInt(msg.internalDate)).toISOString().split('T')[0],
        description: parsed.description ?? `Invoice from ${supplier.name}`,
        category: supplier.defaultCategory ?? 'Supplier Invoices',
        supplierId: supplier.id,
        supplierName: supplier.name,
        vatAmount: parsed.vatAmount,
        vatRate: parsed.vatRate,
        receiptUrl: attachment.storedPath,
        confidence,
      },
    } as Partial<AutomationLog>);

    return this.logRepo.save(log);
  }

  // ── Daily report email processing ──────────────────────────────────────────

  private async processDailyReportEmail(
    organizationId: string,
    msg: GmailMessage,
    cfg: AutomationConfig,
  ): Promise<AutomationLog | null> {
    const body = this.extractTextBody(msg);
    if (!body) return null;

    const subject = this.getHeader(msg, 'Subject') ?? '';
    const emailDate = new Date(parseInt(msg.internalDate))
      .toISOString()
      .split('T')[0];

    // FIX: use AiService.parseDailyRevenueEmail() — it already handles the
    // prompt building, body slicing, and JSON parsing internally.
    // Previously the body was appended twice (once in buildDailyReportPrompt
    // and again at the call site).
    const parsed = await this.ai.parseDailyRevenueEmail(
      body,
      subject,
      emailDate,
    );

    if (!parsed || parsed.totalRevenue <= 0 || parsed.confidence < 0.3) {
      return null;
    }

    const log = this.logRepo.create({
      orgId: organizationId,
      sourceType: 'email_daily_report',
      status: parsed.confidence >= 0.8 ? 'confirmed' : 'pending',
      externalRef: msg.id,
      confidence: parsed.confidence as unknown as string,
      rawPayload: {
        subject,
        preview: body.slice(0, 500),
      },
      parsedData: {
        type: 'income',
        amount: parsed.totalRevenue,
        currency: parsed.currency,
        date: parsed.date,
        description: `Daily revenue — ${parsed.reportSource}`,
        category: 'Daily Sales',
        confidence: parsed.confidence,
      },
    } as Partial<AutomationLog>);

    return this.logRepo.save(log);
  }

  // ── Gmail API helpers ──────────────────────────────────────────────────────

  private async fetchUnreadMessages(
    accessToken: string,
    provider: string,
  ): Promise<GmailMessage[]> {
    if (provider === 'outlook') {
      return this.fetchOutlookMessages(accessToken);
    }
    const listRes = await firstValueFrom(
      this.http.get(`${this.GMAIL_BASE}/messages`, {
        params: {
          q: 'is:unread has:attachment OR subject:report',
          maxResults: 50,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    const ids: string[] = (listRes.data?.messages ?? []).map((m: any) => m.id);
    if (!ids.length) return [];

    return Promise.all(
      ids.map((id) =>
        firstValueFrom(
          this.http.get(`${this.GMAIL_BASE}/messages/${id}`, {
            params: { format: 'full' },
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        ).then((r) => r.data as GmailMessage),
      ),
    );
  }

  private async fetchOutlookMessages(
    accessToken: string,
  ): Promise<GmailMessage[]> {
    try {
      const res = await firstValueFrom(
        this.http.get('https://graph.microsoft.com/v1.0/me/messages', {
          params: {
            $filter: 'isRead eq false and hasAttachments eq true',
            $select: 'id,subject,from,receivedDateTime,body,attachments',
            $expand: 'attachments',
            $top: 50,
          },
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
      return (res.data?.value ?? []).map((m: any) =>
        this.normaliseOutlookMessage(m),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[InboxParser] Outlook fetch failed: ${msg}`);
      return [];
    }
  }

  private normaliseOutlookMessage(m: any): GmailMessage {
    const parts: GmailPart[] = (m.attachments ?? [])
      .filter(
        (a: any) => a['@odata.type'] === '#microsoft.graph.fileAttachment',
      )
      .map((a: any) => ({
        partId: a.id,
        mimeType: a.contentType,
        filename: a.name,
        body: { data: a.contentBytes, size: a.size },
      }));

    return {
      id: m.id,
      threadId: m.conversationId,
      internalDate: String(new Date(m.receivedDateTime).getTime()),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: m.subject ?? '' },
          { name: 'From', value: m.from?.emailAddress?.address ?? '' },
        ],
        parts,
        body: { data: btoa(m.body?.content ?? ''), size: 0 },
      },
    };
  }

  private async downloadFirstRelevantAttachment(
    msg: GmailMessage,
    accessToken: string,
  ): Promise<{
    base64: string;
    mimeType: string;
    filename: string;
    storedPath?: string;
  } | null> {
    const ACCEPTED = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    const parts = this.flattenParts(msg.payload.parts ?? []);

    for (const part of parts) {
      if (!ACCEPTED.includes(part.mimeType)) continue;

      let base64 = part.body.data;

      if (!base64 && part.body.attachmentId) {
        const res = await firstValueFrom(
          this.http.get(
            `${this.GMAIL_BASE}/messages/${msg.id}/attachments/${part.body.attachmentId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          ),
        );
        base64 = res.data?.data;
      }

      if (!base64) continue;

      // Gmail uses URL-safe base64
      const clean = base64.replace(/-/g, '+').replace(/_/g, '/');
      return {
        base64: clean,
        mimeType: part.mimeType,
        filename: part.filename,
      };
    }
    return null;
  }

  private flattenParts(parts: GmailPart[]): GmailPart[] {
    const result: GmailPart[] = [];
    for (const p of parts) {
      result.push(p);
      if (p.parts?.length) result.push(...this.flattenParts(p.parts));
    }
    return result;
  }

  private hasRelevantAttachments(msg: GmailMessage): boolean {
    const ACCEPTED = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    const parts = this.flattenParts(msg.payload.parts ?? []);
    return parts.some((p) => ACCEPTED.includes(p.mimeType) && p.body.size > 0);
  }

  private extractTextBody(msg: GmailMessage): string | null {
    const parts = this.flattenParts(msg.payload.parts ?? []);
    const plain = parts.find((p) => p.mimeType === 'text/plain');
    const data = plain?.body.data ?? msg.payload.body?.data;
    if (!data) return null;
    const clean = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(clean, 'base64').toString('utf-8');
  }

  private getHeader(msg: GmailMessage, name: string): string | null {
    return (
      msg.payload.headers.find(
        (h) => h.name.toLowerCase() === name.toLowerCase(),
      )?.value ?? null
    );
  }

  private extractEmail(from: string): string | null {
    const match = from.match(/<(.+?)>/) ?? from.match(/\S+@\S+/);
    return match ? (match[1] ?? match[0]) : null;
  }

  private matchesDailyReportPatterns(
    subject: string,
    patterns: string[],
  ): boolean {
    const defaultPatterns = [
      'daily report',
      'daily summary',
      'daily sales',
      'päeva aruanne',
      'daily total',
      'end of day',
      'z-report',
      'closing report',
    ];
    const all = [...defaultPatterns, ...patterns.map((p) => p.toLowerCase())];
    const lower = subject.toLowerCase();
    return all.some((p) => lower.includes(p));
  }

  private buildInvoicePrompt(): string {
    return `You are an invoice data extraction expert specialising in Estonian and EU business documents.
Extract all available data from this invoice/receipt image or PDF.

Return ONLY valid JSON (no markdown, no explanation):
{
  "supplierName": "Company name of the seller",
  "supplierEmail": "seller email if visible",
  "supplierVatNumber": "VAT / KM number (e.g. EE123456789) or null",
  "supplierRegNumber": "Company registration number or null",
  "invoiceNumber": "Invoice/receipt number or null",
  "invoiceDate": "ISO date YYYY-MM-DD or null",
  "dueDate": "ISO date YYYY-MM-DD or null",
  "totalAmount": <total amount as number including VAT>,
  "vatAmount": <VAT amount as number or null>,
  "vatRate": <VAT rate as percentage e.g. 22 or null>,
  "currency": "EUR",
  "description": "Short summary of what was purchased",
  "lineItems": [
    { "description": "item name", "quantity": 1, "unitPrice": 10.00, "total": 10.00 }
  ],
  "confidence": <0.0-1.0 how confident you are in the extraction>
}`;
  }
}
