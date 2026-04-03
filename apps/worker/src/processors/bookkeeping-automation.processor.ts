/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/worker/src/processors/bookkeeping-automation.processor.ts
//
// Bull queue processors for bookkeeping automation channels.
//
// Queues:
//   bookkeeping-inbox-sync    — every 15 min, syncs email for orgs with email enabled
//   bookkeeping-open-banking  — every 60 min, syncs bank feed for PSD2-enabled orgs
//   bookkeeping-log-cleanup   — every 24h, removes stale/orphaned automation logs
//
// NOTE: The old "bookkeeping-entry-flush" queue has been removed.
// BankStatementService and OpenBankingService now write BookkeepingEntry rows
// directly at the time of processing — there is no longer a two-step
// log → flush → entry pipeline. If you have this queue registered in Redis
// from a previous deployment, drain and delete it.
//
// IMPORT NOTE: These processors live in the worker app but import from the api
// app. In a monorepo this is done via path aliases (e.g. @app/bookkeeping).
// If your tsconfig does not have that alias, replace these imports with the
// shared library path or extract the services into a shared libs package.

import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import { Job, Queue } from 'bullmq';

// TODO: replace with @app/bookkeeping alias once the shared lib is extracted
import { InboxParserService } from 'apps/api/src/modules/bookkeeping/services/inbox-parser.service';
import { OpenBankingService } from 'apps/api/src/modules/bookkeeping/services/open-banking.service';
import { AutomationConfig } from 'apps/api/src/modules/bookkeeping/entities/automation-config.entity';
import { AutomationLog } from 'apps/api/src/modules/bookkeeping/entities/automation-log.entity';

// ── Inbox sync processor ───────────────────────────────────────────────────────

// FIX: @Processor + WorkerHost is the correct BullMQ v2 pattern.
// The old @nestjs/bull used @Process() on methods; @nestjs/bullmq uses
// WorkerHost.process() override instead.

