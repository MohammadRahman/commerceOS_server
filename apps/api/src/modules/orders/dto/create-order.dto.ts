/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// version: 2.0.0
import {
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
  ValidateIf,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

/**
 * CreateOrderDto supports two mutually exclusive flows:
 *
 * 1. Inbox flow   — provide conversationId. Customer is resolved automatically
 *                   via conversation → customer_identity → customer.
 *                   customerId, phone, customerName are not needed.
 *
 * 2. Standalone   — provide phone (+ optional customerName).
 *                   Service does find-or-create on the customers table.
 *                   conversationId is not needed.
 *
 * At least one of (conversationId | phone) must be present.
 */
export class CreateOrderDto {
  // ── Flow discriminators ────────────────────────────────────────────────────

  /**
   * Inbox flow: link the order to an existing conversation.
   * Customer is resolved automatically from this conversation.
   */
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  /**
   * Standalone flow: find or create the customer by phone number.
   * Required when conversationId is not provided.
   */
  @ValidateIf((o) => !o.conversationId)
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /**
   * Standalone flow: customer display name.
   * Used only when a new customer record is created (phone not found).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  // ── Order financials ───────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(0)
  subtotal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  currency?: string;

  // ── Metadata ──────────────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  @MaxLength(100)
  campaignTag?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// version: 1.0.0
// import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// export class CreateOrderDto {
//   @IsUUID()
//   customerId: string;

//   @IsOptional()
//   @IsUUID()
//   conversationId?: string;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   subtotal?: number;

//   @IsOptional()
//   @IsInt()
//   @Min(0)
//   deliveryFee?: number;

//   @IsOptional()
//   @IsString()
//   currency?: string;

//   @IsOptional()
//   @IsString()
//   campaignTag?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }
