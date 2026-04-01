// apps/api/src/modules/estonia-tax/entities/estonia-tax.entities.ts
// Four core entities covering VAT, payroll, submissions, and audit trail.

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

// ─── TaxPeriod ────────────────────────────────────────────────────────────────
// One record per organization per month. Tracks whether KMD and TSD have
// been filed. Created automatically by the scheduler at month-start.

export enum TaxPeriodStatus {
  PENDING = 'PENDING',
  READY = 'READY', // Enough data to generate declarations
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED', // EMTA confirmed receipt
  REJECTED = 'REJECTED',
}

export enum TaxFormType {
  KMD = 'KMD', // VAT return
  TSD = 'TSD', // Income & social tax return
}

@Entity('estonia_tax_periods')
@Index(['orgId', 'year', 'month'], { unique: true })
export class EstoniaTaxPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column('int')
  year: number;

  @Column('int')
  month: number; // 1-12

  // VAT (KMD) state
  @Column({
    type: 'enum',
    enum: TaxPeriodStatus,
    default: TaxPeriodStatus.PENDING,
  })
  kmdStatus: TaxPeriodStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  kmdTaxableSales: number; // Total taxable turnover

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  kmdOutputVat: number; // VAT collected from customers

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  kmdInputVat: number; // VAT paid on purchases (deductible)

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  kmdVatPayable: number; // outputVat - inputVat

  // Payroll (TSD) state
  @Column({
    type: 'enum',
    enum: TaxPeriodStatus,
    default: TaxPeriodStatus.PENDING,
  })
  tsdStatus: TaxPeriodStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdGrossSalary: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdIncomeTaxWithheld: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdSocialTax: number; // Employer pays 33%

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdUnemploymentEmployer: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdUnemploymentEmployee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tsdFundedPensionII: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// ─── VatTransaction ───────────────────────────────────────────────────────────
// One row per invoice/transaction that affects VAT.
// Aggregated into KMD and KMD INF at filing time.

export enum VatTransactionType {
  SALE = 'SALE',
  PURCHASE = 'PURCHASE',
  INTRA_EU_SUPPLY = 'INTRA_EU_SUPPLY',
  INTRA_EU_ACQUISITION = 'INTRA_EU_ACQUISITION',
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
  REVERSE_CHARGE = 'REVERSE_CHARGE',
}

@Entity('estonia_vat_transactions')
@Index(['orgId', 'taxYear', 'taxMonth'])
export class EstoniaVatTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column('int')
  taxYear: number;

  @Column('int')
  taxMonth: number;

  // Link back to the originating commerce-os document
  @Column({ nullable: true })
  sourceOrderId: string;

  @Column({ nullable: true })
  sourcePaymentId: string;

  @Column({ nullable: true })
  invoiceNumber: string;

  @Column({ nullable: true })
  counterpartyVatNumber: string; // For KMD INF (transactions > €1 000 with Estonian companies)

  @Column({ nullable: true })
  counterpartyName: string;

  @Column({ type: 'enum', enum: VatTransactionType })
  transactionType: VatTransactionType;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  vatRate: number; // 0, 9, 13, 24

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  netAmount: number; // Excluding VAT

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  vatAmount: number; // VAT portion

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  grossAmount: number; // Including VAT

  @Column({ type: 'date' })
  transactionDate: Date;

  @CreateDateColumn()
  createdAt: Date;
}

// ─── EmployeeTaxRecord ────────────────────────────────────────────────────────
// Monthly payroll record per employee. Used to build TSD Annex 1.

@Entity('estonia_employee_tax_records')
@Index(['orgId', 'taxYear', 'taxMonth', 'employeeIdCode'], {
  unique: true,
})
export class EstoniaEmployeeTaxRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column('int')
  taxYear: number;

  @Column('int')
  taxMonth: number;

  // Estonian personal ID code (isikukood) — 11 digits
  @Column()
  employeeIdCode: string;

  @Column()
  employeeName: string;

  // Payment type codes per EMTA TSD Annex 1 table
  // 10 = regular salary, 11 = vacation pay, 20 = management board fee, etc.
  @Column({ default: '10' })
  paymentTypeCode: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  grossSalary: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  basicExemption: number; // Individual monthly basic exemption applied

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  incomeTaxBase: number; // grossSalary - basicExemption - pension II

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  incomeTaxWithheld: number; // 22% of incomeTaxBase

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  socialTaxEmployer: number; // 33% of gross — employer cost

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unemploymentEmployer: number; // 0.8% employer

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unemploymentEmployee: number; // 1.6% withheld

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  fundedPensionII: number; // 2% employee contribution

  @Column({ type: 'boolean', default: false })
  isBoardMember: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// ─── TaxSubmission ────────────────────────────────────────────────────────────
// Immutable record of every XML submission sent to EMTA. Never update;
// create a new row for each attempt/amendment. This is the audit trail.

export enum SubmissionStatus {
  DRAFT = 'DRAFT',
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  AMENDED = 'AMENDED',
}

@Entity('estonia_tax_submissions')
@Index(['orgId', 'formType', 'taxYear', 'taxMonth'])
export class EstoniaTaxSubmission extends AbstractEntity<EstoniaTaxSubmission> {
  @Column('uuid')
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column({ type: 'enum', enum: TaxFormType })
  formType: TaxFormType;

  @Column('int')
  taxYear: number;

  @Column('int')
  taxMonth: number;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.DRAFT,
  })
  status: SubmissionStatus;

  // The exact XML payload sent (or to be sent) to EMTA
  @Column({ type: 'text' })
  xmlPayload: string;

  // Reference number returned by EMTA on acceptance
  @Column({ nullable: true })
  emtaReferenceNumber: string;

  // Raw EMTA response for debugging
  @Column({ type: 'text', nullable: true })
  emtaResponse: string;

  // Human who triggered a manual submission (null = scheduler)
  @Column({ nullable: true })
  submittedByUserId: string;

  @Column({ nullable: true })
  submittedAt: Date;

  @Column({ nullable: true })
  rejectionReason: string;

  // Links to previous submission if this is an amendment
  @Column({ nullable: true })
  amendsSubmissionId: string;
}
