// apps/api/src/modules/bookkeeping/bookkeeping.controller.ts
//
// Clean, intention-revealing endpoints.
// A restaurant owner, freelancer, and ecommerce seller all use the same routes
// — the persona differences are handled inside the services.

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EntryService } from './services/entry.service';
import { ReceiptScannerService } from './services/receipt-scanner.service';
import { MonthEndService } from './services/month-end.service';
import { TaxProfileService } from './services/tax-profile.service';

import {
  EntryCategory,
  BusinessPersona,
} from './entities/bookkeeping.entities';
import { Ctx, RbacGuard, RequirePerm } from '@app/common';
import {
  SetupTaxProfileDto,
  AddIncomeDto,
  AddDailySalesDto,
  AddExpenseDto,
  ScanReceiptDto,
  AddSalaryDto,
  CreateEmployeeDto,
  ListEntriesDto,
  CloseMonthDto,
} from './dto/bookkeeping.dto';

@Controller('bookkeeping')
@UseGuards(JwtAuthGuard, RbacGuard)
export class BookkeepingController {
  constructor(
    private readonly entryService: EntryService,
    private readonly scannerService: ReceiptScannerService,
    private readonly monthEndService: MonthEndService,
    private readonly taxProfileService: TaxProfileService,
  ) {}

  // ─── Onboarding ──────────────────────────────────────────────────────────
  // Called once when user sets up their business profile.

  @Post('setup')
  @RequirePerm('bookkeeping:write')
  async setup(@Ctx() ctx: any, @Body() dto: SetupTaxProfileDto) {
    return this.taxProfileService.upsertProfile(ctx.organizationId, dto);
  }

  @Get('setup')
  @RequirePerm('bookkeeping:read')
  async getProfile(@Ctx() ctx: any) {
    return this.taxProfileService.getProfile(ctx.organizationId);
  }

  // Reference data — no auth needed for rate lookups
  @Get('personas')
  getPersonas() {
    return [
      {
        id: BusinessPersona.RESTAURANT,
        label: 'Restaurant / Café',
        description: 'Daily sales, supplier invoices, staff salaries',
        icon: 'UtensilsCrossed',
        defaultCategories: [
          'SALES_CASH',
          'SALES_CARD',
          'SUPPLIER_FOOD',
          'STAFF_SALARY',
        ],
      },
      {
        id: BusinessPersona.ECOMMERCE,
        label: 'E-commerce seller',
        description: 'Online orders auto-sync, shipping, product costs',
        icon: 'ShoppingCart',
        defaultCategories: ['SALES_ONLINE', 'SUPPLIER_GOODS', 'TRANSPORT'],
      },
      {
        id: BusinessPersona.FREELANCER_FIE,
        label: 'Freelancer / FIE',
        description: 'Project invoices, equipment, software subscriptions',
        icon: 'Briefcase',
        defaultCategories: [
          'INVOICE_PAYMENT',
          'EQUIPMENT',
          'SOFTWARE',
          'TRANSPORT',
        ],
      },
      {
        id: BusinessPersona.COMPANY_OU,
        label: 'Company (OÜ)',
        description: 'Full company bookkeeping with employee salaries',
        icon: 'Building2',
        defaultCategories: [
          'SALES_ONLINE',
          'SALES_CARD',
          'STAFF_SALARY',
          'RENT',
        ],
      },
    ];
  }

  @Get('categories')
  getCategories() {
    return Object.values(EntryCategory).map((cat) => ({
      id: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      type:
        cat.includes('SALES') ||
        cat.includes('INVOICE') ||
        cat.includes('INCOME')
          ? 'income'
          : cat.includes('SALARY') ||
              cat.includes('FEE') ||
              cat.includes('BOARD')
            ? 'salary'
            : 'expense',
    }));
  }

  // ─── Income ───────────────────────────────────────────────────────────────

  @Post('income')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  addIncome(@Ctx() ctx: any, @Body() dto: AddIncomeDto) {
    return this.entryService.addIncome(ctx.organizationId, dto, ctx.userId);
  }

  // Restaurant-specific: one-shot end-of-day entry
  @Post('income/daily-sales')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  addDailySales(@Ctx() ctx: any, @Body() dto: AddDailySalesDto) {
    return this.entryService.addDailySales(ctx.organizationId, dto, ctx.userId);
  }

  // ─── Expenses ─────────────────────────────────────────────────────────────

  @Post('expenses')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  addExpense(@Ctx() ctx: any, @Body() dto: AddExpenseDto) {
    return this.entryService.addExpense(ctx.organizationId, dto, ctx.userId);
  }

  // ─── Receipt scanning ─────────────────────────────────────────────────────

