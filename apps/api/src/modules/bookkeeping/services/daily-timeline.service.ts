// apps/api/src/modules/bookkeeping/services/daily-timeline.service.ts
//
// Aggregates all bookkeeping activity for a given day into a flat timeline.
// Used by the BookkeepingController to power the Daily Timeline UI.
//
// Sources merged per day:
//   - AutomationLog rows (bank import, email invoice, open banking)
//   - BookkeepingEntry rows (manual entries, order sync, receipt scans)

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AutomationLog } from '../entities/automation-log.entity';
import {
  BookkeepingEntry,
  EntryType,
  SourceType,
} from '../entities/bookkeeping.entities';

// ── Timeline event types ───────────────────────────────────────────────────────

export type TimelineEventType =
  | 'expense_manual'
  | 'expense_invoice' // auto-parsed from email invoice
  | 'expense_bank' // from bank statement / open banking
  | 'income_manual'
  | 'income_daily_report' // auto-parsed from daily report email
  | 'income_bank' // bank credit
  | 'receipt_scanned'
  | 'automation_sync'
  | 'supplier_created'
  | 'review_required';

export type TimelineEventStatus =
  | 'confirmed'
  | 'pending'
  | 'rejected'
  | 'system';

export interface TimelineEvent {
  id: string;
  time: string; // HH:MM
  timestamp: string; // ISO datetime
  type: TimelineEventType;
  status: TimelineEventStatus;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  direction?: 'in' | 'out';
  category?: string;
  supplierName?: string;
  /** 0-1, shown as a subtle confidence indicator */
  confidence?: number;
  receiptUrl?: string;
  automationLogId?: string;
  entryId?: string;
  /** Source badge: "Gmail" | "LHV" | "Manual" | "Bolt Food" etc. */
  source: string;
  /** Whether this event can be confirmed/rejected from the timeline */
  isActionable: boolean;
}

