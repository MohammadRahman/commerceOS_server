// apps/api/src/modules/estonia-tax/services/tsd.service.ts
// Computes Estonian payroll taxes and maintains monthly employee records.
// All calculations follow EMTA rules for 2025+.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EstoniaEmployeeTaxRecord,
  EstoniaTaxPeriod,
  TaxPeriodStatus,
} from '../entities/estonia-tax.entities';
import {
  ESTONIA_FUNDED_PENSION_II,
  ESTONIA_PERSONAL_INCOME_TAX_RATE,
  ESTONIA_SOCIAL_TAX_RATE,
  ESTONIA_UNEMPLOYMENT_EMPLOYEE,
  ESTONIA_UNEMPLOYMENT_EMPLOYER,
} from '../estonia-tax.constants';
import { RecordEmployeeTaxDto } from '../dto/estonia-tax.dto';

// Monthly basic exemption for 2025 (income-dependent, using max amount here)
// Full exemption: €654/month for income ≤ €1 200/month
// Tapers to 0 for income ≥ ~€2 100/month
const MONTHLY_BASIC_EXEMPTION_MAX = 654;
const EXEMPTION_TAPER_LOWER = 1200;
const EXEMPTION_TAPER_UPPER = 2100;

function computeBasicExemption(grossMonthlyIncome: number): number {
  if (grossMonthlyIncome <= EXEMPTION_TAPER_LOWER)
    return MONTHLY_BASIC_EXEMPTION_MAX;
  if (grossMonthlyIncome >= EXEMPTION_TAPER_UPPER) return 0;
  // Linear taper
  const taperedFraction =
    (grossMonthlyIncome - EXEMPTION_TAPER_LOWER) /
    (EXEMPTION_TAPER_UPPER - EXEMPTION_TAPER_LOWER);
  return parseFloat(
    (MONTHLY_BASIC_EXEMPTION_MAX * (1 - taperedFraction)).toFixed(2),
  );
}

export interface PayrollBreakdown {
  grossSalary: number;
  basicExemption: number;
  fundedPensionII: number; // Employee 2%
  incomeTaxBase: number; // gross - exemption - pension II
  incomeTaxWithheld: number; // 22% of base
  unemploymentEmployee: number; // 1.6% withheld
  unemploymentEmployer: number; // 0.8% employer cost
  socialTaxEmployer: number; // 33% of gross — employer cost
  netSalary: number; // Take-home
  totalEmployerCost: number; // gross + socialTax + unemploymentEmployer
}

@Injectable()
export class EstoniaTsdService {
  private readonly logger = new Logger(EstoniaTsdService.name);

  constructor(
    @InjectRepository(EstoniaEmployeeTaxRecord)
    private readonly empTaxRepo: Repository<EstoniaEmployeeTaxRecord>,

    @InjectRepository(EstoniaTaxPeriod)
    private readonly periodRepo: Repository<EstoniaTaxPeriod>,
  ) {}

  // ─── Tax calculation ──────────────────────────────────────────────────────
  // Pure function — no DB side effects. Use this for previewing payroll.

  calculatePayroll(
    grossSalary: number,
    overrideExemption?: number,
  ): PayrollBreakdown {
    const gross = parseFloat(grossSalary.toFixed(2));
    const basicExemption = overrideExemption ?? computeBasicExemption(gross);

    // Employee deductions
    const fundedPensionII = parseFloat(
      ((gross * ESTONIA_FUNDED_PENSION_II) / 100).toFixed(2),
    );
    const unemploymentEmployee = parseFloat(
      ((gross * ESTONIA_UNEMPLOYMENT_EMPLOYEE) / 100).toFixed(2),
    );

    // Income tax base: gross - basic exemption - pension II contribution
    const incomeTaxBase = Math.max(
      0,
      parseFloat((gross - basicExemption - fundedPensionII).toFixed(2)),
    );
    const incomeTaxWithheld = parseFloat(
      ((incomeTaxBase * ESTONIA_PERSONAL_INCOME_TAX_RATE) / 100).toFixed(2),
    );

    // Employer contributions
    const unemploymentEmployer = parseFloat(
      ((gross * ESTONIA_UNEMPLOYMENT_EMPLOYER) / 100).toFixed(2),
    );
    const socialTaxEmployer = parseFloat(
      ((gross * ESTONIA_SOCIAL_TAX_RATE) / 100).toFixed(2),
    );

    const netSalary = parseFloat(
      (
        gross -
        incomeTaxWithheld -
        unemploymentEmployee -
        fundedPensionII
      ).toFixed(2),
    );

    const totalEmployerCost = parseFloat(
      (gross + socialTaxEmployer + unemploymentEmployer).toFixed(2),
    );

    return {
      grossSalary: gross,
      basicExemption,
      fundedPensionII,
      incomeTaxBase,
      incomeTaxWithheld,
      unemploymentEmployee,
      unemploymentEmployer,
      socialTaxEmployer,
      netSalary,
      totalEmployerCost,
    };
  }

