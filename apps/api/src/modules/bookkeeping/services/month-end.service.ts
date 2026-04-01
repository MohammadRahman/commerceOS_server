// apps/api/src/modules/bookkeeping/services/month-end.service.ts
//
// Runs at month close (manually or via scheduler on the 1st).
// Reads bookkeeping_entries → computes tax obligations → updates MonthlyTaxPeriod
// → queues EMTA filing jobs if autoFileEnabled.
//
// Persona-aware: restaurant, ecommerce, freelancer FIE, and OÜ all have
// different applicable taxes.

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
const UNEMP_EMP = 0.016;
const UNEMP_EMPL = 0.008;
const PENSION_II = 0.02;
// FIE: social tax base is net business income, not gross salary
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

  // ─── Cron: runs at 02:00 on the 1st of every month (Tallinn time) ─────────
  // Closes prior month, calculates taxes, queues filings for orgs with autoFile.

  @Cron('0 2 1 * *', { name: 'month-end-close', timeZone: 'Europe/Tallinn' })
  async runMonthEndForAll(): Promise<void> {
    const now = new Date();
    const priorMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const priorYear =
      now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    this.logger.log(`[Month-end] Running for ${priorYear}/${priorMonth}`);

    // Find all open periods for prior month
    const openPeriods = await this.periodRepo.find({
      where: { year: priorYear, month: priorMonth, status: PeriodStatus.OPEN },
    });

    this.logger.log(
      `[Month-end] Processing ${openPeriods.length} organizations`,
    );

    for (const period of openPeriods) {
      try {
        await this.closePeriod(period.organizationId, priorYear, priorMonth);
      } catch (err) {
        this.logger.error(
          `[Month-end] Failed for org ${period.organizationId}`,
          err,
        );
      }
    }
  }

  // ─── Close a single period ────────────────────────────────────────────────
  // Called by cron OR manually by user from the UI ("Calculate my taxes").

  async closePeriod(
    organizationId: string,
    year: number,
    month: number,
    previewOnly = false,
  ): Promise<MonthlyTaxPeriod> {
    const profile = await this.profileRepo.findOne({
      where: { organizationId },
    });
    if (!profile) {
      throw new BadRequestException(
        'Tax profile not set up. Complete onboarding first.',
      );
    }

    let period = await this.periodRepo.findOne({
      where: { organizationId, year, month },
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

    // Load all confirmed entries for the period
    const entries = await this.entryRepo.find({
      where: {
        organizationId,
        taxYear: year,
        taxMonth: month,
        status: EntryStatus.CONFIRMED,
      },
    });

    // Calculate persona-appropriate taxes
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

      // Auto-file if enabled
      if (profile.autoFileEnabled && profile.emtaApiToken) {
        await this.queueFilings(organizationId, year, month, profile);
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

    // VAT (applies to all VAT-registered businesses)
    const vatPayable =
      profile.vatStatus !== VatRegistrationStatus.NOT_REGISTERED
        ? Number(period.vatPayable)
        : 0;

    // VAT by rate breakdown for KMD form
    const vatByRate = this.buildVatByRate(
      incomeEntries,
      expenseEntries,
      profile,
    );

    // Deadlines
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const tsdDeadline = `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`;
    const kmdDeadline = `${nextYear}-${String(nextMonth).padStart(2, '0')}-20`;

    // Persona-specific tax calculations
    let incomeTaxPayable = 0;
    let socialTaxPayable = 0;
    let unemploymentTax = 0;

    switch (profile.persona) {
      case BusinessPersona.FREELANCER_FIE: {
        // FIE: pays income tax (22%) + social tax (33%) on net business income
        // Social tax minimum: 33% of monthly minimum base (€725 in 2025)
        const socialTaxBase = Math.max(netProfit, FIE_SOCIAL_MIN_BASE);
        socialTaxPayable = +(socialTaxBase * SOCIAL_TAX).toFixed(2);
        incomeTaxPayable = +(Math.max(0, netProfit) * INCOME_TAX).toFixed(2);
        // FIE also pays unemployment insurance as employer
        unemploymentTax = +(grossIncome * UNEMP_EMPL).toFixed(2);
        break;
      }

      case BusinessPersona.COMPANY_OU: {
        // OÜ: no income tax on retained earnings
        // Income tax only if distributing dividends (not tracked here — separate flow)
        // Social tax from staff salaries only
        socialTaxPayable = Number(period.totalSocialTax);
        unemploymentTax = salaryEntries.reduce(
          (s, e) => s + Number(e.grossAmount) * UNEMP_EMPL,
          0,
        );
        break;
      }

      case BusinessPersona.RESTAURANT:
      case BusinessPersona.ECOMMERCE: {
        // Treat as OÜ by default unless sole trader flag is set
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
    profile: TaxProfile,
  ): TaxBreakdown['vatByRate'] {
    const rates = [0, 9, 13, 24];
    return rates
      .map((rate) => {
        const salesAtRate = incomeEntries.filter(
          (e) => Number(e.vatRate) === rate,
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
    organizationId: string,
    year: number,
    month: number,
    profile: TaxProfile,
  ): Promise<void> {
    // KMD — only if VAT registered
    if (profile.vatStatus !== VatRegistrationStatus.NOT_REGISTERED) {
      await this.vatQueue.add('file-kmd', {
        organizationId,
        taxYear: year,
        taxMonth: month,
      });
      this.logger.log(
        `[Month-end] Queued KMD filing for org ${organizationId} ${year}/${month}`,
      );
    }

    // TSD — if any salary entries exist
    const hasSalaries = await this.entryRepo.count({
      where: {
        organizationId,
        taxYear: year,
        taxMonth: month,
        entryType: EntryType.SALARY,
        status: EntryStatus.CONFIRMED,
      },
    });
    if (hasSalaries > 0) {
      await this.tsdQueue.add('file-tsd', {
        organizationId,
        taxYear: year,
        taxMonth: month,
      });
      this.logger.log(
        `[Month-end] Queued TSD filing for org ${organizationId} ${year}/${month}`,
      );
    }
  }

  // ─── Mark period as filed ─────────────────────────────────────────────────

  async markFiled(
    organizationId: string,
    year: number,
    month: number,
    kmdSubmissionId?: string,
    tsdSubmissionId?: string,
    filedByUserId?: string,
  ): Promise<MonthlyTaxPeriod> {
    const period = await this.periodRepo.findOneOrFail({
      where: { organizationId, year, month },
    });
    period.status = PeriodStatus.FILED;
    period.kmdSubmissionId = kmdSubmissionId ?? period.kmdSubmissionId;
    period.tsdSubmissionId = tsdSubmissionId ?? period.tsdSubmissionId;
    period.filedAt = new Date();
    period.filedByUserId = filedByUserId || '';
    return this.periodRepo.save(period);
  }

  // ─── Get period with full summary ─────────────────────────────────────────

  async getPeriod(organizationId: string, year: number, month: number) {
    const period = await this.periodRepo.findOne({
      where: { organizationId, year, month },
    });

    const entryCount = await this.entryRepo.count({
      where: {
        organizationId,
        taxYear: year,
        taxMonth: month,
        status: EntryStatus.CONFIRMED,
      },
    });

    return { period, entryCount };
  }

  // ─── List all periods for org ─────────────────────────────────────────────

  async listPeriods(organizationId: string) {
    return this.periodRepo.find({
      where: { organizationId },
      order: { year: 'DESC', month: 'DESC' },
      take: 24,
    });
  }
}
