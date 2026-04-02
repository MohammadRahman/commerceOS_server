// apps/api/src/modules/bookkeeping/dto/bookkeeping.dto.ts
// ADDITIONS:
//   AddIncomeDto:      + excludeFromVat
//   AddDailySalesDto:  + thirdPartySales[], + excludeCashFromVat
//   AddThirdPartyPayoutDto: NEW — dedicated DTO for platform payouts

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
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EntryType,
  EntryCategory,
  BusinessPersona,
  VatRegistrationStatus,
  SalaryType,
  ThirdPartyPlatform,
} from '../entities/bookkeeping.entities';

// ─── Tax profile setup ────────────────────────────────────────────────────────

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

// ─── Income ───────────────────────────────────────────────────────────────────

export class AddIncomeDto {
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
  vatRate?: number;

  // NEW: set true to include in income totals but exclude from KMD VAT output.
  // For businesses below the VAT threshold or explicitly non-VAT sales.
  @IsOptional()
  @IsBoolean()
  excludeFromVat?: boolean;

  @IsOptional()
  @IsString()
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  counterpartyVatNumber?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Third party platform payout ──────────────────────────────────────────────
// Models the ~2-weekly bank payout from Wolt / Bolt Food etc.
//
// Estonian tax treatment:
//   1. Gross order value → SALES_THIRD_PARTY income (taxable, VAT applies)
//   2. Platform commission → PLATFORM_COMMISSION expense (deductible, 0% VAT
//      because it's a reverse-charge B2B service from a foreign company)
//
// The user can either:
//   a) Enter the bank payout and let the system calculate gross + commission
//   b) Enter the gross order value directly if they have the platform report

export class AddThirdPartyPayoutDto {
  @IsDateString()
  date: string; // Date the payout hit the bank

  @IsEnum(ThirdPartyPlatform)
  platform: ThirdPartyPlatform;

  // The actual amount received in the bank (net of commission)
  // Provide either payoutAmount OR grossOrderValue — not both.
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  payoutAmount?: number;

  // Gross order value from the platform's settlement report (more accurate)
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  grossOrderValue?: number;

  // Commission rate override (e.g. 0.28 for 28%)
  // If omitted, uses the platform default from PLATFORM_COMMISSION_RATES.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number;

  @IsOptional()
  @IsNumber()
  vatRate?: number; // Default: org's defaultVatRate

  @IsOptional()
  @IsString()
  periodLabel?: string; // e.g. "1-15 Apr 2025" — for the entry description

  @IsOptional()
  @IsString()
  settlementReference?: string; // Wolt/Bolt settlement ID

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Expense ──────────────────────────────────────────────────────────────────

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
  vatRate?: number;

  @IsOptional()
  @IsString()
  counterpartyName?: string;

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

export class UploadExpenseProofDto {
  @IsUUID()
  entryId: string;
}

// ─── Salary ───────────────────────────────────────────────────────────────────

export class AddSalaryDto {
  @IsDateString()
  date: string;

  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hoursWorked?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hourlyRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basicExemption?: number;

  @IsOptional()
  @IsString()
  bankReferenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Daily sales ──────────────────────────────────────────────────────────────

export class ThirdPartySaleItemDto {
  @IsEnum(ThirdPartyPlatform)
  platform: ThirdPartyPlatform;

  // Gross order value for this platform (before commission)
  @IsNumber()
  @Min(0.01)
  grossAmount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  commissionRate?: number; // override if different from default
}

export class AddDailySalesDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashSales?: number;

  // NEW: exclude cash sales from VAT calculation
  // For businesses below threshold or explicitly non-VAT cash transactions
  @IsOptional()
  @IsBoolean()
  excludeCashFromVat?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cardSales?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  onlineSales?: number; // Own website / webshop

  // NEW: Third party platform sales (Wolt, Bolt, etc.)
  // These create two entries: gross income + commission expense
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThirdPartySaleItemDto)
  thirdPartySales?: ThirdPartySaleItemDto[];

  @IsOptional()
  @IsNumber()
  vatRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ─── Receipt scan ─────────────────────────────────────────────────────────────

export class ScanReceiptDto {
  @IsString()
  imageUrl: string;

  @IsOptional()
  @IsEnum(EntryCategory)
  expectedCategory?: EntryCategory;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

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

  @IsOptional()
  @IsEnum(SalaryType)
  salaryType?: SalaryType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hourlyRate?: number;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(11, 11, { message: 'Estonian personal ID must be exactly 11 digits' })
  personalIdCode?: string;

