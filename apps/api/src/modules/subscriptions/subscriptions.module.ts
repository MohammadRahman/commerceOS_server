/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/common/database/database.module';

import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionScheduler } from './subscription.scheduler';

import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionPaymentEntity } from './entities/subscription-payment.entity';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
import { UploadModule } from '@app/common/upload/upload.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    DatabaseModule.forFeature([
      SubscriptionEntity,
      SubscriptionPaymentEntity,
      OrganizationEntity,
      OrgPaymentProviderEntity,
    ]),
    UploadModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionScheduler],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
