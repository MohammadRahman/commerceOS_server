// apps/worker/src/processors/estonia-vat-filing.processor.ts
// Processes queued KMD (VAT) filing jobs.

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

interface VatFilingJobData {
  organizationId: string;
  taxYear: number;
  taxMonth: number;
  dryRun?: boolean;
}

@Processor(ESTONIA_TAX_QUEUE_NAMES.VAT_FILING)
export class EstoniaVatFilingProcessor extends WorkerHost {
  private readonly logger = new Logger(EstoniaVatFilingProcessor.name);

  constructor(
    @InjectRepository(EstoniaTaxPeriod)
    private readonly periodRepo: Repository<EstoniaTaxPeriod>,

    @InjectRepository(EstoniaVatTransaction)
    private readonly vatTxRepo: Repository<EstoniaVatTransaction>,

    private readonly vatService: EstoniaVatService,
    private readonly xmlBuilder: EstoniaXmlBuilderService,
    private readonly emtaGateway: EstoniaEmtaGatewayService,
  ) {
    super();
  }

  async process(job: Job<VatFilingJobData>): Promise<void> {
    const { organizationId, taxYear, taxMonth, dryRun } = job.data;
    this.logger.log(
      `[VAT Filing] org=${organizationId} period=${taxYear}/${taxMonth} dryRun=${dryRun}`,
    );

    await job.updateProgress(10);

    // 1. Load period summary
    const period = await this.periodRepo.findOne({
      where: { organizationId, year: taxYear, month: taxMonth },
    });

    if (!period) {
      throw new Error(`No tax period found for ${taxYear}/${taxMonth}`);
    }

    if (
      period.kmdStatus === TaxPeriodStatus.SUBMITTED ||
      period.kmdStatus === TaxPeriodStatus.ACCEPTED
    ) {
      this.logger.warn(
        `KMD already submitted for ${taxYear}/${taxMonth} — skipping`,
      );
      return;
    }

    await job.updateProgress(25);

    // 2. Load all transactions for the period
    const transactions = await this.vatTxRepo.find({
      where: { organizationId, taxYear, taxMonth },
    });

    // 3. Build KMD INF partner list
    const kmdInfPartners = await this.vatService.getKmdInfPartners(
      organizationId,
      taxYear,
      taxMonth,
    );

    await job.updateProgress(50);

    // 4. Fetch org VAT number from organization settings
    // In production: load from organization entity or a dedicated settings table
    const orgVatNumber = `EE${organizationId.slice(0, 9).replace(/-/g, '')}`; // Placeholder
    const orgName = 'Organization Name'; // Load from org entity

    // 5. Build XML
    const xml = this.xmlBuilder.buildKmdXml({
      period,
      vatTransactions: transactions,
      kmdInfPartners,
      organizationVatNumber: orgVatNumber,
      organizationName: orgName,
    });

    await job.updateProgress(70);

    // 6. Submit to EMTA
    const submission = await this.emtaGateway.submitDeclaration(
      organizationId,
      TaxFormType.KMD,
      taxYear,
      taxMonth,
      xml,
      undefined, // system-triggered
      dryRun,
    );

    await job.updateProgress(90);

    // 7. Update period status
    if (!dryRun) {
      period.kmdStatus =
        submission.status === 'ACCEPTED'
          ? TaxPeriodStatus.ACCEPTED
          : TaxPeriodStatus.SUBMITTED;
      await this.periodRepo.save(period);
    }

    await job.updateProgress(100);
    this.logger.log(
      `[VAT Filing] Complete — submission id=${submission.id} status=${submission.status}`,
    );
  }
}

// ─── TSD Filing Processor ──────────────────────────────────────────────────────

// apps/worker/src/processors/estonia-tsd-filing.processor.ts

import {
  Processor as TsdProcessor,
  WorkerHost as TsdWorkerHost,
} from '@nestjs/bullmq';

interface TsdFilingJobData {
  organizationId: string;
  taxYear: number;
  taxMonth: number;
  dryRun?: boolean;
}

@TsdProcessor(ESTONIA_TAX_QUEUE_NAMES.TSD_FILING)
export class EstoniaTsdFilingProcessor extends TsdWorkerHost {
  private readonly logger = new Logger(EstoniaTsdFilingProcessor.name);