  // ─── Record & persist ─────────────────────────────────────────────────────

  async recordEmployeeTax(
    orgId: string,
    dto: RecordEmployeeTaxDto,
  ): Promise<EstoniaEmployeeTaxRecord> {
    const breakdown = this.calculatePayroll(
      Number(dto.grossSalary),
      dto.basicExemption ? Number(dto.basicExemption) : undefined,
    );

    // Upsert — re-running payroll for same period replaces the record
    const existing = await this.empTaxRepo.findOne({
      where: {
        orgId,
        taxYear: dto.taxYear,
        taxMonth: dto.taxMonth,
        employeeIdCode: dto.employeeIdCode,
      },
    });

    const record = existing ?? this.empTaxRepo.create({ orgId });

    Object.assign(record, {
      taxYear: dto.taxYear,
      taxMonth: dto.taxMonth,
      employeeIdCode: dto.employeeIdCode,
      employeeName: dto.employeeName,
      paymentTypeCode: dto.paymentTypeCode ?? '10',
      isBoardMember: dto.isBoardMember ?? false,
      grossSalary: breakdown.grossSalary,
      basicExemption: breakdown.basicExemption,
      incomeTaxBase: breakdown.incomeTaxBase,
      incomeTaxWithheld: breakdown.incomeTaxWithheld,
      socialTaxEmployer: breakdown.socialTaxEmployer,
      unemploymentEmployer: breakdown.unemploymentEmployer,
      unemploymentEmployee: breakdown.unemploymentEmployee,
      fundedPensionII: breakdown.fundedPensionII,
    });

    const saved = await this.empTaxRepo.save(record);

    // Recalculate period summary
    await this.recalculatePeriodTotals(orgId, dto.taxYear, dto.taxMonth);

    return saved;
  }

  async recalculatePeriodTotals(
    orgId: string,
    year: number,
    month: number,
  ): Promise<void> {
    const records = await this.empTaxRepo.find({
      where: { orgId, taxYear: year, taxMonth: month },
    });

    let period = await this.periodRepo.findOne({
      where: { orgId, year, month },
    });
    if (!period) {
      period = this.periodRepo.create({
        orgId,
        year,
        month,
        kmdStatus: TaxPeriodStatus.PENDING,
      });
    }

    const totals = records.reduce(
      (acc, r) => ({
        grossSalary: acc.grossSalary + parseFloat(r.grossSalary.toString()),
        incomeTaxWithheld:
          acc.incomeTaxWithheld + parseFloat(r.incomeTaxWithheld.toString()),
        socialTaxEmployer:
          acc.socialTaxEmployer + parseFloat(r.socialTaxEmployer.toString()),
        unemploymentEmployer:
          acc.unemploymentEmployer +
          parseFloat(r.unemploymentEmployer.toString()),
        unemploymentEmployee:
          acc.unemploymentEmployee +
          parseFloat(r.unemploymentEmployee.toString()),
        fundedPensionII:
          acc.fundedPensionII + parseFloat(r.fundedPensionII.toString()),
      }),
      {
        grossSalary: 0,
        incomeTaxWithheld: 0,
        socialTaxEmployer: 0,
        unemploymentEmployer: 0,
        unemploymentEmployee: 0,
        fundedPensionII: 0,
      },
    );

    Object.assign(period, {
      tsdGrossSalary: parseFloat(totals.grossSalary.toFixed(2)),
      tsdIncomeTaxWithheld: parseFloat(totals.incomeTaxWithheld.toFixed(2)),
      tsdSocialTax: parseFloat(totals.socialTaxEmployer.toFixed(2)),
      tsdUnemploymentEmployer: parseFloat(
        totals.unemploymentEmployer.toFixed(2),
      ),
      tsdUnemploymentEmployee: parseFloat(
        totals.unemploymentEmployee.toFixed(2),
      ),
      tsdFundedPensionII: parseFloat(totals.fundedPensionII.toFixed(2)),
      tsdStatus:
        records.length > 0 ? TaxPeriodStatus.READY : TaxPeriodStatus.PENDING,
    });

    await this.periodRepo.save(period);
  }

  async getEmployeeRecords(
    orgId: string,
    year: number,
    month: number,
  ): Promise<EstoniaEmployeeTaxRecord[]> {
    return this.empTaxRepo.find({
      where: { orgId, taxYear: year, taxMonth: month },
      order: { employeeName: 'ASC' },
    });
  }
}