  @IsOptional()
  @IsEnum(SalaryType)
  salaryType?: SalaryType;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hourlyRate?: number;

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

export class CloseMonthDto {
  @IsInt()
  @Min(2024)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsOptional()
  @IsBoolean()
  previewOnly?: boolean;
}
// // apps/api/src/modules/bookkeeping/dto/bookkeeping.dto.ts
// // ADDITIONS vs previous version:
// //   CreateEmployeeDto: + salaryType, + hourlyRate
// //   AddSalaryDto:      + salaryType, + hoursWorked, + hourlyRate (override)
// //   New:               UploadExpenseProofDto

// import {
//   IsEnum,
//   IsString,
//   IsNumber,
//   IsOptional,
//   IsDateString,
//   IsBoolean,
//   IsInt,
//   Min,
//   Max,
//   IsUUID,
//   Length,
// } from 'class-validator';
// import {
//   EntryType,
//   EntryCategory,
//   BusinessPersona,
//   VatRegistrationStatus,
//   SalaryType,
// } from '../entities/bookkeeping.entities';

// // ─── Tax profile setup ────────────────────────────────────────────────────────

// export class SetupTaxProfileDto {
//   @IsEnum(BusinessPersona)
//   persona: BusinessPersona;

//   @IsEnum(VatRegistrationStatus)
//   vatStatus: VatRegistrationStatus;

//   @IsOptional()
//   @IsString()
//   vatNumber?: string;

//   @IsOptional()
//   @IsString()
//   registrationCode?: string;

//   @IsOptional()
//   @IsBoolean()
//   autoFileEnabled?: boolean;

//   @IsOptional()
//   @IsNumber()
//   defaultVatRate?: number;

//   @IsOptional()
//   @IsBoolean()
//   isSoleTraderFie?: boolean;
// }

// // ─── Income ───────────────────────────────────────────────────────────────────

// export class AddIncomeDto {
//   @IsDateString()
//   date: string;

//   @IsNumber()
//   @Min(0.01)
//   grossAmount: number;

//   @IsEnum(EntryCategory)
//   category: EntryCategory;

//   @IsOptional()
//   @IsString()
//   description?: string;

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number;

//   @IsOptional()
//   @IsString()
//   counterpartyName?: string;

//   @IsOptional()
//   @IsString()
//   counterpartyVatNumber?: string;

//   @IsOptional()
//   @IsString()
//   invoiceNumber?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Expense ──────────────────────────────────────────────────────────────────

// export class AddExpenseDto {
//   @IsDateString()
//   date: string;

//   @IsNumber()
//   @Min(0.01)
//   grossAmount: number;

//   @IsEnum(EntryCategory)
//   category: EntryCategory;

//   @IsOptional()
//   @IsString()
//   description?: string;

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number;

//   @IsOptional()
//   @IsString()
//   counterpartyName?: string;

//   @IsOptional()
//   @IsString()
//   counterpartyVatNumber?: string;

//   @IsOptional()
//   @IsString()
//   invoiceNumber?: string;

//   @IsOptional()
//   @IsString()
//   receiptImageUrl?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Expense proof upload ─────────────────────────────────────────────────────
// // Attaches an image to an existing BookkeepingEntry.
// // The file arrives as multipart/form-data — handled in the controller.

// export class UploadExpenseProofDto {
//   @IsUUID()
//   entryId: string;
// }

// // ─── Salary ───────────────────────────────────────────────────────────────────

// export class AddSalaryDto {
//   @IsDateString()
//   date: string; // Date salary was paid

//   @IsUUID()
//   employeeId: string;

//   // ── FIXED salary ──────────────────────────────────────────────────────────
//   // For salaryType = FIXED: provide grossAmount directly.
//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   grossAmount?: number;

//   // ── HOURLY salary ─────────────────────────────────────────────────────────
//   // For salaryType = HOURLY: provide hoursWorked.
//   // hourlyRate is optional — if omitted, uses employee.hourlyRate from DB.
//   @IsOptional()
//   @IsNumber()
//   @Min(0.01)
//   hoursWorked?: number;

//   @IsOptional()
//   @IsNumber()
//   @Min(0.01)
//   hourlyRate?: number; // Override the employee's default rate for this month

//   // ── Common ────────────────────────────────────────────────────────────────
//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   basicExemption?: number;

//   @IsOptional()
//   @IsString()
//   bankReferenceNumber?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Daily sales (restaurant) ─────────────────────────────────────────────────

// export class AddDailySalesDto {
//   @IsDateString()
//   date: string;

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   cashSales?: number;

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   cardSales?: number;

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   onlineSales?: number;

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Receipt scan ─────────────────────────────────────────────────────────────

// export class ScanReceiptDto {
//   @IsString()
//   imageUrl: string;

//   @IsOptional()
//   @IsEnum(EntryCategory)
//   expectedCategory?: EntryCategory;

//   @IsOptional()
//   @IsDateString()
//   expectedDate?: string;

//   @IsOptional()
//   @IsBoolean()
//   autoConfirm?: boolean;
// }

// // ─── Employee management ──────────────────────────────────────────────────────

// export class CreateEmployeeDto {
//   @IsString()
//   @Length(1, 100)
//   fullName: string;

//   @IsOptional()
//   @IsString()
//   @Length(11, 11, { message: 'Estonian personal ID must be exactly 11 digits' })
//   personalIdCode?: string;

//   @IsOptional()
//   @IsString()
//   paymentTypeCode?: string;

//   @IsOptional()
//   @IsBoolean()
//   isBoardMember?: boolean;

//   @IsOptional()
//   @IsString()
//   email?: string;

//   @IsOptional()
//   @IsString()
//   bankAccount?: string;

//   // ── NEW ───────────────────────────────────────────────────────────────────
//   @IsOptional()
//   @IsEnum(SalaryType)
//   salaryType?: SalaryType;

//   // Required when salaryType = HOURLY; stored as the employee's default rate.
//   @IsOptional()
//   @IsNumber()
//   @Min(0.01)
//   hourlyRate?: number;
// }

// export class UpdateEmployeeDto {
//   @IsOptional()
//   @IsString()
//   @Length(1, 100)
//   fullName?: string;

//   @IsOptional()
//   @IsString()
//   @Length(11, 11, { message: 'Estonian personal ID must be exactly 11 digits' })
//   personalIdCode?: string;

//   @IsOptional()
//   @IsEnum(SalaryType)
//   salaryType?: SalaryType;

//   @IsOptional()
//   @IsNumber()
//   @Min(0.01)
//   hourlyRate?: number;

//   @IsOptional()
//   @IsBoolean()
//   isBoardMember?: boolean;

//   @IsOptional()
//   @IsString()
//   email?: string;

//   @IsOptional()
//   @IsString()
//   bankAccount?: string;
// }

// // ─── Period queries ───────────────────────────────────────────────────────────

// export class GetPeriodDto {
//   @IsInt()
//   @Min(2024)
//   year: number;

//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month: number;
// }

// export class ListEntriesDto {
//   @IsOptional()
//   @IsInt()
//   year?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month?: number;

//   @IsOptional()
//   @IsEnum(EntryType)
//   entryType?: EntryType;

//   @IsOptional()
//   @IsEnum(EntryCategory)
//   category?: EntryCategory;

//   @IsOptional()
//   @IsInt()
//   @Min(1)
//   @Max(200)
//   limit?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   offset?: number;
// }

// export class CloseMonthDto {
//   @IsInt()
//   @Min(2024)
//   year: number;

//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month: number;

//   @IsOptional()
//   @IsBoolean()
//   previewOnly?: boolean;
// }
// apps/api/src/modules/bookkeeping/dto/bookkeeping.dto.ts

// import {
//   IsEnum,
//   IsString,
//   IsNumber,
//   IsOptional,
//   IsDateString,
//   IsBoolean,
//   IsInt,
//   Min,
//   Max,
//   IsUUID,
//   Length,
// } from 'class-validator';
// import {
//   EntryType,
//   EntryCategory,
//   BusinessPersona,
//   VatRegistrationStatus,
// } from '../entities/bookkeeping.entities';

// // ─── Tax profile setup (onboarding) ──────────────────────────────────────────

// export class SetupTaxProfileDto {
//   @IsEnum(BusinessPersona)
//   persona: BusinessPersona;

//   @IsEnum(VatRegistrationStatus)
//   vatStatus: VatRegistrationStatus;

//   @IsOptional()
//   @IsString()
//   vatNumber?: string;

//   @IsOptional()
//   @IsString()
//   registrationCode?: string;

//   @IsOptional()
//   @IsBoolean()
//   autoFileEnabled?: boolean;

//   @IsOptional()
//   @IsNumber()
//   defaultVatRate?: number;

//   @IsOptional()
//   @IsBoolean()
//   isSoleTraderFie?: boolean;
// }

// // ─── Quick income entry ───────────────────────────────────────────────────────
// // The "3-tap" flow for recording daily sales. Minimal required fields.

// export class AddIncomeDto {
//   @IsDateString()
//   date: string; // YYYY-MM-DD

//   @IsNumber()
//   @Min(0.01)
//   grossAmount: number;

//   @IsEnum(EntryCategory)
//   category: EntryCategory; // SALES_CASH | SALES_CARD | SALES_ONLINE | INVOICE_PAYMENT

//   @IsOptional()
//   @IsString()
//   description?: string; // Defaults to "Sales - {date}" if omitted

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number; // Defaults to profile defaultVatRate

//   @IsOptional()
//   @IsString()
//   counterpartyName?: string;

//   @IsOptional()
//   @IsString()
//   counterpartyVatNumber?: string; // For KMD INF (B2B > €1 000)

//   @IsOptional()
//   @IsString()
//   invoiceNumber?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Quick expense entry ──────────────────────────────────────────────────────
// // Used when receipt scan fails or user adds manually.

// export class AddExpenseDto {
//   @IsDateString()
//   date: string;

//   @IsNumber()
//   @Min(0.01)
//   grossAmount: number;

//   @IsEnum(EntryCategory)
//   category: EntryCategory;

//   @IsOptional()
//   @IsString()
//   description?: string;

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number; // Input VAT rate on the purchase receipt

//   @IsOptional()
//   @IsString()
//   counterpartyName?: string; // Supplier name

//   @IsOptional()
//   @IsString()
//   counterpartyVatNumber?: string;

//   @IsOptional()
//   @IsString()
//   invoiceNumber?: string;

//   @IsOptional()
//   @IsString()
//   receiptImageUrl?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Salary entry ─────────────────────────────────────────────────────────────
// // Records a salary payment for one employee for the month.
// // Tax calculations are derived server-side — user only provides gross.

// export class AddSalaryDto {
//   @IsDateString()
//   date: string; // Date salary was paid (bank transfer date)

//   @IsUUID()
//   employeeId: string;

//   @IsNumber()
//   @Min(0)
//   grossAmount: number; // Gross monthly salary

//   @IsOptional()
//   @IsNumber()
//   basicExemption?: number; // Override if employee provided written request

//   @IsOptional()
//   @IsString()
//   bankReferenceNumber?: string; // Bank transfer reference

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }

// // ─── Batch daily sales (restaurant use case) ──────────────────────────────────
// // Restaurant owner enters one day's totals at close of day.
// // Splits by payment method automatically.

// export class AddDailySalesDto {
//   @IsDateString()
//   date: string;

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   cashSales?: number; // Gross cash receipts

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   cardSales?: number; // Gross card terminal receipts

//   @IsOptional()
//   @IsNumber()
//   @Min(0)
//   onlineSales?: number; // Delivery apps, online orders

//   @IsOptional()
//   @IsNumber()
//   vatRate?: number; // If omitted: uses profile default

//   @IsOptional()
//   @IsString()
//   notes?: string; // "Lunch crowd was good", etc.
// }

// // ─── Receipt scan request ─────────────────────────────────────────────────────

// export class ScanReceiptDto {
//   @IsString()
//   imageUrl: string; // Already uploaded to S3/Cloudinary by frontend

//   @IsOptional()
//   @IsEnum(EntryCategory)
//   expectedCategory?: EntryCategory; // Hint for the AI

//   @IsOptional()
//   @IsDateString()
//   expectedDate?: string; // Override if OCR gets it wrong

//   // If true: automatically creates a confirmed BookkeepingEntry
//   // If false: returns parsed data for user to review before saving
//   @IsOptional()
//   @IsBoolean()
//   autoConfirm?: boolean;
// }

// // ─── Employee management ──────────────────────────────────────────────────────

// export class CreateEmployeeDto {
//   @IsString()
//   @Length(1, 100)
//   fullName: string;

//   @IsOptional()
//   @IsString()
//   @Length(11, 11, { message: 'Estonian personal ID must be exactly 11 digits' })
//   personalIdCode?: string;

//   @IsOptional()
//   @IsString()
//   paymentTypeCode?: string;

//   @IsOptional()
//   @IsBoolean()
//   isBoardMember?: boolean;

//   @IsOptional()
//   @IsString()
//   email?: string;

//   @IsOptional()
//   @IsString()
//   bankAccount?: string;
// }

// // ─── Period queries ───────────────────────────────────────────────────────────

// export class GetPeriodDto {
//   @IsInt()
//   @Min(2024)
//   year: number;

//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month: number;
// }

// export class ListEntriesDto {
//   @IsOptional()
//   @IsInt()
//   year?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month?: number;

//   @IsOptional()
//   @IsEnum(EntryType)
//   entryType?: EntryType;

//   @IsOptional()
//   @IsEnum(EntryCategory)
//   category?: EntryCategory;

//   @IsOptional()
//   @IsInt()
//   @Min(1)
//   @Max(200)
//   limit?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   offset?: number;
// }

// // ─── Month close / file taxes ─────────────────────────────────────────────────

// export class CloseMonthDto {
//   @IsInt()
//   @Min(2024)
//   year: number;

//   @IsInt()
//   @Min(1)
//   @Max(12)
//   month: number;

//   // If true: calculates tax preview but does NOT submit to EMTA
//   @IsOptional()
//   @IsBoolean()
//   previewOnly?: boolean;
// }
