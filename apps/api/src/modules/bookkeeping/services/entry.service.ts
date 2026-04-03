// apps/api/src/modules/bookkeeping/services/entry.service.ts
//
// The write path for every money event.
// All persona flows funnel through here — restaurant daily sales,
// ecommerce order sync, freelancer invoice payments, salary entries.

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BookkeepingEntry,
  EntryType,
  EntryCategory,
  EntryStatus,
  SourceType,
  MonthlyTaxPeriod,
  PeriodStatus,
  TaxProfile,
  EmployeeRecord,
  SalaryType,
  PLATFORM_COMMISSION_RATES,
  ReceiptParsedData,
} from '../entities/bookkeeping.entities';
import {
  AddDailySalesDto,
  AddExpenseDto,
  AddIncomeDto,
  AddSalaryDto,
  AddThirdPartyPayoutDto,
  ListEntriesDto,
} from '../dto/bookkeeping.dto';

// ─── Estonian payroll constants (2025) ───────────────────────────────────────

const INCOME_TAX_RATE = 0.22;
const SOCIAL_TAX_RATE = 0.33;
const UNEMP_EMPLOYEE = 0.016;
const UNEMP_EMPLOYER = 0.008;
const PENSION_II = 0.02;
const EXEMPTION_MAX = 654;
const EXEMPTION_TAPER_LO = 1_200;
const EXEMPTION_TAPER_HI = 2_100;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function calcBasicExemption(gross: number): number {
  if (gross <= EXEMPTION_TAPER_LO) return EXEMPTION_MAX;
  if (gross >= EXEMPTION_TAPER_HI) return 0;
  return +(
    EXEMPTION_MAX *
    (1 -
      (gross - EXEMPTION_TAPER_LO) / (EXEMPTION_TAPER_HI - EXEMPTION_TAPER_LO))
  ).toFixed(2);
}

/**
 * Splits a VAT-inclusive gross amount into { vatAmount, netAmount }.
 * grossAmount = netAmount + vatAmount
 * vatAmount   = gross - gross / (1 + vatRate/100)
 */
function splitVat(
  gross: number,
  vatRate: number,
): { vatAmount: number; netAmount: number } {
  const vatAmount = +(gross - gross / (1 + vatRate / 100)).toFixed(2);
  const netAmount = +(gross - vatAmount).toFixed(2);
  return { vatAmount, netAmount };
}

function periodFromDate(d: Date): { taxYear: number; taxMonth: number } {
  return { taxYear: d.getFullYear(), taxMonth: d.getMonth() + 1 };
}

// ─── Public result types ──────────────────────────────────────────────────────

export interface PayrollBreakdown {
  salaryType: SalaryType;
  hoursWorked?: number;
  hourlyRate?: number;
  grossSalary: number;
  basicExemption: number;
  fundedPensionII: number;
  incomeTaxBase: number;
  incomeTaxWithheld: number;
  unemploymentEmp: number;
  unemploymentEmpl: number;
  socialTax: number;
  netSalary: number;
  totalEmployerCost: number;
  taxAsPercentOfCost: number;
}

