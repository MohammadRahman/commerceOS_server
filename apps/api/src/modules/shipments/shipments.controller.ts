/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { Ctx } from '@app/common/utils/request-context';
import { BookShipmentDto } from './dto/book-shipment.dto';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class ShipmentsController {
  constructor(private shipments: ShipmentsService) {}

  @Post('v1/orders/:id/shipments')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequirePerm('shipments:write')
  book(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') orderId: string,
    @Body() dto: BookShipmentDto,
  ) {
    return this.shipments.bookShipment(ctx.orgId, ctx.userId, orderId, dto);
  }

  // Courier webhook should not require JWT
  @Post('v1/webhooks/couriers/:provider')
  async webhook(@Param('provider') provider: string, @Body() body: any) {
    // temporary dev: orgId passed in body (we’ll fix with signed webhook URLs later)
    const orgId = body?.orgId;
    if (!orgId) return { ok: true, ignored: 'missing_orgId' };

    return this.shipments.handleCourierWebhook(provider, orgId, body);
  }
}