export interface DayTimeline {
  date: string; // YYYY-MM-DD
  events: TimelineEvent[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    net: number;
    currency: string;
    confirmedCount: number;
    pendingCount: number;
    autoCount: number;
    manualCount: number;
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DailyTimelineService {
  constructor(
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(BookkeepingEntry)
    private readonly entryRepo: Repository<BookkeepingEntry>,
  ) {}

  async getTimeline(
    organizationId: string,
    date: string,
  ): Promise<DayTimeline> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    // ── Automation logs (bank import, email, open banking) ─────────────────
    const automationLogs = await this.logRepo.find({
      where: {
        orgId: organizationId,
        createdAt: Between(start, end),
      },
      order: { createdAt: 'ASC' },
    });

    // ── Manual / order-sync / receipt-scan BookkeepingEntry rows ──────────
    // We query by the entry's own `date` field (the real-world transaction date)
    // rather than createdAt, so a receipt entered the next morning still shows
    // on the correct day's timeline.
    const manualEntries = await this.entryRepo.find({
      where: {
        orgId: organizationId,
        date: date as unknown as string, // date column is stored as YYYY-MM-DD string
      },
      order: { createdAt: 'ASC' },
    });

    // Entries that came from automation already have an AutomationLog — skip
    // them here to avoid duplicates. Keep MANUAL, RECEIPT_SCAN, ORDER_SYNC,
    // INVOICE_SYNC. BANK_IMPORT entries are represented via AutomationLog.
    const AUTOMATION_SOURCES: SourceType[] = [SourceType.BANK_IMPORT];
    const directEntries = manualEntries.filter(
      (e) => !AUTOMATION_SOURCES.includes(e.sourceType),
    );

    // Also exclude entries that already have a matching AutomationLog (entryId link)
    const loggedEntryIds = new Set(
      automationLogs.map((l) => l.entryId).filter(Boolean),
    );
    const unlinkedEntries = directEntries.filter(
      (e) => !loggedEntryIds.has(e.id),
    );

    // ── Build event list ───────────────────────────────────────────────────
    const events: TimelineEvent[] = [
      ...automationLogs.map((log) => this.logToEvent(log)),
      ...unlinkedEntries.map((entry) => this.entryToEvent(entry)),
    ];

    // Sort chronologically by timestamp
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return {
      date,
      events,
      summary: this.computeSummary(events),
    };
  }

  async getTimelineRange(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<DayTimeline[]> {
    const dates: string[] = [];
    const cursor = new Date(from);
    const end = new Date(to);
    while (cursor <= end) {
      dates.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
    return Promise.all(dates.map((d) => this.getTimeline(organizationId, d)));
  }

  // ── Conversion: AutomationLog → TimelineEvent ──────────────────────────────

  private logToEvent(log: AutomationLog): TimelineEvent {
    const data = log.parsedData;
    const time = new Date(log.createdAt).toTimeString().slice(0, 5);

    const typeMap: Record<string, TimelineEventType> = {
      email_invoice: 'expense_invoice',
      email_daily_report: 'income_daily_report',
      bank_statement_pdf:
        data?.type === 'income' ? 'income_bank' : 'expense_bank',
      open_banking: data?.type === 'income' ? 'income_bank' : 'expense_bank',
    };

    const sourceMap: Record<string, string> = {
      email_invoice: 'Gmail',
      email_daily_report: 'Email Report',
      bank_statement_pdf: 'Bank PDF',
      open_banking: 'Open Banking',
    };

    return {
      id: log.id,
      time,
      timestamp: log.createdAt.toISOString(),
      type: typeMap[log.sourceType] ?? 'expense_manual',
      status: log.status as TimelineEventStatus,
      title: data?.description ?? 'Entry',
      subtitle: data?.supplierName
        ? `${sourceMap[log.sourceType]} · ${data.supplierName}`
        : sourceMap[log.sourceType],
      amount: data?.amount,
      currency: data?.currency,
      direction: data?.type === 'income' ? 'in' : 'out',
      category: data?.category,
      supplierName: data?.supplierName,
      // FIX: confidence is string | null — parse before exposing as number
      confidence: log.confidence != null ? Number(log.confidence) : undefined,
      receiptUrl: data?.receiptUrl,
      automationLogId: log.id,
      entryId: log.entryId ?? undefined,
      source: sourceMap[log.sourceType] ?? 'Automation',
      isActionable: log.status === 'pending',
    };
  }

  // ── Conversion: BookkeepingEntry → TimelineEvent ───────────────────────────

  private entryToEvent(entry: BookkeepingEntry): TimelineEvent {
    const time = new Date(entry.createdAt).toTimeString().slice(0, 5);
    const isIncome = entry.entryType === EntryType.INCOME;
    const isSalary = entry.entryType === EntryType.SALARY;

    let type: TimelineEventType;
    if (entry.sourceType === SourceType.RECEIPT_SCAN) {
      type = 'receipt_scanned';
    } else if (isIncome) {
      type = 'income_manual';
    } else {
      type = 'expense_manual';
    }

    const sourceLabel: Record<SourceType, string> = {
      [SourceType.MANUAL]: 'Manual',
      [SourceType.RECEIPT_SCAN]: 'Receipt',
      [SourceType.ORDER_SYNC]: 'Order Sync',
      [SourceType.INVOICE_SYNC]: 'Invoice Sync',
      [SourceType.BANK_IMPORT]: 'Bank Import',
    };

    return {
      id: entry.id,
      time,
      timestamp: entry.createdAt.toISOString(),
      type,
      status: 'confirmed', // Manual entries are always confirmed on creation
      title: entry.description,
      subtitle: entry.counterpartyName
        ? `${sourceLabel[entry.sourceType]} · ${entry.counterpartyName}`
        : sourceLabel[entry.sourceType],
      // FIX: grossAmount is string — parse before arithmetic
      amount: Number(entry.grossAmount),
      currency: 'EUR',
      direction: isIncome ? 'in' : isSalary ? 'out' : 'out',
      category: entry.category,
      supplierName: entry.counterpartyName ?? undefined,
      receiptUrl: entry.receiptImageUrl ?? undefined,
      entryId: entry.id,
      source: sourceLabel[entry.sourceType],
      isActionable: false,
    };
  }

  // ── Summary computation ────────────────────────────────────────────────────

  private computeSummary(events: TimelineEvent[]): DayTimeline['summary'] {
    let totalIncome = 0,
      totalExpenses = 0,
      autoCount = 0,
      manualCount = 0,
      confirmedCount = 0,
      pendingCount = 0;

    const AUTO_TYPES: TimelineEventType[] = [
      'expense_invoice',
      'income_daily_report',
      'expense_bank',
      'income_bank',
    ];

    for (const e of events) {
      if (e.status === 'confirmed' && e.amount != null) {
        if (e.direction === 'in') totalIncome += e.amount;
        else totalExpenses += e.amount;
      }
      if (e.status === 'confirmed') confirmedCount++;
      if (e.status === 'pending') pendingCount++;
      if (AUTO_TYPES.includes(e.type)) autoCount++;
      else manualCount++;
    }

    return {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      net: Math.round((totalIncome - totalExpenses) * 100) / 100,
      currency: events.find((e) => e.currency)?.currency ?? 'EUR',
      confirmedCount,
      pendingCount,
      autoCount,
      manualCount,
    };
  }
}
// apps/api/src/modules/bookkeeping/services/daily-timeline.service.ts
// //
// // Aggregates all bookkeeping activity for a given day into a flat timeline.
// // Used by the BookkeepingController to power the Daily Timeline UI.
// //
// // Each timeline event has a consistent shape regardless of source
// // (manual entry, automation, receipt scan, bank sync).

// import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository, Between } from 'typeorm';
// import { AutomationLog } from '../entities/automation-log.entity';

// // ── Timeline event type ────────────────────────────────────────────────────────

// export type TimelineEventType =
//   | 'expense_manual' // manually entered expense
//   | 'expense_invoice' // auto-parsed from email invoice
//   | 'expense_bank' // from bank statement / open banking
//   | 'income_manual' // manually entered income
//   | 'income_daily_report' // auto-parsed from daily report email
//   | 'income_bank' // bank credit
//   | 'receipt_scanned' // receipt photo scanned
//   | 'automation_sync' // system event: inbox/bank sync ran
//   | 'supplier_created' // new supplier auto-created
//   | 'review_required'; // item landed in review queue

// export type TimelineEventStatus =
//   | 'confirmed' // accepted / auto-confirmed
//   | 'pending' // waiting review
//   | 'rejected' // discarded
//   | 'system'; // informational event

// export interface TimelineEvent {
//   id: string;
//   time: string; // HH:MM
//   timestamp: string; // ISO datetime
//   type: TimelineEventType;
//   status: TimelineEventStatus;
//   title: string; // e.g. "Invoice from Bolt Food OÜ"
//   subtitle?: string; // e.g. "Parsed from email · EE123456789"
//   amount?: number;
//   currency?: string;
//   direction?: 'in' | 'out';
//   category?: string;
//   supplierName?: string;
//   confidence?: number; // 0-1, shown as a subtle indicator
//   receiptUrl?: string;
//   automationLogId?: string;
//   entryId?: string;
//   /** Source badge: "Gmail" | "LHV" | "Manual" | "Bolt Food" etc. */
//   source: string;
//   /** Can this event be confirmed/rejected from the timeline? */
//   isActionable: boolean;
// }

// export interface DayTimeline {
//   date: string; // YYYY-MM-DD
//   events: TimelineEvent[];
//   summary: {
//     totalIncome: number;
//     totalExpenses: number;
//     net: number;
//     currency: string;
//     confirmedCount: number;
//     pendingCount: number;
//     autoCount: number; // events created by automation
//     manualCount: number;
//   };
// }

// // ── Service ────────────────────────────────────────────────────────────────────

// @Injectable()
// export class DailyTimelineService {
//   constructor(
//     @InjectRepository(AutomationLog)
//     private readonly logRepo: Repository<AutomationLog>,
//     // Inject BookkeepingEntry repo when wiring up manual entries
//     // @InjectRepository(BookkeepingEntry)
//     // private readonly entryRepo: Repository<BookkeepingEntry>,
//   ) {}

//   async getTimeline(
//     organizationId: string,
//     date: string,
//   ): Promise<DayTimeline> {
//     const start = new Date(`${date}T00:00:00.000Z`);
//     const end = new Date(`${date}T23:59:59.999Z`);

//     // Fetch automation logs for this day
//     const automationLogs = await this.logRepo.find({
//       where: {
//         orgId: organizationId,
//         createdAt: Between(start, end),
//       },
//       order: { createdAt: 'ASC' },
//     });

//     // TODO: Also fetch manual BookkeepingEntry rows for the same date
//     // const manualEntries = await this.entryRepo.find({ where: { organizationId, date } });

//     const events: TimelineEvent[] = automationLogs.map((log) =>
//       this.logToEvent(log),
//     );

//     // Sort all events by timestamp
//     events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

//     return {
//       date,
//       events,
//       summary: this.computeSummary(events),
//     };
//   }

//   async getTimelineRange(
//     organizationId: string,
//     from: string,
//     to: string,
//   ): Promise<DayTimeline[]> {
//     const dates: string[] = [];
//     const cursor = new Date(from);
//     const end = new Date(to);
//     while (cursor <= end) {
//       dates.push(cursor.toISOString().split('T')[0]);
//       cursor.setDate(cursor.getDate() + 1);
//     }
//     return Promise.all(dates.map((d) => this.getTimeline(organizationId, d)));
//   }

//   // ── Conversion helpers ─────────────────────────────────────────────────────

//   private logToEvent(log: AutomationLog): TimelineEvent {
//     const data = log.parsedData;
//     const time = new Date(log.createdAt).toTimeString().slice(0, 5);

//     const typeMap: Record<string, TimelineEventType> = {
//       email_invoice: 'expense_invoice',
//       email_daily_report: 'income_daily_report',
//       bank_statement_pdf:
//         data?.type === 'income' ? 'income_bank' : 'expense_bank',
//       open_banking: data?.type === 'income' ? 'income_bank' : 'expense_bank',
//     };

//     const sourceMap: Record<string, string> = {
//       email_invoice: 'Gmail',
//       email_daily_report: 'Email Report',
//       bank_statement_pdf: 'Bank PDF',
//       open_banking: 'Open Banking',
//     };

//     return {
//       id: log.id,
//       time,
//       timestamp: log.createdAt.toISOString(),
//       type: typeMap[log.sourceType] ?? 'expense_manual',
//       status: log.status as TimelineEventStatus,
//       title: data?.description ?? 'Entry',
//       subtitle: data?.supplierName
//         ? `${sourceMap[log.sourceType]} · ${data.supplierName}`
//         : sourceMap[log.sourceType],
//       amount: data?.amount,
//       currency: data?.currency,
//       direction: data?.type === 'income' ? 'in' : 'out',
//       category: data?.category,
//       supplierName: data?.supplierName,
//       confidence: log.confidence ? Number(log.confidence) : undefined,
//       receiptUrl: data?.receiptUrl,
//       automationLogId: log.id,
//       entryId: log.entryId ?? undefined,
//       source: sourceMap[log.sourceType] ?? 'Manual',
//       isActionable: log.status === 'pending',
//     };
//   }

//   private computeSummary(events: TimelineEvent[]) {
//     let totalIncome = 0,
//       totalExpenses = 0,
//       autoCount = 0,
//       manualCount = 0;
//     let confirmedCount = 0,
//       pendingCount = 0;

//     for (const e of events) {
//       if (e.status === 'confirmed' && e.amount) {
//         if (e.direction === 'in') totalIncome += e.amount;
//         else totalExpenses += e.amount;
//       }
//       if (e.status === 'confirmed') confirmedCount++;
//       if (e.status === 'pending') pendingCount++;
//       if (
//         [
//           'expense_invoice',
//           'income_daily_report',
//           'expense_bank',
//           'income_bank',
//         ].includes(e.type)
//       ) {
//         autoCount++;
//       } else {
//         manualCount++;
//       }
//     }

//     return {
//       totalIncome: Math.round(totalIncome * 100) / 100,
//       totalExpenses: Math.round(totalExpenses * 100) / 100,
//       net: Math.round((totalIncome - totalExpenses) * 100) / 100,
//       currency: events[0]?.currency ?? 'EUR',
//       confirmedCount,
//       pendingCount,
//       autoCount,
//       manualCount,
//     };
//   }
// }

// // ── Controller endpoint (add to existing bookkeeping.controller.ts) ────────────
// /*
//   @Get('timeline')
//   async getTimeline(
//     @Request() req: any,
//     @Query('date') date: string,
//   ) {
//     return this.dailyTimelineService.getTimeline(req.user.organizationId, date);
//   }

//   @Get('timeline/range')
//   async getTimelineRange(
//     @Request() req: any,
//     @Query('from') from: string,
//     @Query('to') to: string,
//   ) {
//     return this.dailyTimelineService.getTimelineRange(req.user.organizationId, from, to);
//   }
// */
