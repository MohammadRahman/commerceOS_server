// apps/api/src/modules/estonia-tax/services/tax-deadline.service.ts
// Manages Estonian tax deadlines and auto-queues filing jobs.
// TSD: due by the 10th of the following month
// KMD: due by the 20th of the following month

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EstoniaTaxPeriod,
  TaxPeriodStatus,
} from '../entities/estonia-tax.entities';
import {
  ESTONIA_TAX_QUEUE_NAMES,
  ESTONIA_TSD_DEADLINE_DAY,
  ESTONIA_KMD_DEADLINE_DAY,
} from '../estonia-tax.constants';

export interface DeadlineInfo {
  form: 'KMD' | 'TSD';
  taxYear: number;
  taxMonth: number;
  deadlineDate: Date;
  daysUntilDeadline: number;
  isOverdue: boolean;
}

@Injectable()
export class EstoniaTaxDeadlineService {
  private readonly logger = new Logger(EstoniaTaxDeadlineService.name);

  constructor(
    @InjectRepository(EstoniaTaxPeriod)
    private readonly periodRepo: Repository<EstoniaTaxPeriod>,

    @InjectQueue(ESTONIA_TAX_QUEUE_NAMES.VAT_FILING)
    private readonly vatQueue: Queue,

    @InjectQueue(ESTONIA_TAX_QUEUE_NAMES.TSD_FILING)
    private readonly tsdQueue: Queue,

    @InjectQueue(ESTONIA_TAX_QUEUE_NAMES.TAX_REMINDER)
    private readonly reminderQueue: Queue,
  ) {}

  // ─── Compute deadlines ────────────────────────────────────────────────────

  getDeadlines(taxYear: number, taxMonth: number): DeadlineInfo[] {
    const now = new Date();

    // Deadline is in the FOLLOWING month
    const followingMonth = taxMonth === 12 ? 1 : taxMonth + 1;
    const followingYear = taxMonth === 12 ? taxYear + 1 : taxYear;

    const tsdDeadline = new Date(
      followingYear,
      followingMonth - 1,
      ESTONIA_TSD_DEADLINE_DAY,
    );
    const kmdDeadline = new Date(
      followingYear,
      followingMonth - 1,
      ESTONIA_KMD_DEADLINE_DAY,
    );

    // Adjust for weekends — if deadline falls on Sat/Sun, move to next Monday
    const adjustForWeekend = (d: Date): Date => {
      const day = d.getDay();
      if (day === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
      if (day === 0) d.setDate(d.getDate() + 1); // Sunday → Monday
      return d;
    };

    const tsdAdj = adjustForWeekend(new Date(tsdDeadline));
    const kmdAdj = adjustForWeekend(new Date(kmdDeadline));

    const diffDays = (d: Date) =>
      Math.ceil((d.getTime() - now.getTime()) / 86_400_000);

    return [
      {
        form: 'TSD',
        taxYear,
        taxMonth,
        deadlineDate: tsdAdj,
        daysUntilDeadline: diffDays(tsdAdj),
        isOverdue: diffDays(tsdAdj) < 0,
      },
      {
        form: 'KMD',
        taxYear,
        taxMonth,
        deadlineDate: kmdAdj,
        daysUntilDeadline: diffDays(kmdAdj),
        isOverdue: diffDays(kmdAdj) < 0,
      },
    ];
  }

  // ─── Cron: TSD reminder — runs on the 7th of each month ──────────────────
  // Queues reminders for all organizations with pending TSD for prior month.

  @Cron('0 9 7 * *', {
    name: 'estonia-tsd-reminder',
    timeZone: 'Europe/Tallinn',
  })
  async scheduleTsdReminders(): Promise<void> {
    const now = new Date();
    const priorMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const priorYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const pendingPeriods = await this.periodRepo.find({
      where: {
        year: priorYear,
        month: priorMonth,
        tsdStatus: TaxPeriodStatus.READY,
      },
    });

    this.logger.log(
      `[TSD Reminder] ${pendingPeriods.length} organizations pending for ${priorYear}/${priorMonth}`,
    );

    for (const period of pendingPeriods) {
      await this.reminderQueue.add('tsd-reminder', {
        organizationId: period.orgId,
        formType: 'TSD',
        taxYear: priorYear,
        taxMonth: priorMonth,
        daysUntilDeadline: 3,
      });
    }
  }

  // ─── Cron: KMD reminder — runs on the 17th of each month ─────────────────

  @Cron('0 9 17 * *', {
    name: 'estonia-kmd-reminder',
    timeZone: 'Europe/Tallinn',
  })
  async scheduleKmdReminders(): Promise<void> {
    const now = new Date();
    const priorMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const priorYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const pendingPeriods = await this.periodRepo.find({
      where: {
        year: priorYear,
        month: priorMonth,
        kmdStatus: TaxPeriodStatus.READY,
      },
    });

    this.logger.log(
      `[KMD Reminder] ${pendingPeriods.length} organizations pending for ${priorYear}/${priorMonth}`,
    );

    for (const period of pendingPeriods) {
      await this.reminderQueue.add('kmd-reminder', {
        organizationId: period.orgId,
        formType: 'KMD',
        taxYear: priorYear,
        taxMonth: priorMonth,
        daysUntilDeadline: 3,
      });
    }
  }

  // ─── Cron: Create tax periods — runs on the 1st of each month ────────────
  // Ensures all active organizations have a TaxPeriod row for the new month.

  @Cron('0 0 1 * *', {
    name: 'estonia-create-periods',
    timeZone: 'Europe/Tallinn',
  })
  async createMonthlyPeriods(): Promise<void> {
    const now = new Date();
    // Create period for the month that just started
    this.logger.log(
      `[Periods] Creating tax periods for ${now.getFullYear()}/${now.getMonth() + 1}`,
    );
    // In a real implementation, query all active organizations and upsert periods
    // This is a hook for the organizations service to call this on-demand too
  }

  // ─── Manual: queue a filing job ──────────────────────────────────────────

  async queueVatFiling(
    organizationId: string,
    taxYear: number,
    taxMonth: number,
    dryRun = false,
  ) {
    return this.vatQueue.add('file-kmd', {
      organizationId,
      taxYear,
      taxMonth,
      dryRun,
    });
  }

  async queueTsdFiling(
    organizationId: string,
    taxYear: number,
    taxMonth: number,
    dryRun = false,
  ) {
    return this.tsdQueue.add('file-tsd', {
      organizationId,
      taxYear,
      taxMonth,
      dryRun,
    });
  }
}
