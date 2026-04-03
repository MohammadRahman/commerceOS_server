// apps/api/src/modules/bookkeeping/dto/automation.dto.ts

import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateAutomationConfigDto {
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsEnum(['gmail', 'outlook'])
  emailProvider?: 'gmail' | 'outlook';

  @IsOptional()
  @IsString()
  emailWatchLabel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailAutoConfirmBelow?: number;

  @IsOptional()
  dailyReportSubjects?: string[];

  @IsOptional()
  @IsBoolean()
  bankStatementEnabled?: boolean;

  @IsOptional()
  @IsEnum(['lhv', 'seb', 'swedbank', 'coop', 'luminor'])
  bankName?: 'lhv' | 'seb' | 'swedbank' | 'coop' | 'luminor';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  autoConfirmConfidence?: number;

  @IsOptional()
  @IsBoolean()
  notifyOnQueue?: boolean;
}

export class AutomationConfigDto extends UpdateAutomationConfigDto {
  organizationId: string;
}

export class ReviewQueueItemDto {
  id: string;
  sourceType: string;
  status: string;
  parsedData: {
    type: 'expense' | 'income';
    amount: number;
    currency: string;
    date: string;
    description: string;
    category?: string;
    supplierName?: string;
    vatAmount?: number;
    confidence: number;
  } | null;
  confidence: number | null;
  createdAt: Date;
}
