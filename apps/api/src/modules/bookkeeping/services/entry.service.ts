/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
} from '../entities/bookkeeping.entities';
import {
  AddDailySalesDto,
  AddExpenseDto,
  AddIncomeDto,
  AddSalaryDto,
  AddThirdPartyPayoutDto,
  ListEntriesDto,
} from '../dto/bookkeeping.dto';

// Estonian payroll constants (2025+)
const INCOME_TAX_RATE = 0.22;
const SOCIAL_TAX_RATE = 0.33;
const UNEMP_EMPLOYEE = 0.016;
const UNEMP_EMPLOYER = 0.008;
const PENSION_II = 0.02;
const EXEMPTION_MAX = 654;
const EXEMPTION_TAPER_LO = 1_200;
const EXEMPTION_TAPER_HI = 2_100;

function calcBasicExemption(gross: number): number {
  if (gross <= EXEMPTION_TAPER_LO) return EXEMPTION_MAX;
  if (gross >= EXEMPTION_TAPER_HI) return 0;
  return +(
    EXEMPTION_MAX *
    (1 -
      (gross - EXEMPTION_TAPER_LO) / (EXEMPTION_TAPER_HI - EXEMPTION_TAPER_LO))
  ).toFixed(2);
}

function splitVat(gross: number, vatRate: number) {
  const vatAmount = +(gross - gross / (1 + vatRate / 100)).toFixed(2);
  const netAmount = +(gross - vatAmount).toFixed(2);
  return { vatAmount, netAmount };
}

function periodFromDate(d: Date) {
  return { taxYear: d.getFullYear(), taxMonth: d.getMonth() + 1 };
}

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

