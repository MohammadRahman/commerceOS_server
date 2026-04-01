// apps/api/src/modules/bookkeeping/dto/bookkeeping.dto.ts

import {
  IsEnum,
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EntryType,
  EntryCategory,
  BusinessPersona,
  VatRegistrationStatus,
} from '../entities/bookkeeping.entities';

// ─── Tax profile setup (onboarding) ──────────────────────────────────────────

export class SetupTaxProfileDto {
  @IsEnum(BusinessPersona)
  persona: BusinessPersona;

  @IsEnum(VatRegistrationStatus)
  vatStatus: VatRegistrationStatus;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  @IsOptional()
  @IsString()
  registrationCode?: string;

  @IsOptional()
  @IsBoolean()
  autoFileEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  defaultVatRate?: number;

  @IsOptional()
  @IsBoolean()
  isSoleTraderFie?: boolean;
}

// ─── Quick income entry ───────────────────────────────────────────────────────
// The "3-tap" flow for recording daily sales. Minimal required fields.

export class AddIncomeDto {
  @IsDateString()
  date: string; // YYYY-MM-DD

  @IsNumber()
  @Min(0.01)
  grossAmount: number;

  @IsEnum(EntryCategory)
  category: EntryCategory; // SALES_CASH | SALES_CARD | SALES_ONLINE | INVOICE_PAYMENT

  @IsOptional()
  @IsString()
  description?: string; // Defaults to "Sales - {date}" if omitted

  @IsOptional()
  @IsNumber()
  vatRate?: number; // Defaults to profile defaultVatRate

  @IsOptional()
  @IsString()
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  counterpartyVatNumber?: string; // For KMD INF (B2B > €1 000)

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Quick expense entry ──────────────────────────────────────────────────────
// Used when receipt scan fails or user adds manually.

export class AddExpenseDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.01)
  grossAmount: number;

  @IsEnum(EntryCategory)
  category: EntryCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  vatRate?: number; // Input VAT rate on the purchase receipt

  @IsOptional()
  @IsString()
  counterpartyName?: string; // Supplier name

  @IsOptional()
  @IsString()
  counterpartyVatNumber?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  receiptImageUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Salary entry ─────────────────────────────────────────────────────────────
// Records a salary payment for one employee for the month.
// Tax calculations are derived server-side — user only provides gross.

export class AddSalaryDto {
  @IsDateString()
  date: string; // Date salary was paid (bank transfer date)

  @IsUUID()
  employeeId: string;

  @IsNumber()
  @Min(0)
  grossAmount: number; // Gross monthly salary

  @IsOptional()
  @IsNumber()
  basicExemption?: number; // Override if employee provided written request

  @IsOptional()
  @IsString()
  bankReferenceNumber?: string; // Bank transfer reference

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Batch daily sales (restaurant use case) ──────────────────────────────────
// Restaurant owner enters one day's totals at close of day.
// Splits by payment method automatically.

export class AddDailySalesDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashSales?: number; // Gross cash receipts

  @IsOptional()
  @IsNumber()
  @Min(0)
  cardSales?: number; // Gross card terminal receipts

  @IsOptional()
  @IsNumber()
  @Min(0)
  onlineSales?: number; // Delivery apps, online orders

  @IsOptional()
  @IsNumber()
  vatRate?: number; // If omitted: uses profile default

  @IsOptional()
  @IsString()
  notes?: string; // "Lunch crowd was good", etc.
}

// ─── Receipt scan request ─────────────────────────────────────────────────────

export class ScanReceiptDto {
  @IsString()
  imageUrl: string; // Already uploaded to S3/Cloudinary by frontend

  @IsOptional()
  @IsEnum(EntryCategory)
  expectedCategory?: EntryCategory; // Hint for the AI

  @IsOptional()
  @IsDateString()
  expectedDate?: string; // Override if OCR gets it wrong

  // If true: automatically creates a confirmed BookkeepingEntry
  // If false: returns parsed data for user to review before saving
  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;
}

// ─── Employee management ──────────────────────────────────────────────────────

export class CreateEmployeeDto {
  @IsString()
  @Length(1, 100)
  fullName: string;

  @IsOptional()
  @IsString()
  @Length(11, 11, { message: 'Estonian personal ID must be exactly 11 digits' })
  personalIdCode?: string;

  @IsOptional()
  @IsString()
  paymentTypeCode?: string;

  @IsOptional()
  @IsBoolean()
  isBoardMember?: boolean;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;
}

// ─── Period queries ───────────────────────────────────────────────────────────

export class GetPeriodDto {
  @IsInt()
  @Min(2024)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}

export class ListEntriesDto {
  @IsOptional()
  @IsInt()
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsEnum(EntryType)
  entryType?: EntryType;

  @IsOptional()
  @IsEnum(EntryCategory)
  category?: EntryCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

// ─── Month close / file taxes ─────────────────────────────────────────────────

export class CloseMonthDto {
  @IsInt()
  @Min(2024)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  // If true: calculates tax preview but does NOT submit to EMTA
  @IsOptional()
  @IsBoolean()
  previewOnly?: boolean;
}
