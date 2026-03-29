// apps/api/src/modules/storefront/dto/upsert-store.dto.ts
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  MaxLength,
  MinLength,
  Min,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── SEO sub-DTO ──────────────────────────────────────────────────────────────

export class StoreSeoDto {
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
  @MaxLength(200)
  googleVerification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bingVerification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  twitterHandle?: string;

  @IsOptional()
  @IsBoolean()
  enableStructuredData?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  robots?: string;
}

// ─── ThemeConfig sub-DTO ──────────────────────────────────────────────────────
// ThemeConfig is intentionally kept as a loose object on the backend — it is
// a large, evolving client-side type (layouts, fonts, hero slides, animations)
// that would require constant backend DTO updates as the builder adds features.
// We validate only the top-level shape and let the JSONB column hold the rest.

export class ThemeConfigDto {
  @IsOptional()
  @IsString()
  layout?: string;

  @IsOptional()
  @IsString()
  font?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  heroStyle?: string;

  @IsOptional()
  @IsString()
  navStyle?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  gridCols?: number;

  @IsOptional()
  @IsBoolean()
  showCategories?: boolean;

  @IsOptional()
  @IsString()
  borderRadius?: string;

  @IsOptional()
  @IsBoolean()
  showRatings?: boolean;

  @IsOptional()
  @MaxLength(300)
  announcement?: string | null; // no @IsString — must accept null

  @IsOptional()
  @IsString()
  heroTitle?: string;

  @IsOptional()
  @IsString()
  heroSubtitle?: string;

  @IsOptional()
  @IsString()
  heroCta?: string;

  @IsOptional()
  @IsString()
  heroAlignment?: string;

  @IsOptional()
  @IsString()
  heroAnimation?: string;

  @IsOptional()
  @IsString()
  heroHeight?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  heroOverlayOpacity?: number;

  // Hero slides and categories are arrays of objects — validated loosely
  // to avoid coupling the DTO to the client type system
  @IsOptional()
  @IsArray()
  heroSlides?: any[]; // loose — heroSlide objects validated client-side

  @IsOptional()
  categories?: string[];
}

// ─── Main DTO ─────────────────────────────────────────────────────────────────

export class UpsertStoreDto {
  // ── Identity ──────────────────────────────────────────────────────────────

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  // ── Media ─────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  // ── Commerce ──────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  @MaxLength(20)
  themeColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ── Contact ───────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  // ── Social ────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  instagramUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsappNumber?: string;

  // ── Theme config ──────────────────────────────────────────────────────────

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ThemeConfigDto)
  themeConfig?: ThemeConfigDto;

  // ── SEO ───────────────────────────────────────────────────────────────────

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => StoreSeoDto)
  seo?: StoreSeoDto;
}
// apps/api/src/modules/storefront/dto/upsert-store.dto.ts
// import {
//   IsString,
//   IsOptional,
//   IsBoolean,
//   IsInt,
//   MaxLength,
//   MinLength,
//   Min,
//   IsObject,
//   ValidateNested,
// } from 'class-validator';
// import { Type } from 'class-transformer';

// // ─── SEO sub-DTO ──────────────────────────────────────────────────────────────

// export class StoreSeoDto {
//   @IsOptional()
//   @IsString()
//   @MaxLength(80)
//   title?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(180)
//   description?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(500)
//   keywords?: string;

//   @IsOptional()
//   @IsString()
//   ogImage?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(200)
//   googleVerification?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(200)
//   bingVerification?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(60)
//   twitterHandle?: string;

//   @IsOptional()
//   @IsBoolean()
//   enableStructuredData?: boolean;

//   @IsOptional()
//   @IsString()
//   @MaxLength(100)
//   robots?: string;
// }

// // ─── ThemeConfig sub-DTO ──────────────────────────────────────────────────────
// // ThemeConfig is intentionally kept as a loose object on the backend — it is
// // a large, evolving client-side type (layouts, fonts, hero slides, animations)
// // that would require constant backend DTO updates as the builder adds features.
// // We validate only the top-level shape and let the JSONB column hold the rest.

// export class ThemeConfigDto {
//   @IsOptional()
//   @IsString()
//   layout?: string;

//   @IsOptional()
//   @IsString()
//   font?: string;

//   @IsOptional()
//   @IsString()
//   primaryColor?: string;

//   @IsOptional()
//   @IsString()
//   secondaryColor?: string;

//   @IsOptional()
//   @IsString()
//   heroStyle?: string;

//   @IsOptional()
//   @IsString()
//   navStyle?: string;

//   @IsOptional()
//   @IsInt()
//   @Min(1)
//   gridCols?: number;

//   @IsOptional()
//   @IsBoolean()
//   showCategories?: boolean;

//   @IsOptional()
//   @IsString()
//   borderRadius?: string;

//   @IsOptional()
//   @IsBoolean()
//   showRatings?: boolean;

//   @IsOptional()
//   @IsString()
//   @MaxLength(300)
//   announcement?: string | null;

//   @IsOptional()
//   @IsString()
//   heroTitle?: string;

//   @IsOptional()
//   @IsString()
//   heroSubtitle?: string;

//   @IsOptional()
//   @IsString()
//   heroCta?: string;

//   @IsOptional()
//   @IsString()
//   heroAlignment?: string;

//   @IsOptional()
//   @IsString()
//   heroAnimation?: string;

//   @IsOptional()
//   @IsString()
//   heroHeight?: string;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   heroOverlayOpacity?: number;

//   // Hero slides and categories are arrays of objects — validated loosely
//   // to avoid coupling the DTO to the client type system
//   @IsOptional()
//   heroSlides?: any[];

//   @IsOptional()
//   categories?: string[];
// }

// // ─── Main DTO ─────────────────────────────────────────────────────────────────

// export class UpsertStoreDto {
//   // ── Identity ──────────────────────────────────────────────────────────────

//   @IsString()
//   @MinLength(1)
//   @MaxLength(200)
//   name: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(100)
//   slug?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(200)
//   customDomain?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(1000)
//   description?: string;

//   // ── Media ─────────────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsString()
//   logoUrl?: string;

//   @IsOptional()
//   @IsString()
//   bannerUrl?: string;

//   // ── Commerce ──────────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsString()
//   @MaxLength(20)
//   themeColor?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(5)
//   currency?: string;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   deliveryFee?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   minOrder?: number;

//   @IsOptional()
//   @IsBoolean()
//   isActive?: boolean;

//   // ── Contact ───────────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsString()
//   @MaxLength(30)
//   contactPhone?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(320)
//   contactEmail?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(500)
//   address?: string;

//   // ── Social ────────────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsString()
//   facebookUrl?: string;

//   @IsOptional()
//   @IsString()
//   instagramUrl?: string;

//   @IsOptional()
//   @IsString()
//   @MaxLength(30)
//   whatsappNumber?: string;

//   // ── Theme config ──────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsObject()
//   @ValidateNested()
//   @Type(() => ThemeConfigDto)
//   themeConfig?: ThemeConfigDto;

//   // ── SEO ───────────────────────────────────────────────────────────────────

//   @IsOptional()
//   @IsObject()
//   @ValidateNested()
//   @Type(() => StoreSeoDto)
//   seo?: StoreSeoDto;
// }
