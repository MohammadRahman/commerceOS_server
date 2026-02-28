/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Ctx } from '@app/common/utils/request-context';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // GET /v1/orders/:id/payment-links
  @Get('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard)
  list(@Ctx() ctx: { orgId: string }, @Param('id') orderId: string) {
    return this.payments.listPaymentLinks(ctx.orgId, orderId);
  }

  // POST /v1/orders/:id/payment-links
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

  // GET /v1/payment-links/:id/status
  @Get('v1/payment-links/:id/status')
  @UseGuards(JwtAuthGuard)
  status(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
    return this.payments.checkPaymentStatus(ctx.orgId, linkId);
  }

  // GET /v1/payment-links/:id
  @Get('v1/payment-links/:id')
  @UseGuards(JwtAuthGuard)
  getLink(@Ctx() ctx: { orgId: string }, @Param('id') linkId: string) {
    return this.payments.getPaymentLink(ctx.orgId, linkId);
  }

  // GET /v1/org/payment-providers
  @Get('v1/org/payment-providers')
  @UseGuards(JwtAuthGuard)
  listProviders(@Ctx() ctx: { orgId: string }) {
    return this.payments.getOrgPaymentProviders(ctx.orgId);
  }

  // POST /v1/webhooks/payments/:provider — no JWT
  @Post('v1/webhooks/payments/:provider')
  async webhook(@Param('provider') provider: string, @Body() body: any) {
    const orgId = body?.orgId;
    if (!orgId) return { ok: true, ignored: 'missing_orgId' };
    return this.payments.handleProviderWebhook(provider, orgId, body);
  }
}

// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
// import { PaymentsService } from './payments.service';
// import { Ctx } from '@app/common/utils/request-context';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// @Controller()
// export class PaymentsController {
//   constructor(private payments: PaymentsService) {}

//   @Post('v1/orders/:id/payment-links')
//   @UseGuards(JwtAuthGuard, RbacGuard)
//   @RequirePerm('payments:write')
//   create(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') orderId: string,
//   ) {
//     return this.payments.createPaymentLink(
//       ctx.orgId,
//       ctx.userId,
//       orderId,
//       'sslcommerz',
//     );
//   }

//   // Webhook should NOT require JWT
//   @Post('v1/webhooks/payments/:provider')
//   async webhook(@Param('provider') provider: string, @Body() body: any) {
//     // For now, orgId mapping is not solved without per-channel/provider configs.
//     // Enterprise approach: provider webhook is registered per org with a secret / path.
//     // Temporary: accept orgId in body for dev.
//     const orgId = body?.orgId;
//     if (!orgId) return { ok: true, ignored: 'missing_orgId' };

//     return this.payments.handleProviderWebhook(provider, orgId, body);
//   }
// }
