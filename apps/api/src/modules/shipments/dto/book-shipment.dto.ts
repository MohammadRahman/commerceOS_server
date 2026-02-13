import { IsOptional, IsString } from 'class-validator';

export class BookShipmentDto {
  @IsString()
  courierProvider: string; // "steadfast" etc.

  // optional overrides (often needed in BD)
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
