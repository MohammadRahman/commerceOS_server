import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common';
import { CourierProviderCatalogEntity } from './entities/courier-provider-catalog.entity';
import { OrgCourierProviderEntity } from './entities/org-courier-provider.entity';
import { OrgPaymentProviderEntity } from './entities/org-payment-provider.entity';
import { PaymentProviderCatalogEntity } from './entities/payment-provider-catalog.entity';
import { OrgProvidersController } from './controllers/org-providers.controller';
import { ProvidersCatalogController } from './controllers/providers-catalog.controller';
import { OrgProvidersService } from './services/org-providers.service';
import { ProvidersCatalogService } from './services/providers-catalog.service';

@Module({
  imports: [
    DatabaseModule,
    DatabaseModule.forFeature([
      PaymentProviderCatalogEntity,
      CourierProviderCatalogEntity,
      OrgPaymentProviderEntity,
      OrgCourierProviderEntity,
    ]),
  ],
  controllers: [ProvidersCatalogController, OrgProvidersController],
  providers: [ProvidersCatalogService, OrgProvidersService],
  exports: [ProvidersCatalogService, OrgProvidersService],
})
export class ProvidersModule {}
