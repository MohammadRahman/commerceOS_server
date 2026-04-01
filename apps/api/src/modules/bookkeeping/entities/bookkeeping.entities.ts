// apps/api/src/modules/bookkeeping/entities/bookkeeping.entities.ts
//
// Unified bookkeeping layer — every peso/cent that flows through the business
// lands here, regardless of persona (restaurant, ecommerce, freelancer).
// The tax engine at month-end reads exclusively from these tables.

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrganizationEntity } from '../../tenancy/entities/organization.entity';
import { AbstractEntity } from '@app/common';

// ─── TaxProfile ───────────────────────────────────────────────────────────────
// Set once during onboarding. Controls which taxes apply, which EMTA forms
// are filed, and which UI flows the user sees.

export enum BusinessPersona {
  RESTAURANT = 'RESTAURANT', // Daily sales + supplier costs + staff
  ECOMMERCE = 'ECOMMERCE', // Orders auto-sync from commerce-os
  FREELANCER_FIE = 'FREELANCER_FIE', // Sole trader — FIE in Estonia
  COMPANY_OU = 'COMPANY_OU', // OÜ — corporate, CIT on distribution
}

export enum VatRegistrationStatus {
  NOT_REGISTERED = 'NOT_REGISTERED', // Turnover < €40k
  REGISTERED = 'REGISTERED',
  VOLUNTARY = 'VOLUNTARY', // Registered below threshold voluntarily
}

@Entity('bookkeeping_tax_profiles')
export class TaxProfile extends AbstractEntity<TaxProfile> {
  @Column('uuid', { unique: true })
  'orgId': string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: '"org_id"' })
  organization: OrganizationEntity;

  @Column({ type: 'enum', enum: BusinessPersona })
  persona: BusinessPersona;

  @Column({
    type: 'enum',
    enum: VatRegistrationStatus,
    default: VatRegistrationStatus.NOT_REGISTERED,
  })
  vatStatus: VatRegistrationStatus;

  @Column({ nullable: true })
  vatNumber: string; // EE + 9 digits

  @Column({ nullable: true })
  registrationCode: string; // Estonian business registry code

  // EMTA e-MTA API token — stored encrypted in production
  @Column({ nullable: true, select: false })
  emtaApiToken: string;

  // Whether the platform auto-files when the period closes (1st of month)
  @Column({ default: false })
  autoFileEnabled: boolean;

  // Default VAT rate for quick-entry (can be overridden per transaction)
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 24 })
  defaultVatRate: number;

  // FIE-specific: whether they pay social tax themselves (33% on income)
  @Column({ default: false })
  isSoleTraderFie: boolean;

  // Advance income tax — FIEs pay quarterly, OÜs on distribution
  @Column({ default: false })
  paysAdvanceIncomeTax: boolean;
}

// ─── BookkeepingEntry ─────────────────────────────────────────────────────────
// The single source of truth for all financial activity.
// One row = one real-world money event (sale, purchase, salary, etc.)

export enum EntryType {
  INCOME = 'INCOME', // Money in: sales, client payments, invoices
  EXPENSE = 'EXPENSE', // Money out: suppliers, rent, subscriptions
  SALARY = 'SALARY', // Staff wages — drives TSD calculation
  TRANSFER = 'TRANSFER', // Internal movement (not taxable)
}

export enum EntryCategory {
  // Income categories
  SALES_CASH = 'SALES_CASH',
  SALES_CARD = 'SALES_CARD',
  SALES_ONLINE = 'SALES_ONLINE',
  INVOICE_PAYMENT = 'INVOICE_PAYMENT',
  OTHER_INCOME = 'OTHER_INCOME',

  // Expense categories
  SUPPLIER_FOOD = 'SUPPLIER_FOOD', // Restaurant: meat, veg, groceries
  SUPPLIER_GOODS = 'SUPPLIER_GOODS', // Ecommerce: products, packaging
  RENT = 'RENT',
  UTILITIES = 'UTILITIES',
  EQUIPMENT = 'EQUIPMENT',
  MARKETING = 'MARKETING',
  SOFTWARE = 'SOFTWARE',
  TRANSPORT = 'TRANSPORT',
  OTHER_EXPENSE = 'OTHER_EXPENSE',

  // Salary categories
  STAFF_SALARY = 'STAFF_SALARY',
  OWNER_SALARY = 'OWNER_SALARY', // FIE owner drawing
  BOARD_FEE = 'BOARD_FEE', // OÜ management board fee

  // Transfer
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export enum EntryStatus {
  DRAFT = 'DRAFT', // Entered but not confirmed
  CONFIRMED = 'CONFIRMED', // Ready to include in tax period
  EXCLUDED = 'EXCLUDED', // User explicitly excluded from tax calc
}

export enum SourceType {
  MANUAL = 'MANUAL', // User typed it in
  RECEIPT_SCAN = 'RECEIPT_SCAN', // OCR from photo
  ORDER_SYNC = 'ORDER_SYNC', // Auto-created from commerce-os order
  INVOICE_SYNC = 'INVOICE_SYNC', // Auto-created from invoice module
  BANK_IMPORT = 'BANK_IMPORT', // Imported from bank CSV
}

@Entity('bookkeeping_entries')
@Index('IDX_entries_org_period', ['orgId', 'taxYear', 'taxMonth'])
@Index('IDX_entries_org_type_date', ['orgId', 'entryType', 'date'])
export class BookkeepingEntry extends AbstractEntity<BookkeepingEntry> {
  @Column('uuid')
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  // ── When ──────────────────────────────────────────────────────────────────
  @Column({ type: 'date' })
  date: Date; // The real-world date of the transaction

  @Column('int')
  taxYear: number;

