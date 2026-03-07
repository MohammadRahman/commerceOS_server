// v2
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
import { memoryStorage } from 'multer';

@Controller()
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ── Payment links ─────────────────────────────────────────────────────────

  @Get('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard)
  list(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
    return this.payments.listPaymentLinks(ctx.orgId, orderId);
  }

  @Get('v1/pay/:id') // ← no @UseGuards(JwtAuthGuard)
  publicLink(@Param('id') id: string) {
    return this.payments.getPublicPaymentLink(id);
  }

  // ── CHANGED: body now accepts payNow + due for split-payment support ──────
  @Post('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('payments:write')
  create(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') orderId: string,
    @Body()
    body: {
      provider?: string;
      totalAmount?: number;
      payNow?: number; // online portion — undefined = full payment
      due?: number; // COD remainder
      dueType?: string; // 'cash_on_delivery' | null
    },
  ) {
    return this.payments.createPaymentLink(
      ctx.orgId,
      ctx.userId,
      orderId,
      body?.provider ?? 'sslcommerz',
      body?.payNow, // ← forwarded to service (new param)
      body?.due ?? 0, // ← forwarded to service (new param)
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
  // Public — no JWT. Customer submits proof from PaymentPage.
  // ── CHANGED: file is now optional (customer may send trxId only);
  //             trxId extracted separately from body.
  @Post('v1/payment-links/:id/screenshot')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async uploadScreenshot(
    @Param('id') linkId: string,
    @Body('orgId') orgId: string,
    @Body('trxId') trxId: string | undefined, // ← new
    @UploadedFile() file: Express.Multer.File | undefined, // ← now optional
  ) {
    if (!orgId) throw new Error('orgId required');

    return this.payments.uploadPaymentScreenshot(
      orgId,
      linkId,
      file?.buffer ?? Buffer.alloc(0), // empty buffer when no file uploaded
      file?.originalname ?? '',
      file?.mimetype ?? '',
      trxId, // ← new
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

  // ── Refunds ───────────────────────────────────────────────────────────────

  @Post('v1/orders/:id/refunds')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('payments:write')
  createRefund(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') orderId: string,
    @Body() body: { provider?: string },
  ) {
    return this.payments.createRefundLink(
      ctx.orgId,
      ctx.userId,
      orderId,
      body?.provider ?? 'bkash',
    );
  }
}
// v1
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// import {
//   Body,
//   Controller,
//   Get,
//   Param,
//   Post,
//   UseGuards,
//   UseInterceptors,
//   UploadedFile,
// } from '@nestjs/common';
// import { FileInterceptor } from '@nestjs/platform-express';
// import { Ctx } from '@app/common/utils/request-context';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { PaymentsService } from './Payments.service.v2';
// import { memoryStorage } from 'multer';

// @Controller()
// export class PaymentsController {
//   constructor(private payments: PaymentsService) {}

//   // ── Payment links ─────────────────────────────────────────────────────────

//   @Get('v1/orders/:id/payment-links')
//   @UseGuards(JwtAuthGuard)
//   list(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
//     return this.payments.listPaymentLinks(ctx.orgId, orderId);
//   }

//   @Get('v1/pay/:id') // ← no @UseGuards(JwtAuthGuard)
//   publicLink(@Param('id') id: string) {
//     return this.payments.getPublicPaymentLink(id);
//   }

//   @Post('v1/orders/:id/payment-links')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('payments:write')
//   create(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') orderId: string,
//     @Body() body: { provider?: string },
//   ) {
//     return this.payments.createPaymentLink(
//       ctx.orgId,
//       ctx.userId,
//       orderId,
//       body?.provider ?? 'sslcommerz',
//     );
//   }

//   // ── Single link + status ──────────────────────────────────────────────────

//   @Get('v1/payment-links/:id')
//   @UseGuards(JwtAuthGuard)
//   getLink(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
//     return this.payments.getPaymentLinkWithEvents(ctx.orgId, linkId);
//   }

//   @Get('v1/payment-links/:id/status')
//   @UseGuards(JwtAuthGuard)
//   status(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
//     return this.payments.checkPaymentStatus(ctx.orgId, linkId);
//   }

//   // ── Personal payment flow ─────────────────────────────────────────────────

//   // POST /v1/payment-links/:id/screenshot
//   // Customer or owner uploads proof of payment
//   // Uses multer to handle multipart/form-data
//   @Post('v1/payment-links/:id/screenshot')
//   // @UseInterceptors(FileInterceptor('file'))
//   @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
//   async uploadScreenshot(
//     @Param('id') linkId: string,
//     @Body() body: { orgId: string }, // passed in body for unauthenticated customer upload
//     @UploadedFile() file: Express.Multer.File,
//   ) {
//     if (!file) throw new Error('No file uploaded');
//     const orgId = body?.orgId;
//     if (!orgId) throw new Error('orgId required');

//     return this.payments.uploadPaymentScreenshot(
//       orgId,
//       linkId,
//       file.buffer,
//       file.originalname,
//       file.mimetype,
//     );
//   }

//   // POST /v1/payment-links/:id/confirm — owner confirms manual payment
//   @Post('v1/payment-links/:id/confirm')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('payments:write')
//   confirm(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') linkId: string,
//     @Body() body: { transactionId?: string },
//   ) {
//     return this.payments.confirmManualPayment(
//       ctx.orgId,
//       linkId,
//       ctx.userId,
//       body?.transactionId,
//     );
//   }

//   // ── Org providers ─────────────────────────────────────────────────────────

//   @Get('v1/org/payment-providers')
//   @UseGuards(JwtAuthGuard)
//   listProviders(@Ctx() ctx: { orgId: string }) {
//     return this.payments.getOrgPaymentProviders(ctx.orgId);
//   }

//   // ── Webhook — no JWT ──────────────────────────────────────────────────────

//   @Post('v1/webhooks/payments/:provider')
//   async webhook(@Param('provider') provider: string, @Body() body: any) {
//     const orgId = body?.orgId;
//     if (!orgId) return { ok: true, ignored: 'missing_orgId' };
//     return this.payments.handleProviderWebhook(provider, orgId, body);
//   }

//   @Post('v1/orders/:id/refunds')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('payments:write')
//   createRefund(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') orderId: string,
//     @Body() body: { provider?: string },
//   ) {
//     return this.payments.createRefundLink(
//       ctx.orgId,
//       ctx.userId,
//       orderId,
//       body?.provider ?? 'bkash',
//     );
//   }
// }
