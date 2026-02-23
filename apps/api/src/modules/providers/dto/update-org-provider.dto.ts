import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ProviderStatus } from '../entities/org-payment-provider.entity';
import { PaymentProviderType } from '../entities/payment-provider-catalog.entity';

export class UpdateOrgProviderDto {
  @IsEnum(PaymentProviderType)
  type: PaymentProviderType;

  @IsEnum(ProviderStatus)
  status: ProviderStatus;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}
