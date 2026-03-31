// apps/api/src/modules/subscriptions/subscription.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';
import { Ctx } from '@app/common/utils/request-context';
import { SubscriptionService } from './subscription.service';
import { SubscriptionPlan, BillingCycle } from './entities/subscription.entity';
import { UploadService } from '@app/common/upload/upload.service';

@Controller()
export class SubscriptionController {
  constructor(
    private readonly service: SubscriptionService,
    private readonly upload: UploadService,
  ) {}

  // ── Get current subscription + payment history ────────────────────────────

  @Get('v1/subscription')
  @UseGuards(JwtAuthGuard)
  get(@Ctx() ctx: { orgId: string }) {
    return this.service.getSubscription(ctx.orgId);
  }

  @Get('v1/subscription/payments')
  @UseGuards(JwtAuthGuard)
  getPayments(
    @Ctx() ctx: { orgId: string },
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.service.getPaymentHistory(
      ctx.orgId,
      Number(page),
      Number(limit),
    );
  }

  // ── Initiate plan change / checkout ──────────────────────────────────────

  @Post('v1/subscription/checkout')
  @UseGuards(JwtAuthGuard)
  checkout(
    @Ctx() ctx: { orgId: string },
    @Body()
    body: {
      plan: SubscriptionPlan;
      billingCycle: BillingCycle;
      paymentProvider: string;
    },
  ) {
    return this.service.initiatePlanChange(
      ctx.orgId,
      body.plan,
      body.billingCycle,
      body.paymentProvider,
    );
  }

  // ── Submit payment proof (screenshot + trxId) — for bKash/Nagad ─────────

  @Post('v1/subscription/payments/:id/proof')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async submitProof(
    @Ctx() ctx: { orgId: string },
    @Param('id') paymentId: string,
    @Body('trxId') trxId: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    let screenshotUrl: string | null = null;

    if (file?.buffer && file.buffer.length > 0) {
      const result = await this.upload.uploadPaymentScreenshot(
        file.buffer,
        file.originalname,
        file.mimetype,
        ctx.orgId,
        paymentId,
      );
      screenshotUrl = result.url;
    }

    return this.service.submitPaymentProof(
      ctx.orgId,
      paymentId,
      screenshotUrl,
      trxId,
    );
  }

  // ── Confirm payment (org owner — for manual bKash/Nagad confirmation) ────

  @Post('v1/subscription/payments/:id/confirm')
  @UseGuards(JwtAuthGuard)
  confirm(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') paymentId: string,
    @Body() body: { trxId?: string },
  ) {
    return this.service.confirmPayment(
      ctx.orgId,
      paymentId,
      ctx.userId,
      body.trxId,
    );
  }

  // ── Cancel subscription ───────────────────────────────────────────────────

  @Post('v1/subscription/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(
    @Ctx() ctx: { orgId: string },
    @Body() body: { immediately?: boolean },
  ) {
    return this.service.cancelSubscription(
      ctx.orgId,
      body.immediately ?? false,
    );
  }

  // ── Toggle auto-renew ─────────────────────────────────────────────────────

  @Patch('v1/subscription/auto-renew')
  @UseGuards(JwtAuthGuard)
  autoRenew(
    @Ctx() ctx: { orgId: string },
    @Body() body: { autoRenew: boolean },
  ) {
    return this.service.setAutoRenew(ctx.orgId, body.autoRenew);
  }

  // ── Webhook (no auth — called by payment gateway) ─────────────────────────

  @Post('v1/webhooks/subscription/:provider')
  webhook(@Param('provider') provider: string, @Body() body: any) {
    return this.service.handleWebhook(provider, body);
  }

  // ── Platform admin endpoints ──────────────────────────────────────────────

  @Get('v1/admin/subscriptions-list')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  adminList(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.service.adminListSubscriptions(Number(page), Number(limit));
  }

  @Post('v1/admin/subscription-payments/:id/confirm')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  adminConfirm(
    @Ctx() ctx: { userId: string },
    @Param('id') paymentId: string,
    @Body() body: { trxId?: string },
  ) {
    return this.service.adminConfirmPayment(paymentId, ctx.userId, body.trxId);
  }
}