  @Column('int')
  taxMonth: number; // 1-12

  // ── What ──────────────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: EntryType })
  entryType: EntryType;

  @Column({ type: 'enum', enum: EntryCategory })
  category: EntryCategory;

  @Column({ length: 255 })
  description: string;

  // ── Money ─────────────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  grossAmount: number; // What the receipt/invoice says (incl. VAT if applicable)

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  vatRate: number; // 0, 9, 13, or 24

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  vatAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  netAmount: number; // grossAmount - vatAmount

  // ── Source & proof ────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: SourceType, default: SourceType.MANUAL })
  sourceType: SourceType;

  @Column({ nullable: true })
  sourceId: string; // orderId, invoiceId, etc.

  @Column({ nullable: true })
  receiptImageUrl: string; // S3/Cloudinary URL of uploaded receipt

  @Column({ type: 'jsonb', nullable: true })
  receiptParsedData: ReceiptParsedData | null; // What OCR extracted

  @Column({ nullable: true })
  invoiceNumber: string;

  @Column({ nullable: true })
  counterpartyName: string; // Supplier/customer name

  @Column({ nullable: true })
  counterpartyVatNumber: string; // For KMD INF

  // ── State ─────────────────────────────────────────────────────────────────
  @Column({ type: 'enum', enum: EntryStatus, default: EntryStatus.CONFIRMED })
  status: EntryStatus;

  @Column({ nullable: true })
  notes: string;

  @Column({ nullable: true })
  createdByUserId: string;
}

// Shape of OCR-extracted receipt data
export interface ReceiptParsedData {
  merchantName?: string;
  merchantVatNumber?: string;
  receiptDate?: string; // YYYY-MM-DD
  totalAmount?: number;
  vatAmount?: number;
  vatRate?: number;
  lineItems?: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    total: number;
  }>;
  currency?: string;
  confidence: number; // 0-1, how confident the OCR was
  rawText?: string; // Full extracted text for audit
}

// ─── MonthlyTaxPeriod ─────────────────────────────────────────────────────────
// Aggregated summary per organization per month.
// Created on the 1st, populated in real-time as entries are added,
// locked when tax is filed.

export enum PeriodStatus {
  OPEN = 'OPEN', // Accepting entries
  CALCULATING = 'CALCULATING', // Month-end calc in progress
  REVIEW = 'REVIEW', // Ready for owner to review
  FILED = 'FILED', // Submitted to EMTA
  LOCKED = 'LOCKED', // Accepted by EMTA, no more changes
}

@Entity('bookkeeping_monthly_periods')
@Index(['"org_id"', 'year', 'month'], { unique: true })
export class MonthlyTaxPeriod extends AbstractEntity<MonthlyTaxPeriod> {
  @Column('uuid')
  'orgId': string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: '"org_id"' })
  organization: OrganizationEntity;

  @Column('int')
  year: number;

  @Column('int')
  month: number;

  @Column({ type: 'enum', enum: PeriodStatus, default: PeriodStatus.OPEN })
  status: PeriodStatus;

  // ── Income summary ────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalIncomeGross: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalIncomeNet: number;

  // ── Expense summary ───────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalExpenseGross: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalExpenseNet: number;

  // ── Payroll summary ───────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalGrossSalary: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalIncomeTaxWithheld: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalSocialTax: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalEmployerCost: number;

  // ── VAT summary ───────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  vatOutputTotal: number; // VAT collected on sales

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  vatInputTotal: number; // VAT paid on purchases (deductible)

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  vatPayable: number; // outputTotal - inputTotal

  // ── Tax obligations ───────────────────────────────────────────────────────
  // Populated by month-end calculator, shown to user for review

  @Column({ type: 'jsonb', nullable: true })
  taxBreakdown: TaxBreakdown | null;

  // EMTA submission IDs once filed
  @Column({ nullable: true })
  kmdSubmissionId: string;

  @Column({ nullable: true })
  tsdSubmissionId: string;

  @Column({ nullable: true })
  filedAt: Date;

  @Column({ nullable: true })
  filedByUserId: string;
}

export interface TaxBreakdown {
  persona: BusinessPersona;

  // What the business owes this month
  vatPayable: number;
  incomeTaxPayable: number; // 0 for OÜ unless distributing profit
  socialTaxPayable: number; // FIE: on own income; employer: on staff salary
  unemploymentTax: number;

  // Helpful context numbers
  netProfit: number; // income - expenses - salaries
  effectiveTaxRate: number; // totalTax / grossIncome

  // Deadline reminders
  tsdDeadline: string; // YYYY-MM-DD
  kmdDeadline: string;

  // Per-rate VAT breakdown for KMD form
  vatByRate: Array<{
    rate: number;
    taxableSales: number;
    outputVat: number;
    deductibleInput: number;
  }>;
}

// ─── EmployeeRecord ───────────────────────────────────────────────────────────
// Minimal employee master — just enough for TSD.
// Linked to BookkeepingEntry (type=SALARY) for the actual monthly amounts.

@Entity('bookkeeping_employees')
@Index(['"orgId"', 'isActive'])
export class EmployeeRecord extends AbstractEntity<EmployeeRecord> {
  @Column('uuid')
  'orgId': string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: '"org_id"' })
  organization: OrganizationEntity;

  @Column()
  fullName: string;

  // Estonian personal ID code (isikukood) — 11 digits
  // Required for TSD Annex 1
  @Column({ nullable: true })
  personalIdCode: string;

  @Column({ default: '10' }) // EMTA payment type: 10 = regular salary
  paymentTypeCode: string;

  @Column({ default: false })
  isBoardMember: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  bankAccount: string; // IBAN — for salary payment reference
}
