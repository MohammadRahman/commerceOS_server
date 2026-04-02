// apps/api/src/modules/bookkeeping/services/tax-profile.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxProfile, EmployeeRecord } from '../entities/bookkeeping.entities';
import { CreateEmployeeDto, SetupTaxProfileDto } from '../dto/bookkeeping.dto';

// 2025 payroll constants
const INCOME_TAX = 0.22;
const SOCIAL_TAX = 0.33;
const UNEMP_EMP = 0.016;
const UNEMP_EMPL = 0.008;
const PENSION_II = 0.02;
const EXEMPTION_MAX = 654;
const EXEMPTION_TAPER_LO = 1_200;
const EXEMPTION_TAPER_HI = 2_100;

function calcExemption(gross: number): number {
  if (gross <= EXEMPTION_TAPER_LO) return EXEMPTION_MAX;
  if (gross >= EXEMPTION_TAPER_HI) return 0;
  return +(
    EXEMPTION_MAX *
    (1 -
      (gross - EXEMPTION_TAPER_LO) / (EXEMPTION_TAPER_HI - EXEMPTION_TAPER_LO))
  ).toFixed(2);
}

@Injectable()
export class TaxProfileService {
  constructor(
    @InjectRepository(TaxProfile)
    private readonly profileRepo: Repository<TaxProfile>,

    @InjectRepository(EmployeeRecord)
    private readonly employeeRepo: Repository<EmployeeRecord>,
  ) {}

  async upsertProfile(
    orgId: string,
    dto: SetupTaxProfileDto,
  ): Promise<TaxProfile> {
    let profile = await this.profileRepo.findOne({ where: { orgId } });
    if (!profile) {
      profile = this.profileRepo.create({ orgId });
    }
    Object.assign(profile, {
      persona: dto.persona,
      vatStatus: dto.vatStatus,
      vatNumber: dto.vatNumber,
      registrationCode: dto.registrationCode,
      autoFileEnabled: dto.autoFileEnabled ?? false,
      defaultVatRate: dto.defaultVatRate ?? 24,
      isSoleTraderFie: dto.isSoleTraderFie ?? false,
      paysAdvanceIncomeTax: dto.isSoleTraderFie ?? false,
    });
    return this.profileRepo.save(profile);
  }

  async getProfile(orgId: string): Promise<TaxProfile | null> {
    return this.profileRepo.findOne({ where: { orgId } });
  }

  // ─── Employee management ─────────────────────────────────────────────────

  async createEmployee(
    orgId: string,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeRecord> {
    const employee = this.employeeRepo.create({
      orgId,
      fullName: dto.fullName,
      personalIdCode: dto.personalIdCode,
      paymentTypeCode: dto.paymentTypeCode ?? '10',
      isBoardMember: dto.isBoardMember ?? false,
      email: dto.email,
      bankAccount: dto.bankAccount,
      isActive: true,
    });
    return this.employeeRepo.save(employee);
  }

  async listEmployees(orgId: string): Promise<EmployeeRecord[]> {
    return this.employeeRepo.find({
      where: { orgId, isActive: true },
      order: { fullName: 'ASC' },
    });
  }

  async deactivateEmployee(id: string, orgId: string): Promise<void> {
    const employee = await this.employeeRepo.findOne({
      where: { id, orgId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    employee.isActive = false;
    await this.employeeRepo.save(employee);
  }

  // ─── Payroll preview (pure calculation, no DB write) ─────────────────────
  // Called by the UI "salary preview" before the owner pays.

  previewPayroll(gross: number, overrideExemption?: number) {
    const exemption = overrideExemption ?? calcExemption(gross);
    const pensionII = +(gross * PENSION_II).toFixed(2);
    const unempEmp = +(gross * UNEMP_EMP).toFixed(2);
    const itBase = Math.max(0, +(gross - exemption - pensionII).toFixed(2));
    const incomeTax = +(itBase * INCOME_TAX).toFixed(2);
    const socialTax = +(gross * SOCIAL_TAX).toFixed(2);
    const unempEmpl = +(gross * UNEMP_EMPL).toFixed(2);
    const netSalary = +(gross - incomeTax - unempEmp - pensionII).toFixed(2);
    const employerCost = +(gross + socialTax + unempEmpl).toFixed(2);

    return {
      grossSalary: gross,
      basicExemption: exemption,
      fundedPensionII: pensionII,
      incomeTaxBase: itBase,
      incomeTaxWithheld: incomeTax,
      unemploymentEmp: unempEmp,
      unemploymentEmpl: unempEmpl,
      socialTax: socialTax,
      netSalary: netSalary,
      totalEmployerCost: employerCost,
      // Helpful summary
      employeeReceives: netSalary,
      totalTaxBurden: +(
        incomeTax +
        unempEmp +
        pensionII +
        socialTax +
        unempEmpl
      ).toFixed(2),
      taxAsPercentOfCost:
        employerCost > 0
          ? +((1 - netSalary / employerCost) * 100).toFixed(1)
          : 0,
    };
  }
}
