import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './controllers/organizations.controller';
import { DatabaseModule } from '@app/common';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { OnboardingController } from './controllers/onboarding.controller';
import { PaymentProviderEntity } from '../payments/entities/payment-provider.entity';
import { ChannelEntity } from '../inbox/entities/channel.entity';

@Module({
  imports: [
    DatabaseModule,
    DatabaseModule.forFeature([
      OrganizationEntity,
      PaymentProviderEntity,
      ChannelEntity,
    ]),
  ],
  controllers: [OrganizationsController, OnboardingController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
