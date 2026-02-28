import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './controllers/organizations.controller';
import { DatabaseModule } from '@app/common';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { OnboardingController } from './controllers/onboarding.controller';
import { PaymentProviderEntity } from '../payments/entities/payment-provider.entity';
import { ChannelEntity } from '../inbox/entities/channel.entity';
import { TeamController } from './controllers/team.controller';
import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
import { OrgCourierProviderEntity } from '../providers/entities/org-courier-provider.entity';
import { UserEntity } from '../tenancy/entities/user.entity';

@Module({
  imports: [
    DatabaseModule,
    DatabaseModule.forFeature([
      OrganizationEntity,
      PaymentProviderEntity,
      ChannelEntity,
      OrgPaymentProviderEntity,
      OrgCourierProviderEntity,
      UserEntity,
    ]),
  ],
  controllers: [OrganizationsController, OnboardingController, TeamController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
