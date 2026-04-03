/* eslint-disable @typescript-eslint/require-await */
// apps/api/src/modules/bookkeeping/services/month-end.service.ts
//
// Runs at month close (manually or via scheduler on the 1st).
// Reads bookkeeping_entries → computes tax obligations → updates MonthlyTaxPeriod
// → queues EMTA filing jobs if autoFileEnabled.

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import {
  MonthlyTaxPeriod,
  PeriodStatus,
  TaxProfile,
  BookkeepingEntry,
  EntryType,
  EntryStatus,
  BusinessPersona,
  TaxBreakdown,
  VatRegistrationStatus,
  EmployeeRecord,
} from '../entities/bookkeeping.entities';
import { ESTONIA_TAX_QUEUE_NAMES } from '../../estonia-tax/estonia-tax.constants';

// 2025+ rates
const INCOME_TAX = 0.22;
const SOCIAL_TAX = 0.33;
const UNEMP_EMPL = 0.008;
const FIE_SOCIAL_MIN_BASE = 725; // Monthly minimum social tax base (2025)

@Injectable()
export class MonthEndService {
  private readonly logger = new Logger(MonthEndService.name);

  constructor(
    @InjectRepository(MonthlyTaxPeriod)
    private readonly periodRepo: Repository<MonthlyTaxPeriod>,

    @InjectRepository(TaxProfile)
    private readonly profileRepo: Repository<TaxProfile>,

    @InjectRepository(BookkeepingEntry)
    private readonly entryRepo: Repository<BookkeepingEntry>,

    @InjectRepository(EmployeeRecord)
    private readonly employeeRepo: Repository<EmployeeRecord>,

    @InjectQueue(ESTONIA_TAX_QUEUE_NAMES.VAT_FILING)
    private readonly vatQueue: Queue,

    @InjectQueue(ESTONIA_TAX_QUEUE_NAMES.TSD_FILING)
    private readonly tsdQueue: Queue,
  ) {}

  // ─── Cron: 02:00 on the 1st of every month, Tallinn time ─────────────────

  @Cron('0 2 1 * *', { name: 'month-end-close', timeZone: 'Europe/Tallinn' })
  async runMonthEndForAll(): Promise<void> {
    const now = new Date();
    const priorMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const priorYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    this.logger.log(`[Month-end] Running for ${priorYear}/${priorMonth}`);

    const openPeriods = await this.periodRepo.find({
      where: { year: priorYear, month: priorMonth, status: PeriodStatus.OPEN },
    });

    this.logger.log(
      `[Month-end] Processing ${openPeriods.length} organizations`,
    );

    for (const period of openPeriods) {
      try {
        await this.closePeriod(period.orgId, priorYear, priorMonth);
      } catch (err) {
        this.logger.error(`[Month-end] Failed for org ${period.orgId}`, err);
      }
    }
  }

  // ─── Close a single period ────────────────────────────────────────────────

  async closePeriod(
    orgId: string,
    year: number,
    month: number,
    previewOnly = false,
  ): Promise<MonthlyTaxPeriod> {
    const profile = await this.profileRepo.findOne({ where: { orgId } });
    if (!profile) {
      throw new BadRequestException(
        'Tax profile not set up. Complete onboarding first.',
      );
    }

    const period = await this.periodRepo.findOne({
      where: { orgId, year, month },
    });
    if (!period) {
      throw new BadRequestException(
        `No entries found for ${year}/${month}. Add income or expenses first.`,
      );
    }

    if (!previewOnly) {
      period.status = PeriodStatus.CALCULATING;
      await this.periodRepo.save(period);
    }

    const entries = await this.entryRepo.find({
      where: {
        orgId,
        taxYear: year,
        taxMonth: month,
        status: EntryStatus.CONFIRMED,
      },
    });

    const breakdown = await this.calculateTaxes(
      profile,
      period,
      entries,
      year,
      month,
    );
    period.taxBreakdown = breakdown;

    if (!previewOnly) {
      period.status = PeriodStatus.REVIEW;
      await this.periodRepo.save(period);

      // FIX: emtaApiToken has select:false — check existence via a separate
      // targeted query rather than trusting the profile object directly.
      if (profile.autoFileEnabled) {
        const hasToken = await this.profileRepo
          .createQueryBuilder('p')
          .addSelect('p.emtaApiToken')
          .where('p.orgId = :orgId', { orgId })
          .getOne();

        if (hasToken?.emtaApiToken) {
          await this.queueFilings(orgId, year, month, profile);
        }
      }
    }

    return this.periodRepo.save(period);
  }

