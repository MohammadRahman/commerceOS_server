/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Ctx } from '@app/common/utils/request-context';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './Payments.service.v2';

@Controller()
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ── Payment links ─────────────────────────────────────────────────────────

  @Get('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard)
  list(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
    return this.payments.listPaymentLinks(ctx.orgId, orderId);
  }

  @Post('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('payments:write')
  create(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') orderId: string,
    @Body() body: { provider?: string },
  ) {
    return this.payments.createPaymentLink(
      ctx.orgId,
      ctx.userId,
      orderId,
      body?.provider ?? 'sslcommerz',
    );
  }

  // ── Single link + status ──────────────────────────────────────────────────

  @Get('v1/payment-links/:id')
  @UseGuards(JwtAuthGuard)
  getLink(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
    return this.payments.getPaymentLinkWithEvents(ctx.orgId, linkId);
  }

  @Get('v1/payment-links/:id/status')
  @UseGuards(JwtAuthGuard)
  status(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
    return this.payments.checkPaymentStatus(ctx.orgId, linkId);
  }

  // ── Personal payment flow ─────────────────────────────────────────────────

  // POST /v1/payment-links/:id/screenshot
  // Customer or owner uploads proof of payment
  // Uses multer to handle multipart/form-data
  @Post('v1/payment-links/:id/screenshot')
  @UseInterceptors(FileInterceptor('file'))
  async uploadScreenshot(
    @Param('id') linkId: string,
    @Body() body: { orgId: string }, // passed in body for unauthenticated customer upload
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('No file uploaded');
    const orgId = body?.orgId;
    if (!orgId) throw new Error('orgId required');

    return this.payments.uploadPaymentScreenshot(
      orgId,
      linkId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  // POST /v1/payment-links/:id/confirm — owner confirms manual payment
  @Post('v1/payment-links/:id/confirm')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('payments:write')
  confirm(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') linkId: string,
    @Body() body: { transactionId?: string },
  ) {
    return this.payments.confirmManualPayment(
      ctx.orgId,
      linkId,
      ctx.userId,
      body?.transactionId,
    );
  }

  // ── Org providers ─────────────────────────────────────────────────────────

  @Get('v1/org/payment-providers')
  @UseGuards(JwtAuthGuard)
  listProviders(@Ctx() ctx: { orgId: string }) {
    return this.payments.getOrgPaymentProviders(ctx.orgId);
  }

  // ── Webhook — no JWT ──────────────────────────────────────────────────────

  @Post('v1/webhooks/payments/:provider')
  async webhook(@Param('provider') provider: string, @Body() body: any) {
    const orgId = body?.orgId;
    if (!orgId) return { ok: true, ignored: 'missing_orgId' };
    return this.payments.handleProviderWebhook(provider, orgId, body);
  }
}
