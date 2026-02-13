/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Ctx } from '@app/common/utils/request-context';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('v1/orders/:id/payment-links')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('payments:write')
  create(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') orderId: string,
  ) {
    return this.payments.createPaymentLink(
      ctx.orgId,
      ctx.userId,
      orderId,
      'sslcommerz',
    );
  }

  // Webhook should NOT require JWT
  @Post('v1/webhooks/payments/:provider')
  async webhook(@Param('provider') provider: string, @Body() body: any) {
    // For now, orgId mapping is not solved without per-channel/provider configs.
    // Enterprise approach: provider webhook is registered per org with a secret / path.
    // Temporary: accept orgId in body for dev.
    const orgId = body?.orgId;
    if (!orgId) return { ok: true, ignored: 'missing_orgId' };

    return this.payments.handleProviderWebhook(provider, orgId, body);
  }
}
