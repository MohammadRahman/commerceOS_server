// apps/api/src/modules/estonia-tax/estonia-tax.controller.ts
// REST endpoints for the Estonia Tax feature. All routes are org-scoped.

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EstoniaVatService } from './services/vat.service';
import { EstoniaTsdService } from './services/tsd.service';
import { EstoniaEmtaGatewayService } from './services/emta-gateway.service';
import { EstoniaTaxDeadlineService } from './services/tax-deadline.service';

import { TaxFormType } from './entities/estonia-tax.entities';
import { Ctx, RbacGuard, RequirePerm } from '@app/common';
import {
  RecordVatTransactionDto,
  TriggerFilingDto,
  RecordEmployeeTaxDto,
  TaxSubmissionQueryDto,
} from './dto/estonia-tax.dto';
import {
  ESTONIA_VAT_RATES,
  ESTONIA_CIT_RATE,
  ESTONIA_PERSONAL_INCOME_TAX_RATE,
  ESTONIA_SOCIAL_TAX_RATE,
} from './estonia-tax.constants';

@Controller('tax/estonia')
@UseGuards(JwtAuthGuard, RbacGuard)
export class EstoniaTaxController {
  constructor(
    private readonly vatService: EstoniaVatService,
    private readonly tsdService: EstoniaTsdService,
    private readonly emtaGateway: EstoniaEmtaGatewayService,
    private readonly deadlineService: EstoniaTaxDeadlineService,
  ) {}

  // ─── Reference data ───────────────────────────────────────────────────────

  @Get('rates')
  getRates() {
    return {
      vat: ESTONIA_VAT_RATES,
      cit: ESTONIA_CIT_RATE,
      personalIncomeTax: ESTONIA_PERSONAL_INCOME_TAX_RATE,
      socialTax: ESTONIA_SOCIAL_TAX_RATE,
      vatRegistrationThresholdEur: 40_000,
      notes: {
        vatEffectiveFrom: '2025-07-01',
        citNote: 'Applied only on profit distribution, not retained earnings',
      },
    };
  }

  // ─── Deadlines ────────────────────────────────────────────────────────────

  @Get('deadlines')
  @RequirePerm('tax:read')
  getDeadlines(@Query('year') year: string, @Query('month') month: string) {
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    return this.deadlineService.getDeadlines(y, m);
  }

  // ─── VAT (KMD) endpoints ──────────────────────────────────────────────────

  @Get('vat/summary')
  @RequirePerm('tax:read')
  async getVatSummary(
    @Ctx() ctx: any,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = parseInt(year);
    const m = parseInt(month);
    const period = await this.vatService.recalculatePeriodTotals(
      ctx.organizationId,
      y,
      m,
    );
    const approaching = await this.vatService.isApproachingVatThreshold(
      ctx.organizationId,
      y,
    );
    return { period, vatThresholdWarning: approaching };
  }

  @Post('vat/transactions')
  @RequirePerm('tax:write')
  @HttpCode(HttpStatus.CREATED)
  async recordVatTransaction(
    @Ctx() ctx: any,
    @Body() dto: RecordVatTransactionDto,
  ) {
    return this.vatService.recordTransaction(ctx.organizationId, dto);
  }

  @Get('vat/rate-lookup')
  getRateLookup(
    @Query('transactionType') transactionType: string,
    @Query('category') category?: string,
  ) {
    const { rate, description } = this.vatService.getApplicableRate(
      transactionType as any,
      category,
    );
    const { vatAmount, grossAmount } = this.vatService.calculateVatAmounts(
      100,
      rate,
    );
    return {
      vatRate: rate,
      description,
      example: { net: 100, vat: vatAmount, gross: grossAmount },
    };
  }

  @Post('vat/file')
  @RequirePerm('tax:submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerKmdFiling(@Ctx() ctx: any, @Body() dto: TriggerFilingDto) {
    const job = await this.deadlineService.queueVatFiling(
      ctx.organizationId,
      dto.taxYear,
      dto.taxMonth,
      dto.dryRun,
    );
    return { queued: true, jobId: job.id, dryRun: dto.dryRun };
  }

  @Get('vat/kmd-inf')
  @RequirePerm('tax:read')
  async getKmdInfPartners(
    @Ctx() ctx: any,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.vatService.getKmdInfPartners(
      ctx.organizationId,
      parseInt(year),
      parseInt(month),
    );
  }

  // ─── Payroll (TSD) endpoints ──────────────────────────────────────────────

  @Post('payroll/calculate')
  calculatePayroll(
    @Body() body: { grossSalary: number; basicExemption?: number },
  ) {
    return this.tsdService.calculatePayroll(
      body.grossSalary,
      body.basicExemption,
    );
  }

  @Post('payroll/employees')
  @RequirePerm('tax:write')
  @HttpCode(HttpStatus.CREATED)
  async recordEmployeeTax(@Ctx() ctx: any, @Body() dto: RecordEmployeeTaxDto) {
    return this.tsdService.recordEmployeeTax(ctx.organizationId, dto);
  }

  @Get('payroll/employees')
  @RequirePerm('tax:read')
  async getEmployeeRecords(
    @Ctx() ctx: any,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.tsdService.getEmployeeRecords(
      ctx.organizationId,
      parseInt(year),
      parseInt(month),
    );
  }

  @Post('payroll/file')
  @RequirePerm('tax:submit')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerTsdFiling(@Ctx() ctx: any, @Body() dto: TriggerFilingDto) {
    const job = await this.deadlineService.queueTsdFiling(
      ctx.organizationId,
      dto.taxYear,
      dto.taxMonth,
      dto.dryRun,
    );
    return { queued: true, jobId: job.id, dryRun: dto.dryRun };
  }

  // ─── Submissions audit trail ──────────────────────────────────────────────

  @Get('submissions')
  @RequirePerm('tax:read')
  async getSubmissions(@Ctx() ctx: any, @Query() query: TaxSubmissionQueryDto) {
    return this.emtaGateway.getSubmissions(ctx.organizationId, {
      taxYear: query.taxYear,
      taxMonth: query.taxMonth,
      formType: query.formType as TaxFormType,
    });
  }

  @Get('submissions/:id/xml')
  @RequirePerm('tax:read')
  async getSubmissionXml(
    @Ctx() ctx: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const xml = await this.emtaGateway.getSubmissionXml(id, ctx.organizationId);
    return { xml };
  }
}
