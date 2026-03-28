// apps/api/src/modules/storefront/dto/storefront-order.dto.ts
import {
  IsString,
  IsOptional,
  IsEmail,
  IsArray,
  IsUUID,
  IsInt,
  IsPositive,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Order item sub-DTO ───────────────────────────────────────────────────────

export class OrderItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @IsPositive()
  quantity: number;
}

// ─── Main DTO ─────────────────────────────────────────────────────────────────

export class StorefrontOrderDto {
  // ── Customer ──────────────────────────────────────────────────────────────

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName: string;

  @IsString()
  @MinLength(7)
  @MaxLength(30)
  customerPhone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  customerEmail?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  deliveryAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // ── Items ─────────────────────────────────────────────────────────────────

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}