// Result of adding a third party payout — two entries created
export interface ThirdPartyPayoutResult {
  incomeEntry: BookkeepingEntry; // SALES_THIRD_PARTY — full gross order value
  commissionEntry: BookkeepingEntry; // PLATFORM_COMMISSION — deductible expense
  grossOrderValue: number;
  commissionAmount: number;
  payoutAmount: number;
  effectiveCommissionRate: number;
}
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

  // ─── Tax profile helper ──────────────────────────────────────────────────

  private async getProfile(orgId: string): Promise<TaxProfile> {
    const profile = await this.profileRepo.findOne({
      where: { orgId },
    });
    if (!profile) {
      throw new NotFoundException(
        'Tax profile not found. Complete onboarding at /bookkeeping/setup first.',
      );
    }
    return profile;
  }

  // ─── Ensure period exists ────────────────────────────────────────────────
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

  // ─── Add income ──────────────────────────────────────────────────────────
  // Restaurant: daily cash/card sales
  // Freelancer: client invoice payment
  // Ecommerce: manual top-up (orders auto-sync via order hook)

  async addIncome(
    orgId: string,
    dto: AddIncomeDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    const profile = await this.getProfile(orgId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(orgId, taxYear, taxMonth);

    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    // If excluded from VAT, record 0 VAT regardless of the rate setting
    const effectiveVatRate = dto.excludeFromVat ? 0 : vatRate;
    const { vatAmount, netAmount } = splitVat(
      dto.grossAmount,
      effectiveVatRate,
    );

    const entry = this.entryRepo.create({
      orgId,
      date,
      taxYear,
      taxMonth,
      entryType: EntryType.INCOME,
      category: dto.category,
      description: dto.description ?? `Sales – ${dto.date}`,
      grossAmount: dto.grossAmount,
      vatRate: effectiveVatRate,
      vatAmount,
      netAmount,
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
  // async addIncome(
  //   orgId: string,
  //   dto: AddIncomeDto,
  //   createdByUserId?: string,
  // ): Promise<BookkeepingEntry> {
  //   const profile = await this.getProfile(orgId);
  //   const date = new Date(dto.date);
  //   const { taxYear, taxMonth } = periodFromDate(date);

  //   await this.ensurePeriod(orgId, taxYear, taxMonth);

  //   const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
  //   const { vatAmount, netAmount } = splitVat(dto.grossAmount, vatRate);

  //   const entry = this.entryRepo.create({
  //     orgId,
  //     date,
  //     taxYear,
  //     taxMonth,
  //     entryType: EntryType.INCOME,
  //     category: dto.category,
  //     description: dto.description ?? `Sales – ${dto.date}`,
  //     grossAmount: dto.grossAmount,
  //     vatRate,
  //     vatAmount,
  //     netAmount,
  //     sourceType: SourceType.MANUAL,
  //     counterpartyName: dto.counterpartyName,
  //     counterpartyVatNumber: dto.counterpartyVatNumber,
  //     invoiceNumber: dto.invoiceNumber,
  //     notes: dto.notes,
  //     status: EntryStatus.CONFIRMED,
  //     createdByUserId,
  //   });

  //   const saved = await this.entryRepo.save(entry);
  //   await this.recalculatePeriod(orgId, taxYear, taxMonth);
  //   return saved;
  // }

  // ─── Add expense ─────────────────────────────────────────────────────────
  // Restaurant: supplier invoice for meat/veg
  // Freelancer: equipment, software, transport
  // Ecommerce: packaging, returns shipping

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
      date,
      taxYear,
      taxMonth,
      entryType: EntryType.EXPENSE,
      category: dto.category,
      description:
        dto.description ?? `Expense – ${dto.counterpartyName ?? dto.date}`,
      grossAmount: dto.grossAmount,
      vatRate,
      vatAmount,
      netAmount,
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
  // async addExpense(
  //   orgId: string,
  //   dto: AddExpenseDto,
  //   createdByUserId?: string,
  // ): Promise<BookkeepingEntry> {
  //   await this.getProfile(orgId);
  //   const date = new Date(dto.date);
  //   const { taxYear, taxMonth } = periodFromDate(date);

  //   await this.ensurePeriod(orgId, taxYear, taxMonth);

  //   const vatRate = dto.vatRate ?? 0; // Assume no deductible VAT unless specified
  //   const { vatAmount, netAmount } = splitVat(dto.grossAmount, vatRate);

  //   const entry = this.entryRepo.create({
  //     orgId,
  //     date,
  //     taxYear,
  //     taxMonth,
  //     entryType: EntryType.EXPENSE,
  //     category: dto.category,
  //     description:
  //       dto.description ?? `Expense – ${dto.counterpartyName ?? dto.date}`,
  //     grossAmount: dto.grossAmount,
  //     vatRate,
  //     vatAmount,
  //     netAmount,
  //     sourceType: dto.receiptImageUrl
  //       ? SourceType.RECEIPT_SCAN
  //       : SourceType.MANUAL,
  //     receiptImageUrl: dto.receiptImageUrl,
  //     counterpartyName: dto.counterpartyName,
  //     counterpartyVatNumber: dto.counterpartyVatNumber,
  //     invoiceNumber: dto.invoiceNumber,
  //     notes: dto.notes,
  //     status: EntryStatus.CONFIRMED,
  //     createdByUserId,
  //   });

  //   const saved = await this.entryRepo.save(entry);
  //   await this.recalculatePeriod(orgId, taxYear, taxMonth);
  //   return saved;
  // }

  // ─── Add salary ───────────────────────────────────────────────────────────
  // Single employee salary payment.
  // All tax deductions computed here — owner never enters tax amounts manually.

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
  //   1. INCOME: SALES_THIRD_PARTY — full gross order value (what customers paid)
  //   2. EXPENSE: PLATFORM_COMMISSION — commission deducted by platform
  //
  // Tax logic:
  //   - Income entry: full gross is taxable (VAT applies if registered)
  //   - Commission entry: 0% VAT — reverse charge service from foreign company
  //     (Wolt OÜ / Bolt Operations OÜ are Estonian but commission billing is
  //      typically handled through their international entities — conservatively
  //      set to 0% VAT; the user can override if they have a local VAT invoice)
  //
  // The user either provides:
  //   a) payoutAmount  → system back-calculates gross = payout / (1 - rate)
  //   b) grossOrderValue → system forward-calculates commission = gross * rate

  async addThirdPartyPayout(
    orgId: string,
    dto: AddThirdPartyPayoutDto,
    createdByUserId?: string,
  ): Promise<ThirdPartyPayoutResult> {
    const profile = await this.getProfile(orgId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(orgId, taxYear, taxMonth);

    // Resolve commission rate
    const commissionRate =
      dto.commissionRate ?? PLATFORM_COMMISSION_RATES[dto.platform];

    if (commissionRate <= 0 || commissionRate >= 1) {
      throw new BadRequestException(
        'Commission rate must be between 0 and 1 (e.g. 0.28 for 28%)',
      );
    }

    // Resolve gross and payout
    let grossOrderValue: number;
    let payoutAmount: number;
    let commissionAmount: number;

    if (dto.grossOrderValue) {
      // User has the platform report — most accurate
      grossOrderValue = dto.grossOrderValue;
      commissionAmount = +(grossOrderValue * commissionRate).toFixed(2);
      payoutAmount = +(grossOrderValue - commissionAmount).toFixed(2);
    } else if (dto.payoutAmount) {
      // User only has the bank payout — back-calculate
      payoutAmount = dto.payoutAmount;
      grossOrderValue = +(payoutAmount / (1 - commissionRate)).toFixed(2);
      commissionAmount = +(grossOrderValue - payoutAmount).toFixed(2);
    } else {
      throw new BadRequestException(
        'Provide either grossOrderValue or payoutAmount',
      );
    }

    const periodLabel = dto.periodLabel ?? `${dto.date}`;
    const platformLabel = dto.platform.replace('_', ' ');

    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(grossOrderValue, vatRate);

    // ── Entry 1: Income (full gross order value) ──────────────────────────
    const incomeEntry = await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date,
        taxYear,
        taxMonth,
        entryType: EntryType.INCOME,
        category: EntryCategory.SALES_THIRD_PARTY,
        description: `${platformLabel} sales – ${periodLabel}`,
        grossAmount: grossOrderValue,
        vatRate,
        vatAmount,
        netAmount,
        excludeFromVat: false, // Platform sales ARE VAT-taxable
        thirdPartyPlatform: dto.platform,
        platformCommissionRate: commissionRate,
        platformCommissionAmount: commissionAmount,
        platformPayoutAmount: payoutAmount,
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
    // Commission is a deductible business expense.
    // VAT rate = 0% (reverse charge — foreign B2B service).
    const commissionEntry = await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date,
        taxYear,
        taxMonth,
        entryType: EntryType.EXPENSE,
        category: EntryCategory.PLATFORM_COMMISSION,
        description: `${platformLabel} commission – ${periodLabel}`,
        grossAmount: commissionAmount,
        vatRate: 0, // Reverse charge / no local VAT
        vatAmount: 0,
        netAmount: commissionAmount,
        thirdPartyPlatform: dto.platform,
        platformCommissionRate: commissionRate,
        platformCommissionAmount: commissionAmount,
        platformPayoutAmount: payoutAmount,
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

  async addSalary(
    orgId: string,
    dto: AddSalaryDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    await this.getProfile(orgId);

    const employee = await this.employeeRepo.findOne({
      where: { id: dto.employeeId, orgId },
    });
    if (!employee)
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);

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

    const entry = this.entryRepo.create({
      orgId,
      date,
      taxYear,
      taxMonth,
      entryType: EntryType.SALARY,
      category: employee.isBoardMember
        ? EntryCategory.BOARD_FEE
        : EntryCategory.STAFF_SALARY,
      description: `Salary – ${employee.fullName}`,
      grossAmount: gross,
      vatRate: 0,
      vatAmount: 0,
      netAmount: netSalary,
      sourceType: SourceType.MANUAL,
      counterpartyName: employee.fullName,
      notes: noteParts,
      status: EntryStatus.CONFIRMED,
      createdByUserId,
      receiptParsedData: {
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
          { description: 'Unemployment (1.6%)', total: -unempEmp },
          { description: 'Pension II (2%)', total: -pensionII },
          { description: 'Net take-home', total: netSalary },
          { description: 'Social tax (33%)', total: socialTax },
          { description: 'Unemployment emp (0.8%)', total: unempEmpl },
          { description: 'Total employer cost', total: employerCost },
        ],
      } as any,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(orgId, taxYear, taxMonth);
    return saved;
  }

  // async addSalary(
  //   orgId: string,
  //   dto: AddSalaryDto,
  //   createdByUserId?: string,
  // ): Promise<BookkeepingEntry> {
  //   await this.getProfile(orgId);

  //   const employee = await this.employeeRepo.findOne({
  //     where: { id: dto.employeeId, orgId },
  //   });
  //   if (!employee) {
  //     throw new NotFoundException(`Employee ${dto.employeeId} not found`);
  //   }

  //   const date = new Date(dto.date);
  //   const { taxYear, taxMonth } = periodFromDate(date);
  //   await this.ensurePeriod(orgId, taxYear, taxMonth);

  //   const gross = dto.grossAmount;
  //   const exemption = dto.basicExemption ?? calcBasicExemption(gross);
  //   const pensionII = +(gross * PENSION_II).toFixed(2);
  //   const unempEmp = +(gross * UNEMP_EMPLOYEE).toFixed(2);
  //   const itBase = Math.max(0, +(gross - exemption - pensionII).toFixed(2));
  //   const incomeTax = +(itBase * INCOME_TAX_RATE).toFixed(2);
  //   const socialTax = +(gross * SOCIAL_TAX_RATE).toFixed(2);
  //   const unempEmpl = +(gross * UNEMP_EMPLOYER).toFixed(2);
  //   const netSalary = +(gross - incomeTax - unempEmp - pensionII).toFixed(2);

  //   const entry = this.entryRepo.create({
  //     orgId,
  //     date,
  //     taxYear,
  //     taxMonth,
  //     entryType: EntryType.SALARY,
  //     category: employee.isBoardMember
  //       ? EntryCategory.BOARD_FEE
  //       : EntryCategory.STAFF_SALARY,
  //     description: `Salary – ${employee.fullName}`,
  //     grossAmount: gross,
  //     vatRate: 0,
  //     vatAmount: 0,
  //     netAmount: netSalary,
  //     sourceType: SourceType.MANUAL,
  //     counterpartyName: employee.fullName,
  //     notes: [
  //       `Income tax: €${incomeTax}`,
  //       `Social tax (employer): €${socialTax}`,
  //       `Unemployment (emp): €${unempEmp}`,
  //       `Pension II: €${pensionII}`,
  //       `Exemption applied: €${exemption}`,
  //       dto.bankReferenceNumber ? `Ref: ${dto.bankReferenceNumber}` : '',
  //       dto.notes ?? '',
  //     ]
  //       .filter(Boolean)
  //       .join(' | '),
  //     status: EntryStatus.CONFIRMED,
  //     createdByUserId,
  //     // Store full breakdown for TSD generation
  //     receiptParsedData: {
  //       merchantName: employee.fullName,
  //       confidence: 1,
  //       lineItems: [
  //         { description: 'Gross salary', total: gross },
  //         { description: 'Income tax (22%)', total: -incomeTax },
  //         { description: 'Unemployment (1.6%)', total: -unempEmp },
  //         { description: 'Pension II (2%)', total: -pensionII },
  //         { description: 'Net take-home', total: netSalary },
  //         { description: 'Social tax (33%)', total: socialTax },
  //         { description: 'Unemployment emp (0.8%)', total: unempEmpl },
  //       ],
  //     } as any,
  //   });

  //   const saved = await this.entryRepo.save(entry);
  //   await this.recalculatePeriod(orgId, taxYear, taxMonth);
  //   return saved;
  // }

  // ─── Add daily sales ──────────────────────────────────────────────────────

  async addDailySales(
    orgId: string,
    dto: AddDailySalesDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry[]> {
    const profile = await this.getProfile(orgId);
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

    // Card sales — always VAT-taxable (card payments are always traceable)
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

    // Own webshop / online sales
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

    // Third party platform sales — creates income + commission expense per platform
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

  // ─── Daily sales batch (restaurant-optimised) ─────────────────────────────
  // One call = end-of-day entry. Creates up to 3 entries (cash/card/online).
  // This is the primary input method for restaurant owners.

  // async addDailySales(
  //   orgId: string,
  //   dto: AddDailySalesDto,
  //   createdByUserId?: string,
  // ): Promise<BookkeepingEntry[]> {
  //   const profile = await this.getProfile(orgId);
  //   const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
  //   const results: BookkeepingEntry[] = [];

  //   const channels: Array<{
  //     amount: number | undefined;
  //     category: EntryCategory;
  //     label: string;
  //   }> = [
  //     {
  //       amount: dto.cashSales,
  //       category: EntryCategory.SALES_CASH,
  //       label: 'Cash sales',
  //     },
  //     {
  //       amount: dto.cardSales,
  //       category: EntryCategory.SALES_CARD,
  //       label: 'Card sales',
  //     },
  //     {
  //       amount: dto.onlineSales,
  //       category: EntryCategory.SALES_ONLINE,
  //       label: 'Online sales',
  //     },
  //   ];

  //   for (const ch of channels) {
  //     if (!ch.amount || ch.amount <= 0) continue;
  //     const result = await this.addIncome(
  //       orgId,
  //       {
  //         date: dto.date,
  //         grossAmount: ch.amount,
  //         category: ch.category,
  //         description: `${ch.label} – ${dto.date}`,
  //         vatRate,
  //         notes: dto.notes,
  //       },
  //       createdByUserId,
  //     );
  //     results.push(result);
  //   }

  //   if (results.length === 0) {
  //     throw new BadRequestException(
  //       'At least one of cashSales, cardSales, or onlineSales must be > 0',
  //     );
  //   }

  //   return results;
  // }

  // ─── Payroll preview ──────────────────────────────────────────────────────

  previewPayroll(
    gross: number,
    overrideExemption?: number,
    salaryType = SalaryType.FIXED,
    hoursWorked?: number,
    hourlyRate?: number,
  ): PayrollBreakdown {
    let resolvedGross = gross;
    if (salaryType === SalaryType.HOURLY) {
      if (!hoursWorked || !hourlyRate)
        throw new BadRequestException('hoursWorked and hourlyRate required');
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
  // Ecommerce owners get their sales in without touching anything.

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
    if (existing) return;

    const date = order.createdAt;
    const { taxYear, taxMonth } = periodFromDate(date);
    await this.ensurePeriod(orgId, taxYear, taxMonth);

    const profile = await this.getProfile(orgId);
    const vatRate = Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(order.total, vatRate);

    await this.entryRepo.save(
      this.entryRepo.create({
        orgId,
        date,
        taxYear,
        taxMonth,
        entryType: EntryType.INCOME,
        category: EntryCategory.SALES_ONLINE,
        description: `Order #${String(order.id).slice(0, 8).toUpperCase()}`,
        grossAmount: order.total,
        vatRate,
        vatAmount,
        netAmount,
        excludeFromVat: false,
        sourceType: SourceType.ORDER_SYNC,
        sourceId: order.id,
        status: EntryStatus.CONFIRMED,
      }),
    );

    await this.recalculatePeriod(orgId, taxYear, taxMonth);
  }

  // async syncFromOrder(
  //   orgId: string,
  //   order: {
  //     id: string;
  //     total: number;
  //     subtotal: number;
  //     deliveryFee: number;
  //     paidAmount: number;
  //     status: string;
  //     paymentStatus: string;
  //     createdAt: Date;
  //   },
  // ): Promise<void> {
  //   // Avoid double-sync
  //   const existing = await this.entryRepo.findOne({
  //     where: {
  //       orgId,
  //       sourceType: SourceType.ORDER_SYNC,
  //       sourceId: order.id,
  //     },
  //   });
  //   if (existing) return;

  //   const date = order.createdAt;
  //   const { taxYear, taxMonth } = periodFromDate(date);

  //   await this.ensurePeriod(orgId, taxYear, taxMonth);

  //   const profile = await this.getProfile(orgId);
  //   const vatRate = Number(profile.defaultVatRate);
  //   const { vatAmount, netAmount } = splitVat(order.total, vatRate);

  //   const entry = this.entryRepo.create({
  //     orgId,
  //     date,
  //     taxYear,
  //     taxMonth,
  //     entryType: EntryType.INCOME,
  //     category: EntryCategory.SALES_ONLINE,
  //     description: `Order #${String(order.id).slice(0, 8).toUpperCase()}`,
  //     grossAmount: order.total,
  //     vatRate,
  //     vatAmount,
  //     netAmount,
  //     sourceType: SourceType.ORDER_SYNC,
  //     sourceId: order.id,
  //     status: EntryStatus.CONFIRMED,
  //   });

  //   await this.entryRepo.save(entry);
  //   await this.recalculatePeriod(orgId, taxYear, taxMonth);

  //   this.logger.log(
  //     `Synced order ${order.id} → bookkeeping entry for org ${orgId}`,
  //   );
  // }

  // ─── List entries ─────────────────────────────────────────────────────────

  async listEntries(orgId: string, dto: ListEntriesDto) {
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

  // async listEntries(orgId: string, dto: ListEntriesDto) {
  //   const qb = this.entryRepo
  //     .createQueryBuilder('e')
  //     .where('e.orgId = :orgId', { orgId })
  //     .andWhere('e.status != :excluded', { excluded: EntryStatus.EXCLUDED })
  //     .orderBy('e.date', 'DESC')
  //     .addOrderBy('e.createdAt', 'DESC')
  //     .take(dto.limit ?? 50)
  //     .skip(dto.offset ?? 0);

  //   if (dto.year) qb.andWhere('e.taxYear = :year', { year: dto.year });
  //   if (dto.month) qb.andWhere('e.taxMonth = :month', { month: dto.month });
  //   if (dto.entryType)
  //     qb.andWhere('e.entryType = :type', { type: dto.entryType });
  //   if (dto.category) qb.andWhere('e.category = :cat', { cat: dto.category });

  //   const [items, total] = await qb.getManyAndCount();
  //   return { items, total };
  // }

  // ─── Delete / exclude entry ───────────────────────────────────────────────

  // async excludeEntry(id: string, orgId: string): Promise<void> {
  //   const entry = await this.entryRepo.findOne({
  //     where: { id, orgId },
  //   });
  //   if (!entry) throw new NotFoundException('Entry not found');
  //   entry.status = EntryStatus.EXCLUDED;
  //   await this.entryRepo.save(entry);
  //   await this.recalculatePeriod(orgId, entry.taxYear, entry.taxMonth);
  // }

  // ─── Recalculate period totals ────────────────────────────────────────────
  // Called after every write. Keeps the MonthlyTaxPeriod summary current.

  // KEY CHANGE: VAT totals only count entries where excludeFromVat = false.
  // Income totals still include ALL confirmed income (including cash-excluded).

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
      const gross = Number(e.grossAmount);
      const net = Number(e.netAmount);
      const vat = Number(e.vatAmount);

      if (e.entryType === EntryType.INCOME) {
        totalIncomeGross += gross;
        totalIncomeNet += net;
        // Only add to VAT output if NOT excluded
        if (!e.excludeFromVat) vatOutputTotal += vat;

        if (e.category === EntryCategory.SALES_THIRD_PARTY) {
          totalThirdPartyGross += gross;
          totalThirdPartyPayout += Number(e.platformPayoutAmount ?? 0);
        }
      } else if (e.entryType === EntryType.EXPENSE) {
        totalExpenseGross += gross;
        totalExpenseNet += net;
        vatInputTotal += vat; // All expense VAT is deductible input

        if (e.category === EntryCategory.PLATFORM_COMMISSION) {
          totalPlatformCommission += gross;
        }
      } else if (e.entryType === EntryType.SALARY) {
        totalGrossSalary += gross;
      }
    }

    const salaryEntries = entries.filter(
      (e) => e.entryType === EntryType.SALARY,
    );
    let totalIncomeTaxWithheld = 0,
      totalSocialTax = 0,
      totalEmployerCost = 0;
    for (const e of salaryEntries) {
      const items = (e.receiptParsedData as any)?.lineItems ?? [];
      for (const item of items) {
        if (item.description.startsWith('Income tax'))
          totalIncomeTaxWithheld += Math.abs(item.total);
        if (item.description.startsWith('Social tax'))
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
  // async recalculatePeriod(
  //   orgId: string,
  //   year: number,
  //   month: number,
  // ): Promise<MonthlyTaxPeriod> {
  //   const period = await this.ensurePeriod(orgId, year, month);
  //   if (period.status === PeriodStatus.LOCKED) return period;

  //   const entries = await this.entryRepo.find({
  //     where: {
  //       orgId,
  //       taxYear: year,
  //       taxMonth: month,
  //       status: EntryStatus.CONFIRMED,
  //     },
  //   });

  //   let totalIncomeGross = 0,
  //     totalIncomeNet = 0;
  //   let totalExpenseGross = 0,
  //     totalExpenseNet = 0;
  //   let totalGrossSalary = 0;
  //   let vatOutputTotal = 0,
  //     vatInputTotal = 0;

  //   for (const e of entries) {
  //     const gross = Number(e.grossAmount);
  //     const net = Number(e.netAmount);
  //     const vat = Number(e.vatAmount);

  //     if (e.entryType === EntryType.INCOME) {
  //       totalIncomeGross += gross;
  //       totalIncomeNet += net;
  //       vatOutputTotal += vat;
  //     } else if (e.entryType === EntryType.EXPENSE) {
  //       totalExpenseGross += gross;
  //       totalExpenseNet += net;
  //       vatInputTotal += vat;
  //     } else if (e.entryType === EntryType.SALARY) {
  //       totalGrossSalary += gross;
  //     }
  //   }

  //   // Sum salary-related taxes from stored breakdown
  //   const salaryEntries = entries.filter(
  //     (e) => e.entryType === EntryType.SALARY,
  //   );
  //   let totalIncomeTaxWithheld = 0,
  //     totalSocialTax = 0,
  //     totalEmployerCost = 0;

  //   for (const e of salaryEntries) {
  //     const items = (e.receiptParsedData as any)?.lineItems ?? [];
  //     const gross = Number(e.grossAmount);
  //     for (const item of items) {
  //       if (item.description.startsWith('Income tax'))
  //         totalIncomeTaxWithheld += Math.abs(item.total);
  //       if (item.description.startsWith('Social tax'))
  //         totalSocialTax += item.total;
  //     }
  //     totalEmployerCost += gross + gross * (SOCIAL_TAX_RATE + UNEMP_EMPLOYER);
  //   }

  //   Object.assign(period, {
  //     totalIncomeGross: +totalIncomeGross.toFixed(2),
  //     totalIncomeNet: +totalIncomeNet.toFixed(2),
  //     totalExpenseGross: +totalExpenseGross.toFixed(2),
  //     totalExpenseNet: +totalExpenseNet.toFixed(2),
  //     totalGrossSalary: +totalGrossSalary.toFixed(2),
  //     totalIncomeTaxWithheld: +totalIncomeTaxWithheld.toFixed(2),
  //     totalSocialTax: +totalSocialTax.toFixed(2),
  //     totalEmployerCost: +totalEmployerCost.toFixed(2),
  //     vatOutputTotal: +vatOutputTotal.toFixed(2),
  //     vatInputTotal: +vatInputTotal.toFixed(2),
  //     vatPayable: +(vatOutputTotal - vatInputTotal).toFixed(2),
  //   });

  //   return this.periodRepo.save(period);
  // }
}