export interface ThirdPartyPayoutResult {
  incomeEntry: BookkeepingEntry; // SALES_THIRD_PARTY — full gross order value
  commissionEntry: BookkeepingEntry; // PLATFORM_COMMISSION — deductible expense
  grossOrderValue: number;
  commissionAmount: number;
  payoutAmount: number;
  effectiveCommissionRate: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EntryService {
  private readonly logger = new Logger(EntryService.name);

  constructor(
    @InjectRepository(BookkeepingEntry)
    private readonly entryRepo: Repository<BookkeepingEntry>,

    @InjectRepository(MonthlyTaxPeriod)
    private readonly periodRepo: Repository<MonthlyTaxPeriod>,

    @InjectRepository(TaxProfile)
    private readonly profileRepo: Repository<TaxProfile>,

    @InjectRepository(EmployeeRecord)
    private readonly employeeRepo: Repository<EmployeeRecord>,
  ) {}

  // ─── Tax profile ──────────────────────────────────────────────────────────

  private async getProfile(orgId: string): Promise<TaxProfile> {
    const profile = await this.profileRepo.findOne({ where: { orgId } });
    if (!profile) {
      throw new NotFoundException(
        'Tax profile not found. Complete onboarding at /bookkeeping/setup first.',
      );
    }
    return profile;
  }

  // ─── Ensure period exists ─────────────────────────────────────────────────
  // Called on every entry write. Creates the period row if this is the
  // first entry for a given month.

  async ensurePeriod(
    orgId: string,
    year: number,
    month: number,
  ): Promise<MonthlyTaxPeriod> {
    let period = await this.periodRepo.findOne({
      where: { orgId, year, month },
    });
    if (!period) {
      period = this.periodRepo.create({
        orgId,
        year,
        month,
        status: PeriodStatus.OPEN,
      });
      await this.periodRepo.save(period);
    }
    return period;
  }

  // ─── Add income ───────────────────────────────────────────────────────────

  async addIncome(
    orgId: string,
    dto: AddIncomeDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    const profile = await this.getProfile(orgId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(orgId, taxYear, taxMonth);

    // FIX: profile.defaultVatRate is a string (decimal column) — always parse
    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    // If excluded from VAT, record 0 VAT regardless of the rate setting
    const effectiveVatRate = dto.excludeFromVat ? 0 : vatRate;
    const { vatAmount, netAmount } = splitVat(
      dto.grossAmount,
      effectiveVatRate,
    );

    const entry = this.entryRepo.create({
      orgId,
      // FIX: store as ISO date string — matches entity `date: string` type.
      // TypeORM accepts a Date object here and serialises it correctly, but
      // we cast so the return value from .save() has the right TS type.
      date: date.toISOString().split('T')[0] as unknown as string,
      taxYear,
      taxMonth,
      entryType: EntryType.INCOME,
      category: dto.category,
      description: dto.description ?? `Sales – ${dto.date}`,
      // Money fields: TypeORM coerces numbers to the decimal string on write,
      // and the DB returns strings on read. We store numbers going in
      // (TypeORM handles it) and get strings coming out.
      grossAmount: dto.grossAmount as unknown as string,
      vatRate: effectiveVatRate as unknown as string,
      vatAmount: vatAmount as unknown as string,
      netAmount: netAmount as unknown as string,
      excludeFromVat: dto.excludeFromVat ?? false,
      sourceType: SourceType.MANUAL,
      counterpartyName: dto.counterpartyName,
      counterpartyVatNumber: dto.counterpartyVatNumber,
      invoiceNumber: dto.invoiceNumber,
      notes: dto.notes,
      status: EntryStatus.CONFIRMED,
      createdByUserId,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(orgId, taxYear, taxMonth);
    return saved;
  }

  // ─── Add expense ──────────────────────────────────────────────────────────

  async addExpense(
    orgId: string,
    dto: AddExpenseDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    await this.getProfile(orgId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(orgId, taxYear, taxMonth);

    const vatRate = dto.vatRate ?? 0;
    const { vatAmount, netAmount } = splitVat(dto.grossAmount, vatRate);

    const entry = this.entryRepo.create({
      orgId,
      date: date.toISOString().split('T')[0] as unknown as string,
      taxYear,
      taxMonth,
      entryType: EntryType.EXPENSE,
      category: dto.category,
      description:
        dto.description ?? `Expense – ${dto.counterpartyName ?? dto.date}`,
      grossAmount: dto.grossAmount as unknown as string,
      vatRate: vatRate as unknown as string,
      vatAmount: vatAmount as unknown as string,
      netAmount: netAmount as unknown as string,
      sourceType: dto.receiptImageUrl
        ? SourceType.RECEIPT_SCAN
        : SourceType.MANUAL,
      receiptImageUrl: dto.receiptImageUrl,
      counterpartyName: dto.counterpartyName,
      counterpartyVatNumber: dto.counterpartyVatNumber,
      invoiceNumber: dto.invoiceNumber,
      notes: dto.notes,
      status: EntryStatus.CONFIRMED,
      createdByUserId,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(orgId, taxYear, taxMonth);
    return saved;
  }

  // ─── Attach receipt proof to an expense ──────────────────────────────────

  async attachProof(
    orgId: string,
    entryId: string,
    imageUrl: string,
  ): Promise<BookkeepingEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id: entryId, orgId },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.entryType !== EntryType.EXPENSE) {
      throw new BadRequestException(
        'Proof can only be attached to expense entries',
      );
    }
    entry.receiptImageUrl = imageUrl;
    entry.sourceType = SourceType.RECEIPT_SCAN;
    return this.entryRepo.save(entry);
  }

  // ─── Add third party payout (Wolt / Bolt Food etc.) ──────────────────────
  //
  // Creates TWO entries:
  //   1. INCOME  — SALES_THIRD_PARTY   — full gross order value
  //   2. EXPENSE — PLATFORM_COMMISSION — commission deducted by platform
  //
  // VAT logic:
  //   Income:     VAT applies (platform sales are taxable)
  //   Commission: 0% VAT — reverse charge (B2B cross-border service)

  async addThirdPartyPayout(
    orgId: string,
    dto: AddThirdPartyPayoutDto,
    createdByUserId?: string,
  ): Promise<ThirdPartyPayoutResult> {
    const profile = await this.getProfile(orgId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(orgId, taxYear, taxMonth);

    const commissionRate =
      dto.commissionRate ?? PLATFORM_COMMISSION_RATES[dto.platform];

    if (commissionRate <= 0 || commissionRate >= 1) {
      throw new BadRequestException(
        'Commission rate must be between 0 and 1 (e.g. 0.28 for 28%)',
      );
    }

    let grossOrderValue: number;
    let payoutAmount: number;
    let commissionAmount: number;

    if (dto.grossOrderValue) {
      grossOrderValue = dto.grossOrderValue;
      commissionAmount = +(grossOrderValue * commissionRate).toFixed(2);
      payoutAmount = +(grossOrderValue - commissionAmount).toFixed(2);
    } else if (dto.payoutAmount) {
      payoutAmount = dto.payoutAmount;
      grossOrderValue = +(payoutAmount / (1 - commissionRate)).toFixed(2);
      commissionAmount = +(grossOrderValue - payoutAmount).toFixed(2);
    } else {
      throw new BadRequestException(
        'Provide either grossOrderValue or payoutAmount',
      );
    }

    const periodLabel = dto.periodLabel ?? dto.date;
    const platformLabel = dto.platform.replace('_', ' ');
    const dateStr = date.toISOString().split('T')[0] as unknown as string;

    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(grossOrderValue, vatRate);

    // ── Entry 1: Income (full gross order value) ──────────────────────────
    const incomeEntry = await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date: dateStr,
        taxYear,
        taxMonth,
        entryType: EntryType.INCOME,
        category: EntryCategory.SALES_THIRD_PARTY,
        description: `${platformLabel} sales – ${periodLabel}`,
        grossAmount: grossOrderValue as unknown as string,
        vatRate: vatRate as unknown as string,
        vatAmount: vatAmount as unknown as string,
        netAmount: netAmount as unknown as string,
        excludeFromVat: false,
        thirdPartyPlatform: dto.platform,
        platformCommissionRate: commissionRate as unknown as string,
        platformCommissionAmount: commissionAmount as unknown as string,
        platformPayoutAmount: payoutAmount as unknown as string,
        sourceType: SourceType.MANUAL,
        invoiceNumber: dto.settlementReference,
        counterpartyName: platformLabel,
        notes: [
          `Gross orders: €${grossOrderValue.toFixed(2)}`,
          `Commission (${(commissionRate * 100).toFixed(0)}%): €${commissionAmount.toFixed(2)}`,
          `Bank payout: €${payoutAmount.toFixed(2)}`,
          dto.notes ?? '',
        ]
          .filter(Boolean)
          .join(' | '),
        status: EntryStatus.CONFIRMED,
        createdByUserId,
      }),
    );

    // ── Entry 2: Expense (platform commission — deductible) ───────────────
    const commissionEntry = await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date: dateStr,
        taxYear,
        taxMonth,
        entryType: EntryType.EXPENSE,
        category: EntryCategory.PLATFORM_COMMISSION,
        description: `${platformLabel} commission – ${periodLabel}`,
        grossAmount: commissionAmount as unknown as string,
        vatRate: '0' as unknown as string,
        vatAmount: '0' as unknown as string,
        netAmount: commissionAmount as unknown as string,
        thirdPartyPlatform: dto.platform,
        platformCommissionRate: commissionRate as unknown as string,
        platformCommissionAmount: commissionAmount as unknown as string,
        platformPayoutAmount: payoutAmount as unknown as string,
        sourceType: SourceType.MANUAL,
        invoiceNumber: dto.settlementReference,
        counterpartyName: platformLabel,
        notes: `Commission ${(commissionRate * 100).toFixed(0)}% on €${grossOrderValue.toFixed(2)} gross orders`,
        status: EntryStatus.CONFIRMED,
        createdByUserId,
      }),
    );

