// apps/api/src/modules/bookkeeping/bookkeeping.module.ts

import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    AiModule,
    UploadModule,
    TypeOrmModule.forFeature([
      BookkeepingEntry,
      MonthlyTaxPeriod,
      TaxProfile,
      EmployeeRecord,
      OrganizationEntity,
    ]),
    BullModule.registerQueue(
      { name: ESTONIA_TAX_QUEUE_NAMES.VAT_FILING },
      { name: ESTONIA_TAX_QUEUE_NAMES.TSD_FILING },
    ),
    ScheduleModule.forRoot(),
  ],
  controllers: [BookkeepingController],
  providers: [
    EntryService,
    ReceiptScannerService,
    MonthEndService,
    TaxProfileService,
  ],
  exports: [
    EntryService, // Used by orders.service for order sync
    MonthEndService,
    TaxProfileService,
  ],
})
export class BookkeepingModule {}

// ─── Reference data ───────────────────────────────────────────────────────
// HOW TO WIRE ORDER SYNC INTO YOUR EXISTING orders.service.ts
// ─────────────────────────────────────────────────────────────
// Add these two things to your existing orders.service.ts:
//
//   1. Inject EntryService in the constructor
//   2. Call syncFromOrder() when an order reaches PAID or DELIVERED
//
// The snippet below shows exactly what to add. Do NOT replace your
// existing orders.service — just add the marked lines.

/*
// In orders.module.ts — add BookkeepingModule to imports:
imports: [
  ...,
  BookkeepingModule,   // ← ADD THIS
],

// In orders.service.ts constructor — add:
constructor(
  ...,
  private readonly entryService: EntryService,  // ← ADD THIS
) {}

// In your updateOrderStatus() or wherever status transitions happen:
// Find the section that handles PAID / DELIVERED transitions and add:

if (
  (newStatus === 'DELIVERED' || newStatus === 'PAID') &&
  previousStatus !== 'DELIVERED' && previousStatus !== 'PAID'
) {
  // Fire-and-forget — don't block the order update if bookkeeping fails
  this.entryService.syncFromOrder(order.organizationId, {
    id:            order.id,
    total:         order.total        ?? 0,
    subtotal:      order.subtotal     ?? 0,
    deliveryFee:   order.deliveryFee  ?? 0,
    paidAmount:    order.paidAmount   ?? 0,
    status:        newStatus,
    paymentStatus: order.paymentStatus ?? '',
    createdAt:     order.createdAt,
  }).catch(err =>
    this.logger.error(`Bookkeeping sync failed for order ${order.id}`, err)
  );
}
*/

// ─────────────────────────────────────────────────────────────
// ENVIRONMENT VARIABLES NEEDED
// ─────────────────────────────────────────────────────────────
// Add to your .env files:
//
// # Anthropic API key for receipt OCR
// ANTHROPIC_API_KEY=sk-ant-...
//
// # Optional: EMTA e-MTA API base URL (defaults to production)
// EMTA_API_BASE_URL=https://e-mta.emta.ee
//
// # Per-organization EMTA tokens (set dynamically when org connects e-MTA)
// # EMTA_API_TOKEN_{organizationId}=<token>
// ─────────────────────────────────────────────────────────────
