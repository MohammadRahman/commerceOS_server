// apps/api/src/modules/estonia-tax/estonia-tax.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import {
  EstoniaTaxPeriod,
  EstoniaVatTransaction,
  EstoniaEmployeeTaxRecord,
  EstoniaTaxSubmission,
} from './entities/estonia-tax.entities';
import { EstoniaVatService } from './services/vat.service';
import { ESTONIA_TAX_QUEUE_NAMES } from './estonia-tax.constants';
import { EstoniaTaxController } from './estonia-tax.controller';
import { EstoniaEmtaGatewayService } from './services/emta-gateway.service';
import { EstoniaTaxDeadlineService } from './services/tax-deadline.service';
import { EstoniaTsdService } from './services/tsd.service';
import { EstoniaXmlBuilderService } from './services/xml-builder.service';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EstoniaTaxPeriod,
      EstoniaVatTransaction,
      EstoniaEmployeeTaxRecord,
      EstoniaTaxSubmission,
      OrganizationEntity,
    ]),
    BullModule.registerQueue(
      { name: ESTONIA_TAX_QUEUE_NAMES.VAT_FILING },
      { name: ESTONIA_TAX_QUEUE_NAMES.TSD_FILING },
      { name: ESTONIA_TAX_QUEUE_NAMES.TAX_REMINDER },
    ),
    ScheduleModule.forRoot(),
  ],
  controllers: [EstoniaTaxController],
  providers: [
    EstoniaVatService,
    EstoniaTsdService,
    EstoniaXmlBuilderService,
    EstoniaEmtaGatewayService,
    EstoniaTaxDeadlineService,
  ],
  exports: [EstoniaVatService, EstoniaTsdService, EstoniaTaxDeadlineService],
})
export class EstoniaTaxModule {}
