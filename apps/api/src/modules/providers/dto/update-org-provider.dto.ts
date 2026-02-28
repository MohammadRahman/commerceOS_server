import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ProviderStatus } from '../entities/org-payment-provider.entity';
import { PaymentProviderType } from '../entities/payment-provider-catalog.entity';
import { CourierProviderType } from '../entities/courier-provider-catalog.entity';

export class UpdateOrgProviderDto {
  @IsEnum([
    ...Object.values(PaymentProviderType),
    ...Object.values(CourierProviderType),
  ])
  type: PaymentProviderType | CourierProviderType; // changed from enum to string PaymentProviderType

  @IsEnum(ProviderStatus)
  status: ProviderStatus;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}
