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
} from '../entities/bookkeeping.entities';
import {
  AddDailySalesDto,
  AddExpenseDto,
  AddIncomeDto,
  AddSalaryDto,
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

  private async getProfile(organizationId: string): Promise<TaxProfile> {
    const profile = await this.profileRepo.findOne({
      where: { organizationId },
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
    organizationId: string,
    year: number,
    month: number,
  ): Promise<MonthlyTaxPeriod> {
    let period = await this.periodRepo.findOne({
      where: { organizationId, year, month },
    });
    if (!period) {
      period = this.periodRepo.create({
        organizationId,
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
    organizationId: string,
    dto: AddIncomeDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    const profile = await this.getProfile(organizationId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(organizationId, taxYear, taxMonth);

    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(dto.grossAmount, vatRate);

    const entry = this.entryRepo.create({
      organizationId,
      date,
      taxYear,
      taxMonth,
      entryType: EntryType.INCOME,
      category: dto.category,
      description: dto.description ?? `Sales – ${dto.date}`,
      grossAmount: dto.grossAmount,
      vatRate,
      vatAmount,
      netAmount,
      sourceType: SourceType.MANUAL,
      counterpartyName: dto.counterpartyName,
      counterpartyVatNumber: dto.counterpartyVatNumber,
      invoiceNumber: dto.invoiceNumber,
      notes: dto.notes,
      status: EntryStatus.CONFIRMED,
      createdByUserId,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(organizationId, taxYear, taxMonth);
    return saved;
  }

  // ─── Add expense ─────────────────────────────────────────────────────────
  // Restaurant: supplier invoice for meat/veg
  // Freelancer: equipment, software, transport
  // Ecommerce: packaging, returns shipping

  async addExpense(
    organizationId: string,
    dto: AddExpenseDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    await this.getProfile(organizationId);
    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(organizationId, taxYear, taxMonth);

    const vatRate = dto.vatRate ?? 0; // Assume no deductible VAT unless specified
    const { vatAmount, netAmount } = splitVat(dto.grossAmount, vatRate);

    const entry = this.entryRepo.create({
      organizationId,
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
    await this.recalculatePeriod(organizationId, taxYear, taxMonth);
    return saved;
  }

  // ─── Add salary ───────────────────────────────────────────────────────────
  // Single employee salary payment.
  // All tax deductions computed here — owner never enters tax amounts manually.

  async addSalary(
    organizationId: string,
    dto: AddSalaryDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry> {
    await this.getProfile(organizationId);

    const employee = await this.employeeRepo.findOne({
      where: { id: dto.employeeId, organizationId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    }

    const date = new Date(dto.date);
    const { taxYear, taxMonth } = periodFromDate(date);
    await this.ensurePeriod(organizationId, taxYear, taxMonth);

    const gross = dto.grossAmount;
    const exemption = dto.basicExemption ?? calcBasicExemption(gross);
    const pensionII = +(gross * PENSION_II).toFixed(2);
    const unempEmp = +(gross * UNEMP_EMPLOYEE).toFixed(2);
    const itBase = Math.max(0, +(gross - exemption - pensionII).toFixed(2));
    const incomeTax = +(itBase * INCOME_TAX_RATE).toFixed(2);
    const socialTax = +(gross * SOCIAL_TAX_RATE).toFixed(2);
    const unempEmpl = +(gross * UNEMP_EMPLOYER).toFixed(2);
    const netSalary = +(gross - incomeTax - unempEmp - pensionII).toFixed(2);

    const entry = this.entryRepo.create({
      organizationId,
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
      notes: [
        `Income tax: €${incomeTax}`,
        `Social tax (employer): €${socialTax}`,
        `Unemployment (emp): €${unempEmp}`,
        `Pension II: €${pensionII}`,
        `Exemption applied: €${exemption}`,
        dto.bankReferenceNumber ? `Ref: ${dto.bankReferenceNumber}` : '',
        dto.notes ?? '',
      ]
        .filter(Boolean)
        .join(' | '),
      status: EntryStatus.CONFIRMED,
      createdByUserId,
      // Store full breakdown for TSD generation
      receiptParsedData: {
        merchantName: employee.fullName,
        confidence: 1,
        lineItems: [
          { description: 'Gross salary', total: gross },
          { description: 'Income tax (22%)', total: -incomeTax },
          { description: 'Unemployment (1.6%)', total: -unempEmp },
          { description: 'Pension II (2%)', total: -pensionII },
          { description: 'Net take-home', total: netSalary },
          { description: 'Social tax (33%)', total: socialTax },
          { description: 'Unemployment emp (0.8%)', total: unempEmpl },
        ],
      } as any,
    });

    const saved = await this.entryRepo.save(entry);
    await this.recalculatePeriod(organizationId, taxYear, taxMonth);
    return saved;
  }

  // ─── Daily sales batch (restaurant-optimised) ─────────────────────────────
  // One call = end-of-day entry. Creates up to 3 entries (cash/card/online).
  // This is the primary input method for restaurant owners.

  async addDailySales(
    organizationId: string,
    dto: AddDailySalesDto,
    createdByUserId?: string,
  ): Promise<BookkeepingEntry[]> {
    const profile = await this.getProfile(organizationId);
    const vatRate = dto.vatRate ?? Number(profile.defaultVatRate);
    const results: BookkeepingEntry[] = [];

    const channels: Array<{
      amount: number | undefined;
      category: EntryCategory;
      label: string;
    }> = [
      {
        amount: dto.cashSales,
        category: EntryCategory.SALES_CASH,
        label: 'Cash sales',
      },
      {
        amount: dto.cardSales,
        category: EntryCategory.SALES_CARD,
        label: 'Card sales',
      },
      {
        amount: dto.onlineSales,
        category: EntryCategory.SALES_ONLINE,
        label: 'Online sales',
      },
    ];

    for (const ch of channels) {
      if (!ch.amount || ch.amount <= 0) continue;
      const result = await this.addIncome(
        organizationId,
        {
          date: dto.date,
          grossAmount: ch.amount,
          category: ch.category,
          description: `${ch.label} – ${dto.date}`,
          vatRate,
          notes: dto.notes,
        },
        createdByUserId,
      );
      results.push(result);
    }

    if (results.length === 0) {
      throw new BadRequestException(
        'At least one of cashSales, cardSales, or onlineSales must be > 0',
      );
    }

    return results;
  }

  // ─── Auto-sync from commerce-os order ────────────────────────────────────
  // Called by orders.service when an order reaches PAID/DELIVERED status.
  // Ecommerce owners get their sales in without touching anything.

  async syncFromOrder(
    organizationId: string,
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
    // Avoid double-sync
    const existing = await this.entryRepo.findOne({
      where: {
        organizationId,
        sourceType: SourceType.ORDER_SYNC,
        sourceId: order.id,
      },
    });
    if (existing) return;

    const date = order.createdAt;
    const { taxYear, taxMonth } = periodFromDate(date);

    await this.ensurePeriod(organizationId, taxYear, taxMonth);

    const profile = await this.getProfile(organizationId);
    const vatRate = Number(profile.defaultVatRate);
    const { vatAmount, netAmount } = splitVat(order.total, vatRate);

    const entry = this.entryRepo.create({
      organizationId,
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
      sourceType: SourceType.ORDER_SYNC,
      sourceId: order.id,
      status: EntryStatus.CONFIRMED,
    });

    await this.entryRepo.save(entry);
    await this.recalculatePeriod(organizationId, taxYear, taxMonth);

    this.logger.log(
      `Synced order ${order.id} → bookkeeping entry for org ${organizationId}`,
    );
  }

  // ─── List entries ─────────────────────────────────────────────────────────

  async listEntries(organizationId: string, dto: ListEntriesDto) {
    const qb = this.entryRepo
      .createQueryBuilder('e')
      .where('e.organizationId = :organizationId', { organizationId })
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

  // ─── Delete / exclude entry ───────────────────────────────────────────────

  async excludeEntry(id: string, organizationId: string): Promise<void> {
    const entry = await this.entryRepo.findOne({
      where: { id, organizationId },
    });
    if (!entry) throw new NotFoundException('Entry not found');
    entry.status = EntryStatus.EXCLUDED;
    await this.entryRepo.save(entry);
    await this.recalculatePeriod(organizationId, entry.taxYear, entry.taxMonth);
  }

  // ─── Recalculate period totals ────────────────────────────────────────────
  // Called after every write. Keeps the MonthlyTaxPeriod summary current.

  async recalculatePeriod(
    organizationId: string,
    year: number,
    month: number,
  ): Promise<MonthlyTaxPeriod> {
    const period = await this.ensurePeriod(organizationId, year, month);
    if (period.status === PeriodStatus.LOCKED) return period;

    const entries = await this.entryRepo.find({
      where: {
        organizationId,
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

    for (const e of entries) {
      const gross = Number(e.grossAmount);
      const net = Number(e.netAmount);
      const vat = Number(e.vatAmount);

      if (e.entryType === EntryType.INCOME) {
        totalIncomeGross += gross;
        totalIncomeNet += net;
        vatOutputTotal += vat;
      } else if (e.entryType === EntryType.EXPENSE) {
        totalExpenseGross += gross;
        totalExpenseNet += net;
        vatInputTotal += vat;
      } else if (e.entryType === EntryType.SALARY) {
        totalGrossSalary += gross;
      }
    }

    // Sum salary-related taxes from stored breakdown
    const salaryEntries = entries.filter(
      (e) => e.entryType === EntryType.SALARY,
    );
    let totalIncomeTaxWithheld = 0,
      totalSocialTax = 0,
      totalEmployerCost = 0;

    for (const e of salaryEntries) {
      const items = (e.receiptParsedData as any)?.lineItems ?? [];
      const gross = Number(e.grossAmount);
      for (const item of items) {
        if (item.description.startsWith('Income tax'))
          totalIncomeTaxWithheld += Math.abs(item.total);
        if (item.description.startsWith('Social tax'))
          totalSocialTax += item.total;
      }
      totalEmployerCost += gross + gross * (SOCIAL_TAX_RATE + UNEMP_EMPLOYER);
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
    });

    return this.periodRepo.save(period);
  }
}
