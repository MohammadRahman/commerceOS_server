import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

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
  currency?: string;

  @IsOptional()
  @IsString()
  campaignTag?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