  @Post('receipts/scan')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.OK)
  scanReceipt(@Ctx() ctx: any, @Body() dto: ScanReceiptDto) {
    return this.scannerService.scanReceipt(ctx.organizationId, dto, ctx.userId);
  }

  // Confirm a scanned receipt (after user reviews OCR output)
  @Post('receipts/confirm')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  confirmScannedReceipt(@Ctx() ctx: any, @Body() dto: AddExpenseDto) {
    return this.entryService.addExpense(ctx.organizationId, dto, ctx.userId);
  }

  // ─── Salaries ─────────────────────────────────────────────────────────────

  @Post('salaries')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  addSalary(@Ctx() ctx: any, @Body() dto: AddSalaryDto) {
    return this.entryService.addSalary(ctx.organizationId, dto, ctx.userId);
  }

  // Preview salary breakdown before paying (no DB write)
  @Post('salaries/preview')
  @RequirePerm('bookkeeping:read')
  previewSalary(
    @Body() body: { grossAmount: number; basicExemption?: number },
  ) {
    const gross = body.grossAmount;
    const exemption = body.basicExemption;
    return this.taxProfileService.previewPayroll(gross, exemption);
  }

  // ─── Employees ────────────────────────────────────────────────────────────

  @Post('employees')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.CREATED)
  createEmployee(@Ctx() ctx: any, @Body() dto: CreateEmployeeDto) {
    return this.taxProfileService.createEmployee(ctx.organizationId, dto);
  }

  @Get('employees')
  @RequirePerm('bookkeeping:read')
  listEmployees(@Ctx() ctx: any) {
    return this.taxProfileService.listEmployees(ctx.organizationId);
  }

  @Delete('employees/:id')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateEmployee(@Ctx() ctx: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.taxProfileService.deactivateEmployee(id, ctx.organizationId);
  }

  // ─── Entries (ledger view) ─────────────────────────────────────────────────

  @Get('entries')
  @RequirePerm('bookkeeping:read')
  listEntries(@Ctx() ctx: any, @Query() query: ListEntriesDto) {
    return this.entryService.listEntries(ctx.organizationId, query);
  }

  @Delete('entries/:id')
  @RequirePerm('bookkeeping:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  excludeEntry(@Ctx() ctx: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.entryService.excludeEntry(id, ctx.organizationId);
  }

  // ─── Monthly periods ───────────────────────────────────────────────────────

  @Get('periods')
  @RequirePerm('bookkeeping:read')
  listPeriods(@Ctx() ctx: any) {
    return this.monthEndService.listPeriods(ctx.organizationId);
  }

  @Get('periods/:year/:month')
  @RequirePerm('bookkeeping:read')
  getPeriod(
    @Ctx() ctx: any,
    @Param('year') year: string,
    @Param('month') month: string,
  ) {
    return this.monthEndService.getPeriod(
      ctx.organizationId,
      parseInt(year),
      parseInt(month),
    );
  }

  // ─── Month-end / tax filing ────────────────────────────────────────────────

  // Preview taxes for a period (no submission)
  @Post('periods/calculate')
  @RequirePerm('bookkeeping:read')
  calculateTaxes(@Ctx() ctx: any, @Body() dto: CloseMonthDto) {
    return this.monthEndService.closePeriod(
      ctx.organizationId,
      dto.year,
      dto.month,
      true,
    );
  }

  // Confirm and file to EMTA
  @Post('periods/file')
  @RequirePerm('bookkeeping:file')
  @HttpCode(HttpStatus.ACCEPTED)
  fileTaxes(@Ctx() ctx: any, @Body() dto: CloseMonthDto) {
    return this.monthEndService.closePeriod(
      ctx.organizationId,
      dto.year,
      dto.month,
      false,
    );
  }
}

// Human-readable labels for categories (used by the UI)
const CATEGORY_LABELS: Record<string, string> = {
  SALES_CASH: 'Cash sales',
  SALES_CARD: 'Card sales',
  SALES_ONLINE: 'Online sales',
  INVOICE_PAYMENT: 'Invoice payment received',
  OTHER_INCOME: 'Other income',
  SUPPLIER_FOOD: 'Food & beverage supplier',
  SUPPLIER_GOODS: 'Goods / products supplier',
  RENT: 'Rent',
  UTILITIES: 'Utilities',
  EQUIPMENT: 'Equipment',
  MARKETING: 'Marketing & advertising',
  SOFTWARE: 'Software & subscriptions',
  TRANSPORT: 'Transport',
  OTHER_EXPENSE: 'Other expense',
  STAFF_SALARY: 'Staff salary',
  OWNER_SALARY: 'Owner salary (FIE)',
  BOARD_FEE: 'Board member fee',
  BANK_TRANSFER: 'Bank transfer',
};
