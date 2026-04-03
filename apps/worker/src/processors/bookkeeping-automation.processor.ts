/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/worker/src/processors/bookkeeping-automation.processor.ts
//
// Bull queue processors for the three automation channels.
//
// Queues:
//   bookkeeping-inbox-sync      — runs every 15 min per org that has email enabled
//   bookkeeping-open-banking    — runs every 60 min per org that has PSD2 enabled
//   bookkeeping-entry-flush     — converts confirmed AutomationLogs → BookkeepingEntry rows

import { Processor, Process, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { InboxParserService } from 'apps/api/src/modules/bookkeeping/services/inbox-parser.service';
import { AutomationConfig } from 'apps/api/src/modules/bookkeeping/entities/automation-config.entity';
import { AutomationLog } from 'apps/api/src/modules/bookkeeping/entities/automation-log.entity';
import { OpenBankingService } from 'apps/api/src/modules/bookkeeping/services/open-banking.service';

// ── Inbox sync processor ───────────────────────────────────────────────────────

@Processor('bookkeeping-inbox-sync')
export class InboxSyncProcessor {
  private readonly logger = new Logger(InboxSyncProcessor.name);

  constructor(
    private readonly inboxParser: InboxParserService,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  @Process('sync-all-orgs')
  async syncAllOrgs(_job: Job) {
    // Fetch all orgs that have email enabled
    const configs = await this.configRepo.find({
      where: { emailEnabled: true },
      select: ['orgId'],
    });

    this.logger.log(`[InboxSync] Syncing ${configs.length} organisations`);

    const results = await Promise.allSettled(
      configs.map((c) => this.inboxParser.syncInbox(c.orgId)),
    );

    const totals = results.reduce(
      (acc, r) => {
        if (r.status === 'fulfilled') {
          acc.invoices += r.value.invoices;
          acc.reports += r.value.reports;
          acc.errors += r.value.errors;
        } else {
          acc.errors++;
        }
        return acc;
      },
      { invoices: 0, reports: 0, errors: 0 },
    );

    this.logger.log(
      `[InboxSync] Done: invoices=${totals.invoices} reports=${totals.reports} errors=${totals.errors}`,
    );
    return totals;
  }
}

// ── Open banking processor ─────────────────────────────────────────────────────

@Processor('bookkeeping-open-banking')
export class OpenBankingProcessor {
  private readonly logger = new Logger(OpenBankingProcessor.name);

  constructor(
    private readonly openBanking: OpenBankingService,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {}

  @Process('sync-all-orgs')
  async syncAllOrgs(_job: Job) {
    const configs = await this.configRepo.find({
      where: { openBankingEnabled: true },
      select: ['orgId'],
    });

    this.logger.log(`[OpenBanking] Syncing ${configs.length} organisations`);

    const results = await Promise.allSettled(
      configs.map((c) => this.openBanking.syncTransactions(c.orgId)),
    );

    const totals = results.reduce(
      (acc, r) => {
        if (r.status === 'fulfilled') {
          acc.created += r.value.created;
          acc.errors += r.value.errors;
        } else {
          acc.errors++;
        }
        return acc;
      },
      { created: 0, errors: 0 },
    );

    this.logger.log(
      `[OpenBanking] Done: created=${totals.created} errors=${totals.errors}`,
    );
    return totals;
  }
}

// ── Entry flush processor ──────────────────────────────────────────────────────
// Takes confirmed AutomationLogs and writes them as real BookkeepingEntry rows.
// This is decoupled from confirmation so the UI stays snappy.

@Processor('bookkeeping-entry-flush')
export class EntryFlushProcessor {
  private readonly logger = new Logger(EntryFlushProcessor.name);

  constructor(
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
    // Inject EntryService from bookkeeping module (already exists in the codebase)
    // private readonly entryService: EntryService,
  ) {}

  @Process('flush-confirmed')
  async flushConfirmed(_job: Job) {
    // Find all confirmed logs that haven't been flushed yet (entryId is null)
    const logs = await this.logRepo.find({
      where: { status: 'confirmed', entryId: '' },
      take: 100,
      order: { createdAt: 'ASC' },
    });

    if (!logs.length) return { flushed: 0 };

    this.logger.log(
      `[EntryFlush] Flushing ${logs.length} confirmed automation logs`,
    );

    let flushed = 0;
    for (const log of logs) {
      try {
        if (!log.parsedData) continue;

        // TODO: Wire to your existing EntryService.create() method.
        // The parsedData shape maps directly to CreateBookkeepingEntryDto:
        // await this.entryService.create(log.organizationId, {
        //   type: log.parsedData.type,
        //   amount: log.parsedData.amount,
        //   currency: log.parsedData.currency,
        //   date: log.parsedData.date,
        //   description: log.parsedData.description,
        //   category: log.parsedData.category,
        //   supplierId: log.parsedData.supplierId,
        //   vatAmount: log.parsedData.vatAmount,
        //   receiptUrl: log.parsedData.receiptUrl,
        //   source: 'automation',
        //   automationLogId: log.id,
        // });

        // Mark as flushed with a placeholder entry ID
        log.entryId = `flushed:${Date.now()}`;
        await this.logRepo.save(log);
        flushed++;
      } catch (err: any) {
        this.logger.error(`[EntryFlush] Failed log ${log.id}: ${err.message}`);
        log.status = 'error';
        log.errorMessage = err.message;
        await this.logRepo.save(log);
      }
    }

    return { flushed };
  }
}

// ── Scheduler — registers recurring jobs ──────────────────────────────────────

@Injectable()
export class AutomationScheduler implements OnModuleInit {
  constructor(
    @InjectQueue('bookkeeping-inbox-sync') private readonly inboxQueue: Queue,
    @InjectQueue('bookkeeping-open-banking') private readonly obQueue: Queue,
    @InjectQueue('bookkeeping-entry-flush') private readonly flushQueue: Queue,
  ) {}

  async onModuleInit() {
    // Inbox sync: every 15 minutes
    await this.inboxQueue.add(
      'sync-all-orgs',
      {},
      {
        repeat: { cron: '*/15 * * * *' },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    // Open banking: every hour
    await this.obQueue.add(
      'sync-all-orgs',
      {},
      {
        repeat: { cron: '0 * * * *' },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    // Entry flush: every 5 minutes
    await this.flushQueue.add(
      'flush-confirmed',
      {},
      {
        repeat: { cron: '*/5 * * * *' },
        removeOnComplete: 100,
        removeOnFail: 20,
      },
    );
  }
}
