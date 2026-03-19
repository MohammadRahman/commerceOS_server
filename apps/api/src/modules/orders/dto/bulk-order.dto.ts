// apps/api/src/modules/orders/dto/bulk-order.dto.ts
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
  ArrayMaxSize,
  IsNumber,
  Min,
} from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class BulkOrderIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  orderIds: string[];
}

export class BulkStatusDto extends BulkOrderIdsDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

export class BulkCourierDto extends BulkOrderIdsDto {
  @IsString()
  provider: string;

  @IsOptional()
  @IsString()
  serviceType?: string;
}

export class BulkPaymentLinkDto extends BulkOrderIdsDto {
  @IsString()
  provider: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryFee?: number;
}

// ── Result shape — every bulk operation returns this ─────────────────────────

export interface BulkResult<T = unknown> {
  total: number;
  successCount: number;
  failureCount: number;
  succeeded: { orderId: string; result: T }[];
  failed: { orderId: string; reason: string }[];
}