  // ─── Tax calculation (persona-aware) ─────────────────────────────────────

  private async calculateTaxes(
    profile: TaxProfile,
    period: MonthlyTaxPeriod,
    entries: BookkeepingEntry[],
    year: number,
    month: number,
  ): Promise<TaxBreakdown> {
    const incomeEntries = entries.filter(
      (e) => e.entryType === EntryType.INCOME,
    );
    const expenseEntries = entries.filter(
      (e) => e.entryType === EntryType.EXPENSE,
    );
    const salaryEntries = entries.filter(
      (e) => e.entryType === EntryType.SALARY,
    );

    // FIX: all decimal columns are strings — always Number() before arithmetic
    const grossIncome = incomeEntries.reduce(
      (s, e) => s + Number(e.grossAmount),
      0,
    );
    const netIncome = incomeEntries.reduce(
      (s, e) => s + Number(e.netAmount),
      0,
    );
    const totalExpense = expenseEntries.reduce(
      (s, e) => s + Number(e.netAmount),
      0,
    );
    const totalSalary = salaryEntries.reduce(
      (s, e) => s + Number(e.grossAmount),
      0,
    );
    const netProfit = netIncome - totalExpense - totalSalary;

    const vatPayable =
      profile.vatStatus !== VatRegistrationStatus.NOT_REGISTERED
        ? Number(period.vatPayable) // period.vatPayable is a string decimal
        : 0;

    const vatByRate = this.buildVatByRate(incomeEntries, expenseEntries);

    // Filing deadlines (10th for TSD, 20th for KMD)
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const tsdDeadline = `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;
    const kmdDeadline = `${nextYear}-${String(nextMonth).padStart(2, '0')}-20`;

    let incomeTaxPayable = 0;
    let socialTaxPayable = 0;
    let unemploymentTax = 0;

    switch (profile.persona) {
      case BusinessPersona.FREELANCER_FIE: {
        const socialTaxBase = Math.max(netProfit, FIE_SOCIAL_MIN_BASE);
        socialTaxPayable = +(socialTaxBase * SOCIAL_TAX).toFixed(2);
        incomeTaxPayable = +(Math.max(0, netProfit) * INCOME_TAX).toFixed(2);
        unemploymentTax = +(grossIncome * UNEMP_EMPL).toFixed(2);
        break;
      }

      case BusinessPersona.COMPANY_OU: {
        // OÜ: no CIT on retained earnings — only on salary payroll
        socialTaxPayable = Number(period.totalSocialTax);
        unemploymentTax = salaryEntries.reduce(
          (s, e) => s + Number(e.grossAmount) * UNEMP_EMPL,
          0,
        );
        break;
      }

      case BusinessPersona.RESTAURANT:
      case BusinessPersona.ECOMMERCE: {
        if (profile.isSoleTraderFie) {
          const socialTaxBase = Math.max(netProfit, FIE_SOCIAL_MIN_BASE);
          socialTaxPayable = +(socialTaxBase * SOCIAL_TAX).toFixed(2);
          incomeTaxPayable = +(Math.max(0, netProfit) * INCOME_TAX).toFixed(2);
        } else {
          socialTaxPayable = Number(period.totalSocialTax);
          unemploymentTax = salaryEntries.reduce(
            (s, e) => s + Number(e.grossAmount) * UNEMP_EMPL,
            0,
          );
        }
        break;
      }
    }

    const totalTax =
      vatPayable + incomeTaxPayable + socialTaxPayable + unemploymentTax;
    const effectiveTaxRate = grossIncome > 0 ? totalTax / grossIncome : 0;

    return {
      persona: profile.persona,
      vatPayable: +vatPayable.toFixed(2),
      incomeTaxPayable: +incomeTaxPayable.toFixed(2),
      socialTaxPayable: +socialTaxPayable.toFixed(2),
      unemploymentTax: +unemploymentTax.toFixed(2),
      netProfit: +netProfit.toFixed(2),
      effectiveTaxRate: +effectiveTaxRate.toFixed(4),
      tsdDeadline,
      kmdDeadline,
      vatByRate,
    };
  }

  private buildVatByRate(
    incomeEntries: BookkeepingEntry[],
    expenseEntries: BookkeepingEntry[],
  ): TaxBreakdown['vatByRate'] {
    const rates = [0, 9, 13, 24];
    return rates
      .map((rate) => {
        const salesAtRate = incomeEntries.filter(
          (e) => Number(e.vatRate) === rate && !e.excludeFromVat,
        );
        const purchasesAtRate = expenseEntries.filter(
          (e) => Number(e.vatRate) === rate,
        );
        return {
          rate,
          taxableSales: salesAtRate.reduce(
            (s, e) => s + Number(e.netAmount),
            0,
          ),
          outputVat: salesAtRate.reduce((s, e) => s + Number(e.vatAmount), 0),
          deductibleInput: purchasesAtRate.reduce(
            (s, e) => s + Number(e.vatAmount),
            0,
          ),
        };
      })
      .filter(
        (r) => r.taxableSales > 0 || r.outputVat > 0 || r.deductibleInput > 0,
      );
  }

  // ─── Queue EMTA filings ───────────────────────────────────────────────────

  private async queueFilings(
    orgId: string,
    year: number,
    month: number,
    profile: TaxProfile,
  ): Promise<void> {
    if (profile.vatStatus !== VatRegistrationStatus.NOT_REGISTERED) {
      await this.vatQueue.add('file-kmd', {
        orgId,
        taxYear: year,
        taxMonth: month,
      });
      this.logger.log(
        `[Month-end] Queued KMD filing for org ${orgId} ${year}/${month}`,
      );
    }

    const hasSalaries = await this.entryRepo.count({
      where: {
        orgId,
        taxYear: year,
        taxMonth: month,
        entryType: EntryType.SALARY,
        status: EntryStatus.CONFIRMED,
      },
    });

    if (hasSalaries > 0) {
      await this.tsdQueue.add('file-tsd', {
        orgId,
        taxYear: year,
        taxMonth: month,
      });
      this.logger.log(
        `[Month-end] Queued TSD filing for org ${orgId} ${year}/${month}`,
      );
    }
  }

  // ─── Mark period as filed ─────────────────────────────────────────────────

  async markFiled(
    orgId: string,
    year: number,
    month: number,
    kmdSubmissionId?: string,
    tsdSubmissionId?: string,
    filedByUserId?: string,
  ): Promise<MonthlyTaxPeriod> {
    const period = await this.periodRepo.findOneOrFail({
      where: { orgId, year, month },
    });
    period.status = PeriodStatus.FILED;
    if (kmdSubmissionId) period.kmdSubmissionId = kmdSubmissionId;
    if (tsdSubmissionId) period.tsdSubmissionId = tsdSubmissionId;
    period.filedAt = new Date();
    // FIX: was `filedByUserId || ''` — empty string is misleading on a nullable
    // column. Use undefined so the DB stores NULL when no user is provided.
    period.filedByUserId = filedByUserId ?? null!;
    return this.periodRepo.save(period);
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  async getPeriod(
    orgId: string,
    year: number,
    month: number,
  ): Promise<{ period: MonthlyTaxPeriod | null; entryCount: number }> {
    const period = await this.periodRepo.findOne({
      where: { orgId, year, month },
    });

    const entryCount = await this.entryRepo.count({
      where: {
        orgId,
        taxYear: year,
        taxMonth: month,
        status: EntryStatus.CONFIRMED,
      },
    });

    return { period, entryCount };
  }

  async listPeriods(orgId: string): Promise<MonthlyTaxPeriod[]> {
    return this.periodRepo.find({
      where: { orgId },
      order: { year: 'DESC', month: 'DESC' },
      take: 24,
    });
  }
}