    await this.recalculatePeriod(orgId, taxYear, taxMonth);

    return {
      incomeEntry,
      commissionEntry,
      grossOrderValue,
      commissionAmount,
      payoutAmount,
      effectiveCommissionRate: commissionRate,
    };
  }

  // ─── Add salary ───────────────────────────────────────────────────────────
  // All tax deductions computed here — owner never enters tax amounts manually.

  async addSalary(
    orgId: string,
    dto: AddSalaryDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    await this.getProfile(orgId);

    const employee = await this.employeeRepo.findOne({
      where: { id: dto.employeeId, orgId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    }

    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);
    await this.ensurePeriod(orgId, taxYear, taxMonth);

    let gross: number;
    let hoursWorked: number | undefined;
    let effectiveHourlyRate: number | undefined;

    if (employee.salaryType === SalaryType.HOURLY) {
      if (!dto.hoursWorked || dto.hoursWorked <= 0) {
        throw new BadRequestException(
          `Employee "${employee.fullName}" is hourly — provide hoursWorked`,
        );
      }
      // FIX: employee.hourlyRate is string | null — always parse
      effectiveHourlyRate = dto.hourlyRate ?? Number(employee.hourlyRate ?? 0);
      if (!effectiveHourlyRate || effectiveHourlyRate <= 0) {
        throw new BadRequestException(
          `No hourly rate set for "${employee.fullName}". Set it on the employee or pass hourlyRate.`,
        );
      }
      hoursWorked = dto.hoursWorked;
      gross = +(hoursWorked * effectiveHourlyRate).toFixed(2);
    } else {
      if (!dto.grossAmount || dto.grossAmount <= 0) {
        throw new BadRequestException(
          `Employee "${employee.fullName}" is fixed salary — provide grossAmount`,
        );
      }
      gross = dto.grossAmount;
    }

    const exemption = dto.basicExemption ?? calcBasicExemption(gross);
    const pensionII = +(gross * PENSION_II).toFixed(2);
    const unempEmp = +(gross * UNEMP_EMPLOYEE).toFixed(2);
    const itBase = Math.max(0, +(gross - exemption - pensionII).toFixed(2));
    const incomeTax = +(itBase * INCOME_TAX_RATE).toFixed(2);
    const socialTax = +(gross * SOCIAL_TAX_RATE).toFixed(2);
    const unempEmpl = +(gross * UNEMP_EMPLOYER).toFixed(2);
    const netSalary = +(gross - incomeTax - unempEmp - pensionII).toFixed(2);
    const employerCost = +(gross + socialTax + unempEmpl).toFixed(2);

    const noteParts = [
      employee.salaryType === SalaryType.HOURLY
        ? `Hourly: ${hoursWorked}h × €${effectiveHourlyRate}/h = €${gross}`
        : `Fixed gross: €${gross}`,
      `Income tax: €${incomeTax}`,
      `Social tax (employer): €${socialTax}`,
      `Unemployment (emp): €${unempEmp}`,
      `Pension II: €${pensionII}`,
      `Exemption: €${exemption}`,
      dto.bankReferenceNumber ? `Ref: ${dto.bankReferenceNumber}` : '',
      dto.notes ?? '',
    ]
      .filter(Boolean)
      .join(' | ');

    // FIX: use proper ReceiptParsedData shape instead of `as any`.
    // We repurpose lineItems to carry the payroll breakdown for the TSD
    // calculator — confidence:1 signals it was system-computed, not OCR.
    const payrollBreakdown: ReceiptParsedData = {
      merchantName: employee.fullName,
      confidence: 1,
      lineItems: [
        ...(employee.salaryType === SalaryType.HOURLY
          ? [
              {
                description: `${hoursWorked}h × €${effectiveHourlyRate}/h`,
                total: gross,
              },
            ]
          : []),
        { description: 'Gross salary', total: gross },
        { description: 'Income tax (22%)', total: -incomeTax },
        { description: 'Unemployment employee (1.6%)', total: -unempEmp },
        { description: 'Pension II (2%)', total: -pensionII },
        { description: 'Net take-home', total: netSalary },
        { description: 'Social tax employer (33%)', total: socialTax },
        { description: 'Unemployment employer (0.8%)', total: unempEmpl },
        { description: 'Total employer cost', total: employerCost },
      ],
    };

    const entry = this.entryRepo.create({
      orgId,
      date: date.toISOString().split('T')[0] as unknown as string,
      taxYear,
      taxMonth,
      entryType: EntryType.SALARY,
      category: employee.isBoardMember
        ? EntryCategory.BOARD_FEE
        : EntryCategory.STAFF_SALARY,
      description: `Salary – ${employee.fullName}`,
      grossAmount: gross as unknown as string,
      vatRate: '0' as unknown as string,
      vatAmount: '0' as unknown as string,
      netAmount: netSalary as unknown as string,
      sourceType: SourceType.MANUAL,
      counterpartyName: employee.fullName,
      notes: noteParts,
      status: EntryStatus.CONFIRMED,
      createdByUserId,
      receiptParsedData: payrollBreakdown,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(orgId, taxYear, taxMonth);
    return saved;
  }

  // ─── Add daily sales ──────────────────────────────────────────────────────
  // Single call from the restaurant / retail daily sales screen.

  async addDailySales(
    orgId: string,
    dto: AddDailySalesDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry[]> {
    const profile = await this.getProfile(orgId);
    // FIX: profile.defaultVatRate is a string — parse before arithmetic
    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    const results: BookkeepingEntry[] = [];

    // Cash sales — with optional VAT exclusion
    if (dto.cashSales && dto.cashSales > 0) {
      results.push(
        await this.addIncome(
          orgId,
          {
            date: dto.date,
            grossAmount: dto.cashSales,
            category: EntryCategory.SALES_CASH,
            description: `Cash sales – ${dto.date}`,
            vatRate,
            excludeFromVat: dto.excludeCashFromVat ?? false,
            notes: dto.notes,
          },
          createdByUserId,
        ),
      );
    }

    // Card sales — always VAT-taxable (traceable payment trail)
    if (dto.cardSales && dto.cardSales > 0) {
      results.push(
        await this.addIncome(
          orgId,
          {
            date: dto.date,
            grossAmount: dto.cardSales,
            category: EntryCategory.SALES_CARD,
            description: `Card sales – ${dto.date}`,
            vatRate,
            excludeFromVat: false,
            notes: dto.notes,
          },
          createdByUserId,
        ),
      );
    }

    // Own webshop / online channel sales
    if (dto.onlineSales && dto.onlineSales > 0) {
      results.push(
        await this.addIncome(
          orgId,
          {
            date: dto.date,
            grossAmount: dto.onlineSales,
            category: EntryCategory.SALES_ONLINE,
            description: `Online sales – ${dto.date}`,
            vatRate,
            excludeFromVat: false,
            notes: dto.notes,
          },
          createdByUserId,
        ),
      );
    }

    // Third party platform payouts — creates income + commission expense per platform
    if (dto.thirdPartySales?.length) {
      for (const tp of dto.thirdPartySales) {
        const tpResult = await this.addThirdPartyPayout(
          orgId,
          {
            date: dto.date,
            platform: tp.platform,
            grossOrderValue: tp.grossAmount,
            commissionRate: tp.commissionRate,
            vatRate,
            notes: dto.notes,
          },
          createdByUserId,
        );
        results.push(tpResult.incomeEntry, tpResult.commissionEntry);
      }
    }

    if (results.length === 0) {
      throw new BadRequestException(
        'At least one of cashSales, cardSales, onlineSales, or thirdPartySales must be provided',
      );
    }

    return results;
  }

  // ─── Payroll preview (no DB write) ───────────────────────────────────────

  previewPayroll(
    gross: number,
    overrideExemption?: number,
    salaryType = SalaryType.FIXED,
    hoursWorked?: number,
    hourlyRate?: number,
  ): PayrollBreakdown {
    let resolvedGross = gross;
    if (salaryType === SalaryType.HOURLY) {
      if (!hoursWorked || !hourlyRate) {
        throw new BadRequestException('hoursWorked and hourlyRate required');
      }
      resolvedGross = +(hoursWorked * hourlyRate).toFixed(2);
    }
    const exemption = overrideExemption ?? calcBasicExemption(resolvedGross);
    const pensionII = +(resolvedGross * PENSION_II).toFixed(2);
    const unempEmp = +(resolvedGross * UNEMP_EMPLOYEE).toFixed(2);
    const itBase = Math.max(
      0,
      +(resolvedGross - exemption - pensionII).toFixed(2),
    );
    const incomeTax = +(itBase * INCOME_TAX_RATE).toFixed(2);
    const socialTax = +(resolvedGross * SOCIAL_TAX_RATE).toFixed(2);
    const unempEmpl = +(resolvedGross * UNEMP_EMPLOYER).toFixed(2);
    const netSalary = +(
      resolvedGross -
      incomeTax -
      unempEmp -
      pensionII
    ).toFixed(2);
    const employerCost = +(resolvedGross + socialTax + unempEmpl).toFixed(2);
    const taxBurden = +(
      resolvedGross -
      netSalary +
      socialTax +
      unempEmpl
    ).toFixed(2);

    return {
      salaryType,
      ...(salaryType === SalaryType.HOURLY ? { hoursWorked, hourlyRate } : {}),
      grossSalary: resolvedGross,
      basicExemption: exemption,
      fundedPensionII: pensionII,
      incomeTaxBase: itBase,
      incomeTaxWithheld: incomeTax,
      unemploymentEmp: unempEmp,
      unemploymentEmpl: unempEmpl,
      socialTax,
      netSalary,
      totalEmployerCost: employerCost,
      taxAsPercentOfCost:
        employerCost > 0 ? +((taxBurden / employerCost) * 100).toFixed(1) : 0,
    };
  }

  // ─── Auto-sync from commerce-os order ────────────────────────────────────
  // Called by orders.service when an order reaches PAID/DELIVERED status.

  async syncFromOrder(
    orgId: string,
    order: {
      id: string;
      total: number;
      subtotal: number;
      deliveryFee: number;
      paidAmount: number;
      status: string;
      paymentStatus: string;
      createdAt: Date;
    },
  ): Promise<void> {
    const existing = await this.entryRepo.findOne({
      where: { orgId, sourceType: SourceType.ORDER_SYNC, sourceId: order.id },
    });
    if (existing) return; // idempotent — skip if already synced

    const date = order.createdAt;
    const { taxYear, taxMonth } = periodFromDate(date);
    await this.ensurePeriod(orgId, taxYear, taxMonth);

    const profile = await this.getProfile(orgId);
    const vatRate = Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(order.total, vatRate);

    await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date: date.toISOString().split('T')[0] as unknown as string,
        taxYear,
        taxMonth,
        entryType: EntryType.INCOME,
        category: EntryCategory.SALES_ONLINE,
        description: `Order #${String(order.id).slice(0, 8).toUpperCase()}`,
        grossAmount: order.total as unknown as string,
        vatRate: vatRate as unknown as string,
        vatAmount: vatAmount as unknown as string,
        netAmount: netAmount as unknown as string,
        excludeFromVat: false,
        sourceType: SourceType.ORDER_SYNC,
        sourceId: order.id,
        status: EntryStatus.CONFIRMED,
      }),
    );

    await this.recalculatePeriod(orgId, taxYear, taxMonth);
  }

  // ─── List entries ─────────────────────────────────────────────────────────

  async listEntries(
    orgId: string,
    dto: ListEntriesDto,
  ): Promise<{ items: BookkeepingEntry[]; total: number }> {
    const qb = this.entryRepo
      .createQueryBuilder('e')
      .where('e.orgId = :orgId', { orgId })
      .andWhere('e.status != :excluded', { excluded: EntryStatus.EXCLUDED })
      .orderBy('e.date', 'DESC')
      .addOrderBy('e.createdAt', 'DESC')
      .take(dto.limit ?? 50)
      .skip(dto.offset ?? 0);

    if (dto.year) qb.andWhere('e.taxYear = :year', { year: dto.year });
    if (dto.month) qb.andWhere('e.taxMonth = :month', { month: dto.month });
    if (dto.entryType)
      qb.andWhere('e.entryType = :type', { type: dto.entryType });
    if (dto.category) qb.andWhere('e.category = :cat', { cat: dto.category });

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async excludeEntry(id: string, orgId: string): Promise<void> {
    const entry = await this.entryRepo.findOne({ where: { id, orgId } });
    if (!entry) throw new NotFoundException('Entry not found');
    entry.status = EntryStatus.EXCLUDED;
    await this.entryRepo.save(entry);
    await this.recalculatePeriod(orgId, entry.taxYear, entry.taxMonth);
  }

  // ─── Recalculate period totals ────────────────────────────────────────────
  // Called after every write. Keeps MonthlyTaxPeriod summary current.
  // VAT totals only count entries where excludeFromVat = false.
  // Income totals include ALL confirmed income (including cash-excluded entries).

  async recalculatePeriod(
    orgId: string,
    year: number,
    month: number,
  ): Promise<MonthlyTaxPeriod> {
    const period = await this.ensurePeriod(orgId, year, month);
    if (period.status === PeriodStatus.LOCKED) return period;

    const entries = await this.entryRepo.find({
      where: {
        orgId,
        taxYear: year,
        taxMonth: month,
        status: EntryStatus.CONFIRMED,
      },
    });

    let totalIncomeGross = 0,
      totalIncomeNet = 0;
    let totalExpenseGross = 0,
      totalExpenseNet = 0;
    let totalGrossSalary = 0;
    let vatOutputTotal = 0,
      vatInputTotal = 0;
    let totalThirdPartyGross = 0,
      totalPlatformCommission = 0,
      totalThirdPartyPayout = 0;

    for (const e of entries) {
      // FIX: all decimal columns come back as strings — always Number() them
      const gross = Number(e.grossAmount);
      const net = Number(e.netAmount);
      const vat = Number(e.vatAmount);

      if (e.entryType === EntryType.INCOME) {
        totalIncomeGross += gross;
        totalIncomeNet += net;
        if (!e.excludeFromVat) vatOutputTotal += vat;

        if (e.category === EntryCategory.SALES_THIRD_PARTY) {
          totalThirdPartyGross += gross;
          // platformPayoutAmount is string | null — guard before Number()
          totalThirdPartyPayout += Number(e.platformPayoutAmount ?? 0);
        }
      } else if (e.entryType === EntryType.EXPENSE) {
        totalExpenseGross += gross;
        totalExpenseNet += net;
        vatInputTotal += vat;

        if (e.category === EntryCategory.PLATFORM_COMMISSION) {
          totalPlatformCommission += gross;
        }
      } else if (e.entryType === EntryType.SALARY) {
        totalGrossSalary += gross;
      }
    }

    // Extract payroll tax figures from the structured lineItems we store in
    // receiptParsedData — avoids a separate payroll table for now.
    const salaryEntries = entries.filter(
      (e) => e.entryType === EntryType.SALARY,
    );
    let totalIncomeTaxWithheld = 0,
      totalSocialTax = 0,
      totalEmployerCost = 0;

    for (const e of salaryEntries) {
      const items = e.receiptParsedData?.lineItems ?? [];
      for (const item of items) {
        if (item.description.startsWith('Income tax'))
          totalIncomeTaxWithheld += Math.abs(item.total);
        if (item.description.startsWith('Social tax employer'))
          totalSocialTax += item.total;
        if (item.description.startsWith('Total employer'))
          totalEmployerCost += item.total;
      }
    }

    Object.assign(period, {
      totalIncomeGross: +totalIncomeGross.toFixed(2),
      totalIncomeNet: +totalIncomeNet.toFixed(2),
      totalExpenseGross: +totalExpenseGross.toFixed(2),
      totalExpenseNet: +totalExpenseNet.toFixed(2),
      totalGrossSalary: +totalGrossSalary.toFixed(2),
      totalIncomeTaxWithheld: +totalIncomeTaxWithheld.toFixed(2),
      totalSocialTax: +totalSocialTax.toFixed(2),
      totalEmployerCost: +totalEmployerCost.toFixed(2),
      vatOutputTotal: +vatOutputTotal.toFixed(2),
      vatInputTotal: +vatInputTotal.toFixed(2),
      vatPayable: +(vatOutputTotal - vatInputTotal).toFixed(2),
      totalThirdPartyGross: +totalThirdPartyGross.toFixed(2),
      totalPlatformCommission: +totalPlatformCommission.toFixed(2),
      totalThirdPartyPayout: +totalThirdPartyPayout.toFixed(2),
    });

    return this.periodRepo.save(period);
  }
}
