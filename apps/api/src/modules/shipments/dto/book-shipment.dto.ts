// apps/api/src/modules/shipments/dto/book-shipment.dto.ts
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class BookShipmentDto {
  @IsString()
  courierProvider: string;

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

  /**
   * Cash-on-delivery amount in BDT (paisa-less integer).
   * Pre-filled from order.balanceDue. 0 = no COD.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  codAmount?: number;

  /**
   * Parcel weight in kg. Required by most BD couriers for charge calculation.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  weight?: number;
}
// import { IsOptional, IsString } from 'class-validator';

// export class BookShipmentDto {
//   @IsString()
//   courierProvider: string; // "steadfast" etc.

//   // optional overrides (often needed in BD)
//   @IsOptional()
//   @IsString()
//   customerName?: string;

//   @IsOptional()
//   @IsString()
//   customerPhone?: string;

//   @IsOptional()
//   @IsString()
//   deliveryAddress?: string;

//   @IsOptional()
//   @IsString()
//   notes?: string;
// }
