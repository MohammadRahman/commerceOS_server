// apps/api/src/modules/estonia-tax/dto/estonia-tax.dto.ts

import {
  IsInt,
  IsEnum,
  IsString,
  IsOptional,
  IsDecimal,
  IsDateString,
  Min,
  Max,
  Length,
  IsBoolean,
} from 'class-validator';
import { VatTransactionType } from '../entities/estonia-tax.entities';

// ─── Record a VAT transaction ─────────────────────────────────────────────────
export class RecordVatTransactionDto {
  @IsInt()
  @Min(2024)
  taxYear: number;

  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth: number;

  @IsEnum(VatTransactionType)
  transactionType: VatTransactionType;

  @IsDecimal()
  vatRate: number; // 0 | 9 | 13 | 24

  @IsDecimal()
  netAmount: number;

  @IsDecimal()
  vatAmount: number;

  @IsDecimal()
  grossAmount: number;

  @IsDateString()
  transactionDate: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  counterpartyVatNumber?: string; // Required for KMD INF if > €1 000

  @IsOptional()
  @IsString()
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  sourceOrderId?: string;

  @IsOptional()
  @IsString()
  sourcePaymentId?: string;
}

// ─── Record employee payroll for TSD ─────────────────────────────────────────
export class RecordEmployeeTaxDto {
  @IsInt()
  @Min(2024)
  taxYear: number;

  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth: number;

  @IsString()
  @Length(11, 11, { message: 'Estonian personal ID code must be 11 digits' })
  employeeIdCode: string;

  @IsString()
  employeeName: string;

  @IsDecimal()
  grossSalary: number;

  @IsDecimal()
  @IsOptional()
  basicExemption?: number; // Defaults to current monthly basic exemption

  @IsOptional()
  @IsString()
  paymentTypeCode?: string; // Defaults to '10' (regular salary)

  @IsOptional()
  @IsBoolean()
  isBoardMember?: boolean;
}

// ─── Manual trigger filing ────────────────────────────────────────────────────
export class TriggerFilingDto {
  @IsInt()
  @Min(2024)
  taxYear: number;

  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean; // Generate XML but don't send to EMTA
}

// ─── Query submissions ────────────────────────────────────────────────────────
export class TaxSubmissionQueryDto {
  @IsOptional()
  @IsInt()
  @Min(2024)
  taxYear?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  taxMonth?: number;

  @IsOptional()
  @IsString()
  formType?: 'KMD' | 'TSD';
}
