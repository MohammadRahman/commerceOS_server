// apps/api/src/modules/storefront/dto/create-product.dto.ts
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsNumber,
  IsPositive,
  MaxLength,
  MinLength,
  Min,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// ─── ImageTransform sub-DTO ───────────────────────────────────────────────────

export class ImageTransformDto {
  /** 0–200, default 100 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  brightness?: number;

  /** 0–200, default 100 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  contrast?: number;

  /** 0–200, default 100 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  saturation?: number;

  /** 0–10 px, default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  blur?: number;

  /** 100–200 (zoom), default 100 */
  @IsOptional()
  @IsNumber()
  @Min(100)
  scale?: number;

  /** 0–100 % horizontal crop position, default 50 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  x?: number;

  /** 0–100 % vertical crop position, default 50 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  y?: number;
}

// ─── ProductSEO sub-DTO ───────────────────────────────────────────────────────

export class ProductSeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @IsOptional()
  @IsString()
  ogImage?: string;

  @IsOptional()
  @IsString()
  canonical?: string;

  @IsOptional()
  @IsBoolean()
  noIndex?: boolean;
}

// ─── Main DTO ─────────────────────────────────────────────────────────────────

export class CreateProductDto {
  // ── Core ─────────────────────────────────────────────────────────────────

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @IsPositive()
  price: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  comparePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  // ── Image transforms ──────────────────────────────────────────────────────
  // Array index matches images[]. Stored as JSONB, applied client-side only.

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageTransformDto)
  transforms?: ImageTransformDto[];

  // ── SEO ───────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ProductSeoDto)
  seo?: ProductSeoDto;
}

// ─── Update DTO ───────────────────────────────────────────────────────────────
// All fields optional via PartialType — no need to repeat decorators.

export class UpdateProductDto extends PartialType(CreateProductDto) {}