  constructor(
    @InjectRepository(EstoniaTaxPeriod)
    private readonly periodRepo: Repository<EstoniaTaxPeriod>,

    @InjectRepository(EstoniaEmployeeTaxRecord)
    private readonly empRepo: Repository<EstoniaEmployeeTaxRecord>,

    private readonly tsdService: EstoniaTsdService,
    private readonly xmlBuilder: EstoniaXmlBuilderService,
    private readonly emtaGateway: EstoniaEmtaGatewayService,
  ) {
    super();
  }

  async process(job: Job<TsdFilingJobData>): Promise<void> {
    const { organizationId, taxYear, taxMonth, dryRun } = job.data;
    this.logger.log(
      `[TSD Filing] org=${organizationId} period=${taxYear}/${taxMonth}`,
    );

    await job.updateProgress(10);

    const period = await this.periodRepo.findOne({
      where: { organizationId, year: taxYear, month: taxMonth },
    });

    if (!period)
      throw new Error(`No tax period found for ${taxYear}/${taxMonth}`);

    if (
      period.tsdStatus === TaxPeriodStatus.SUBMITTED ||
      period.tsdStatus === TaxPeriodStatus.ACCEPTED
    ) {
      this.logger.warn(`TSD already submitted for ${taxYear}/${taxMonth}`);
      return;
    }

    await job.updateProgress(30);

    const employees = await this.tsdService.getEmployeeRecords(
      organizationId,
      taxYear,
      taxMonth,
    );

    if (employees.length === 0) {
      this.logger.warn(
        `No employee records for ${taxYear}/${taxMonth} — skipping TSD`,
      );
      return;
    }

    await job.updateProgress(50);

    const orgRegCode = organizationId.slice(0, 8).replace(/-/g, ''); // Placeholder
    const orgName = 'Organization Name';

    const xml = this.xmlBuilder.buildTsdXml({
      period,
      employees,
      organizationRegCode: orgRegCode,
      organizationName: orgName,
    });

    await job.updateProgress(70);

    const submission = await this.emtaGateway.submitDeclaration(
      organizationId,
      TaxFormType.TSD,
      taxYear,
      taxMonth,
      xml,
      undefined,
      dryRun,
    );

    if (!dryRun) {
      period.tsdStatus =
        submission.status === 'ACCEPTED'
          ? TaxPeriodStatus.ACCEPTED
          : TaxPeriodStatus.SUBMITTED;
      await this.periodRepo.save(period);
    }

    await job.updateProgress(100);
    this.logger.log(`[TSD Filing] Complete — submission id=${submission.id}`);
  }
}

// ─── Tax Reminder Processor ────────────────────────────────────────────────────

import {
  Processor as RemProcessor,
  WorkerHost as RemWorkerHost,
} from '@nestjs/bullmq';
import {
  EstoniaTaxPeriod,
  EstoniaVatTransaction,
  TaxPeriodStatus,
  TaxFormType,
  EstoniaEmployeeTaxRecord,
} from 'apps/api/src/modules/estonia-tax/entities/estonia-tax.entities';
import { ESTONIA_TAX_QUEUE_NAMES } from 'apps/api/src/modules/estonia-tax/estonia-tax.constants';
import { EstoniaEmtaGatewayService } from 'apps/api/src/modules/estonia-tax/services/emta-gateway.service';
import { EstoniaVatService } from 'apps/api/src/modules/estonia-tax/services/vat.service';
import { EstoniaXmlBuilderService } from 'apps/api/src/modules/estonia-tax/services/xml-builder.service';
import { EstoniaTsdService } from 'apps/api/src/modules/estonia-tax/services/tsd.service';

interface TaxReminderJobData {
  organizationId: string;
  formType: 'KMD' | 'TSD';
  taxYear: number;
  taxMonth: number;
  daysUntilDeadline: number;
}

@RemProcessor(ESTONIA_TAX_QUEUE_NAMES.TAX_REMINDER)
export class EstoniaTaxReminderProcessor extends RemWorkerHost {
  private readonly logger = new Logger(EstoniaTaxReminderProcessor.name);

  async process(job: Job<TaxReminderJobData>): Promise<void> {
    const { organizationId, formType, taxYear, taxMonth, daysUntilDeadline } =
      job.data;

    this.logger.log(
      `[Reminder] ${formType} deadline in ${daysUntilDeadline} days — org=${organizationId} period=${taxYear}/${taxMonth}`,
    );

    // In production: push to the notifications module (email + in-app)
    // this.notificationsService.sendTaxDeadlineReminder(...)
  }
}
