// apps/api/src/modules/bookkeeping/bookkeeping.module.ts

import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import {
  BookkeepingEntry,
  MonthlyTaxPeriod,
  TaxProfile,
  EmployeeRecord,
} from './entities/bookkeeping.entities';
import { EntryService } from './services/entry.service';
import { ReceiptScannerService } from './services/receipt-scanner.service';
import { MonthEndService } from './services/month-end.service';
import { TaxProfileService } from './services/tax-profile.service';
import { BookkeepingController } from './bookkeeping.controller';
import { ESTONIA_TAX_QUEUE_NAMES } from '../estonia-tax/estonia-tax.constants';
import { AiModule } from '../ai/ai.module';
import { OrganizationEntity } from '../tenancy/entities/organization.entity';
import { UploadModule } from '@app/common/upload';
import { DailyTimelineService } from './services/daily-timeline.service';
import { SupplierService } from './services/supplier.service';
import { OpenBankingService } from './services/open-banking.service';
import { BankStatementService } from './services/bank-statement.service';
import { InboxParserService } from './services/inbox-parser.service';
import { AutomationController } from './automation.controller';
import { HttpModule } from '@nestjs/axios';
import { Supplier } from './entities/supplier.entity';
import { AutomationConfig } from './entities/automation-config.entity';
import { AutomationLog } from './entities/automation-log.entity';
import { BankStatementUpload } from './entities/bank-statement-upload.entity';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => AiModule), // AiModule exports AiService + re-exports BankStatementParserModule
    UploadModule,
    TypeOrmModule.forFeature([
      BookkeepingEntry,
      MonthlyTaxPeriod,
      TaxProfile,
      EmployeeRecord,
      OrganizationEntity,
      AutomationLog,
      AutomationConfig,
      Supplier,
      BankStatementUpload,
    ]),
    BullModule.registerQueue(
      { name: ESTONIA_TAX_QUEUE_NAMES.VAT_FILING },
      { name: ESTONIA_TAX_QUEUE_NAMES.TSD_FILING },
    ),
    ScheduleModule.forRoot(),
  ],
  controllers: [BookkeepingController, AutomationController],
  providers: [
    EntryService,
    ReceiptScannerService,
    MonthEndService,
    TaxProfileService,
    InboxParserService,
    BankStatementService,
    OpenBankingService,
    SupplierService,
    DailyTimelineService,
    // BankStatementParserService removed — injected via AiModule → BankStatementParserModule
  ],
  exports: [
    EntryService,
    MonthEndService,
    TaxProfileService,
    InboxParserService,
    BankStatementService,
    OpenBankingService,
    SupplierService,
    DailyTimelineService,
    // BankStatementParserService removed from exports too — callers that need it
    // should import BankStatementParserModule directly (it's a zero-dep module)
  ],
})
export class BookkeepingModule {}