@Processor('bookkeeping-inbox-sync')
export class InboxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(InboxSyncProcessor.name);

  constructor(
    private readonly inboxParser: InboxParserService,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ invoices: number; reports: number; errors: number }> {
    if (job.name !== 'sync-all-orgs') {
      this.logger.warn(`[InboxSync] Unknown job name: ${job.name}`);
      return { invoices: 0, reports: 0, errors: 0 };
    }

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
          this.logger.error(`[InboxSync] Org sync failed`, r.reason);
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
export class OpenBankingProcessor extends WorkerHost {
  private readonly logger = new Logger(OpenBankingProcessor.name);

  constructor(
    private readonly openBanking: OpenBankingService,
    @InjectRepository(AutomationConfig)
    private readonly configRepo: Repository<AutomationConfig>,
  ) {
    super();
  }

  async process(job: Job): Promise<{ created: number; errors: number }> {
    if (job.name !== 'sync-all-orgs') {
      this.logger.warn(`[OpenBanking] Unknown job name: ${job.name}`);
      return { created: 0, errors: 0 };
    }

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
          this.logger.error(`[OpenBanking] Org sync failed`, r.reason);
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

// ── Log cleanup processor ──────────────────────────────────────────────────────
// Replaces the old EntryFlushProcessor entirely.
//
// Now that entries are written directly during bank/email processing, this job
// only needs to:
//   1. Flag orphaned logs (confirmed but no entryId after 24h) as errors
//   2. Prune very old rejected logs to keep the table lean

@Processor('bookkeeping-log-cleanup')
export class LogCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(LogCleanupProcessor.name);

  constructor(
    @InjectRepository(AutomationLog)
    private readonly logRepo: Repository<AutomationLog>,
  ) {
    super();
  }

  async process(job: Job): Promise<{ flagged: number; pruned: number }> {
    if (job.name !== 'cleanup') {
      return { flagged: 0, pruned: 0 };
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // FIX: original used entryId: '' to find null entries — empty string never
    // matches a NULL column in Postgres. Use TypeORM's IsNull() operator.
    const orphanedLogs = await this.logRepo.find({
      where: {
        status: 'confirmed',
        entryId: IsNull(),
        createdAt: LessThan(oneDayAgo),
      },
      take: 200,
    });

    let flagged = 0;
    for (const log of orphanedLogs) {
      // Only flag logs that are genuinely orphaned (not the pdf_file sentinels
      // which intentionally have no entryId)
      if (log.parsedData === null) continue;

      log.status = 'error';
      log.errorMessage =
        'Entry was confirmed but no bookkeeping entry was created within 24h. Re-process manually.';
      await this.logRepo.save(log);
      flagged++;
    }

    // Prune rejected logs older than 90 days
    const pruneResult = await this.logRepo
      .createQueryBuilder()
      .delete()
      .where('status = :status', { status: 'rejected' })
      .andWhere('createdAt < :cutoff', { cutoff: ninetyDaysAgo })
      .execute();

    const pruned = pruneResult.affected ?? 0;

    this.logger.log(`[LogCleanup] flagged=${flagged} pruned=${pruned}`);
    return { flagged, pruned };
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

@Injectable()
export class AutomationScheduler implements OnModuleInit {
  private readonly logger = new Logger(AutomationScheduler.name);

  constructor(
    @InjectQueue('bookkeeping-inbox-sync') private readonly inboxQueue: Queue,
    @InjectQueue('bookkeeping-open-banking') private readonly obQueue: Queue,
    @InjectQueue('bookkeeping-log-cleanup')
    private readonly cleanupQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.upsertRepeatable(
      this.inboxQueue,
      'sync-all-orgs',
      '*/15 * * * *',
    );
    await this.upsertRepeatable(this.obQueue, 'sync-all-orgs', '0 * * * *');
    await this.upsertRepeatable(this.cleanupQueue, 'cleanup', '0 3 * * *');
  }

  /**
   * FIX: naively calling queue.add() with repeat on every restart registers
   * duplicate repeatable jobs in Redis — each restart adds another entry.
   * Instead: fetch existing repeatables, remove the matching one if it exists,
   * then re-add. This makes the cron expression update-safe too.
   */
  private async upsertRepeatable(
    queue: Queue,
    jobName: string,
    cron: string,
  ): Promise<void> {
    try {
      const existing = await queue.getRepeatableJobs();
      const match = existing.find((j) => j.name === jobName);
      if (match) {
        await queue.removeRepeatableByKey(match.key);
        this.logger.log(
          `[Scheduler] Removed stale repeatable "${jobName}" from ${queue.name}`,
        );
      }

      await queue.add(
        jobName,
        {},
        {
          repeat: { pattern: cron },
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );

      this.logger.log(
        `[Scheduler] Registered "${jobName}" on ${queue.name} (${cron})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[Scheduler] Failed to register "${jobName}" on ${queue.name}: ${msg}`,
      );
    }
  }
}
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unused-vars */
// // apps/worker/src/processors/bookkeeping-automation.processor.ts
// //
// // Bull queue processors for the three automation channels.
// //
// // Queues:
// //   bookkeeping-inbox-sync      — runs every 15 min per org that has email enabled
// //   bookkeeping-open-banking    — runs every 60 min per org that has PSD2 enabled
// //   bookkeeping-entry-flush     — converts confirmed AutomationLogs → BookkeepingEntry rows

// import { Processor, Process, InjectQueue } from '@nestjs/bullmq';
// import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Job, Queue } from 'bullmq';
// import { InboxParserService } from 'apps/api/src/modules/bookkeeping/services/inbox-parser.service';
// import { AutomationConfig } from 'apps/api/src/modules/bookkeeping/entities/automation-config.entity';
// import { AutomationLog } from 'apps/api/src/modules/bookkeeping/entities/automation-log.entity';
// import { OpenBankingService } from 'apps/api/src/modules/bookkeeping/services/open-banking.service';

// // ── Inbox sync processor ───────────────────────────────────────────────────────

// @Processor('bookkeeping-inbox-sync')
// export class InboxSyncProcessor {
//   private readonly logger = new Logger(InboxSyncProcessor.name);

//   constructor(
//     private readonly inboxParser: InboxParserService,
//     @InjectRepository(AutomationConfig)
//     private readonly configRepo: Repository<AutomationConfig>,
//   ) {}

//   @Process('sync-all-orgs')
//   async syncAllOrgs(_job: Job) {
//     // Fetch all orgs that have email enabled
//     const configs = await this.configRepo.find({
//       where: { emailEnabled: true },
//       select: ['orgId'],
//     });

//     this.logger.log(`[InboxSync] Syncing ${configs.length} organisations`);

//     const results = await Promise.allSettled(
//       configs.map((c) => this.inboxParser.syncInbox(c.orgId)),
//     );

//     const totals = results.reduce(
//       (acc, r) => {
//         if (r.status === 'fulfilled') {
//           acc.invoices += r.value.invoices;
//           acc.reports += r.value.reports;
//           acc.errors += r.value.errors;
//         } else {
//           acc.errors++;
//         }
//         return acc;
//       },
//       { invoices: 0, reports: 0, errors: 0 },
//     );

//     this.logger.log(
//       `[InboxSync] Done: invoices=${totals.invoices} reports=${totals.reports} errors=${totals.errors}`,
//     );
//     return totals;
//   }
// }

// // ── Open banking processor ─────────────────────────────────────────────────────

// @Processor('bookkeeping-open-banking')
// export class OpenBankingProcessor {
//   private readonly logger = new Logger(OpenBankingProcessor.name);

//   constructor(
//     private readonly openBanking: OpenBankingService,
//     @InjectRepository(AutomationConfig)
//     private readonly configRepo: Repository<AutomationConfig>,
//   ) {}

//   @Process('sync-all-orgs')
//   async syncAllOrgs(_job: Job) {
//     const configs = await this.configRepo.find({
//       where: { openBankingEnabled: true },
//       select: ['orgId'],
//     });

//     this.logger.log(`[OpenBanking] Syncing ${configs.length} organisations`);

//     const results = await Promise.allSettled(
//       configs.map((c) => this.openBanking.syncTransactions(c.orgId)),
//     );

//     const totals = results.reduce(
//       (acc, r) => {
//         if (r.status === 'fulfilled') {
//           acc.created += r.value.created;
//           acc.errors += r.value.errors;
//         } else {
//           acc.errors++;
//         }
//         return acc;
//       },
//       { created: 0, errors: 0 },
//     );

//     this.logger.log(
//       `[OpenBanking] Done: created=${totals.created} errors=${totals.errors}`,
//     );
//     return totals;
//   }
// }

// // ── Entry flush processor ──────────────────────────────────────────────────────
// // Takes confirmed AutomationLogs and writes them as real BookkeepingEntry rows.
// // This is decoupled from confirmation so the UI stays snappy.

// @Processor('bookkeeping-entry-flush')
// export class EntryFlushProcessor {
//   private readonly logger = new Logger(EntryFlushProcessor.name);

//   constructor(
//     @InjectRepository(AutomationLog)
//     private readonly logRepo: Repository<AutomationLog>,
//     // Inject EntryService from bookkeeping module (already exists in the codebase)
//     // private readonly entryService: EntryService,
//   ) {}

//   @Process('flush-confirmed')
//   async flushConfirmed(_job: Job) {
//     // Find all confirmed logs that haven't been flushed yet (entryId is null)
//     const logs = await this.logRepo.find({
//       where: { status: 'confirmed', entryId: '' },
//       take: 100,
//       order: { createdAt: 'ASC' },
//     });

//     if (!logs.length) return { flushed: 0 };

//     this.logger.log(
//       `[EntryFlush] Flushing ${logs.length} confirmed automation logs`,
//     );

//     let flushed = 0;
//     for (const log of logs) {
//       try {
//         if (!log.parsedData) continue;

//         // TODO: Wire to your existing EntryService.create() method.
//         // The parsedData shape maps directly to CreateBookkeepingEntryDto:
//         // await this.entryService.create(log.organizationId, {
//         //   type: log.parsedData.type,
//         //   amount: log.parsedData.amount,
//         //   currency: log.parsedData.currency,
//         //   date: log.parsedData.date,
//         //   description: log.parsedData.description,
//         //   category: log.parsedData.category,
//         //   supplierId: log.parsedData.supplierId,
//         //   vatAmount: log.parsedData.vatAmount,
//         //   receiptUrl: log.parsedData.receiptUrl,
//         //   source: 'automation',
//         //   automationLogId: log.id,
//         // });

//         // Mark as flushed with a placeholder entry ID
//         log.entryId = `flushed:${Date.now()}`;
//         await this.logRepo.save(log);
//         flushed++;
//       } catch (err: any) {
//         this.logger.error(`[EntryFlush] Failed log ${log.id}: ${err.message}`);
//         log.status = 'error';
//         log.errorMessage = err.message;
//         await this.logRepo.save(log);
//       }
//     }

//     return { flushed };
//   }
// }

// // ── Scheduler — registers recurring jobs ──────────────────────────────────────

// @Injectable()
// export class AutomationScheduler implements OnModuleInit {
//   constructor(
//     @InjectQueue('bookkeeping-inbox-sync') private readonly inboxQueue: Queue,
//     @InjectQueue('bookkeeping-open-banking') private readonly obQueue: Queue,
//     @InjectQueue('bookkeeping-entry-flush') private readonly flushQueue: Queue,
//   ) {}

//   async onModuleInit() {
//     // Inbox sync: every 15 minutes
//     await this.inboxQueue.add(
//       'sync-all-orgs',
//       {},
//       {
//         repeat: { cron: '*/15 * * * *' },
//         removeOnComplete: 50,
//         removeOnFail: 20,
//       },
//     );

//     // Open banking: every hour
//     await this.obQueue.add(
//       'sync-all-orgs',
//       {},
//       {
//         repeat: { cron: '0 * * * *' },
//         removeOnComplete: 50,
//         removeOnFail: 20,
//       },
//     );

//     // Entry flush: every 5 minutes
//     await this.flushQueue.add(
//       'flush-confirmed',
//       {},
//       {
//         repeat: { cron: '*/5 * * * *' },
//         removeOnComplete: 100,
//         removeOnFail: 20,
//       },
//     );
//   }
// }
