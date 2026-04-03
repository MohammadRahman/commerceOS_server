// apps/api/src/modules/bookkeeping/services/supplier.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Supplier, SupplierSource } from '../entities/supplier.entity';
import { AutomationSourceType } from '../entities/automation-log.entity';

export interface SupplierIdentity {
  name: string;
  registrationNumber?: string;
  vatNumber?: string;
  email?: string;
  iban?: string;
}

// Map AutomationSourceType → SupplierSource so the bank/email/open-banking
// pipelines can pass their source type without knowing the Supplier enum.
const SOURCE_MAP: Record<AutomationSourceType, SupplierSource> = {
  email_invoice: SupplierSource.EMAIL_PARSER,
  email_daily_report: SupplierSource.EMAIL_PARSER,
  bank_statement_pdf: SupplierSource.BANK_STATEMENT,
  open_banking: SupplierSource.OPEN_BANKING,
};

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);

  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
  ) {}

  /**
   * Finds an existing supplier by registration number, VAT, IBAN, email, or
   * fuzzy name match. Creates a new one if nothing matches.
   * Returns { supplier, created }.
   */
  async findOrCreate(
    organizationId: string,
    identity: SupplierIdentity,
    source: AutomationSourceType,
  ): Promise<{ supplier: Supplier; created: boolean }> {
    // 1. Exact match on registration number
    if (identity.registrationNumber) {
      const found = await this.supplierRepo.findOne({
        where: {
          orgId: organizationId,
          registrationNumber: identity.registrationNumber,
        },
      });
      if (found) return { supplier: found, created: false };
    }

    // 2. Exact match on VAT number
    if (identity.vatNumber) {
      const found = await this.supplierRepo.findOne({
        where: { orgId: organizationId, vatNumber: identity.vatNumber },
      });
      if (found) return { supplier: found, created: false };
    }

    // 3. Exact match on IBAN
    if (identity.iban) {
      const found = await this.supplierRepo.findOne({
        where: { orgId: organizationId, iban: identity.iban },
      });
      if (found) return { supplier: found, created: false };
    }

    // 4. Exact match on email
    if (identity.email) {
      const found = await this.supplierRepo.findOne({
        where: { orgId: organizationId, email: identity.email },
      });
      if (found) return { supplier: found, created: false };
    }

    // 5. Fuzzy name match — normalise and check name + aliases
    if (identity.name) {
      const normalised = this.normaliseName(identity.name);
      const candidates = await this.supplierRepo.find({
        where: { orgId: organizationId, isActive: true },
        select: ['id', 'name', 'aliases'],
      });
      for (const c of candidates) {
        if (this.normaliseName(c.name) === normalised) {
          return { supplier: c, created: false };
        }
        // aliases is now a jsonb string[] — safe to iterate directly
        if (c.aliases?.some((a) => this.normaliseName(a) === normalised)) {
          return { supplier: c, created: false };
        }
      }
    }

    // 6. Nothing matched — create
    this.logger.log(
      `[Supplier] Creating "${identity.name}" for org=${organizationId} via ${source}`,
    );

    // Seed the aliases array with the email domain if available —
    // helps future bank-statement matching for the same company.
    const initialAliases: string[] = identity.email
      ? [identity.email.split('@')[1]]
      : [];

    const supplier = this.supplierRepo.create({
      orgId: organizationId,
      name: identity.name,
      registrationNumber: identity.registrationNumber ?? null,
      vatNumber: identity.vatNumber ?? null,
      email: identity.email ?? null,
      iban: identity.iban ?? null,
      // FIX: map AutomationSourceType → SupplierSource enum
      source: SOURCE_MAP[source] ?? SupplierSource.MANUAL,
      // FIX: always an array, never null (jsonb column default is '[]')
      aliases: initialAliases,
    } as Partial<Supplier>);

    const saved = await this.supplierRepo.save(supplier);
    return { supplier: saved, created: true };
  }

  async findAll(organizationId: string): Promise<Supplier[]> {
    return this.supplierRepo.find({
      where: { orgId: organizationId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async search(organizationId: string, q: string): Promise<Supplier[]> {
    return this.supplierRepo.find({
      where: [
        { orgId: organizationId, name: ILike(`%${q}%`) },
        { orgId: organizationId, email: ILike(`%${q}%`) },
      ],
      take: 10,
    });
  }

  /** Add an alias keyword to help future fuzzy matching */
  async addAlias(supplierId: string, alias: string): Promise<void> {
    const s = await this.supplierRepo.findOneOrFail({
      where: { id: supplierId },
    });
    const existing = s.aliases ?? [];
    if (!existing.includes(alias)) {
      await this.supplierRepo.update(supplierId, {
        aliases: [...existing, alias],
      });
    }
  }

  private normaliseName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(oü|as|llc|ltd|gmbh|inc|oy|ab)\b/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
