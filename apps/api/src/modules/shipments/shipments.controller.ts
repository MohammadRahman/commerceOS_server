/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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

  @Get('v1/shipments/:id')
  @UseGuards(JwtAuthGuard)
  getShipment(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.shipments.getShipment(ctx.orgId, id);
  }

  @Post('v1/shipments/:id/track')
  @UseGuards(JwtAuthGuard)
  track(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.shipments.trackShipment(ctx.orgId, id);
  }

  @Post('v1/shipments/:id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.shipments.cancelShipment(ctx.orgId, id);
  }

  @Get('v1/couriers/:provider/zones')
  @UseGuards(JwtAuthGuard)
  zones(
    @Ctx() ctx: { orgId: string },
    @Param('provider') provider: string,
    @Query('cityId') cityId?: string,
    @Query('zoneId') zoneId?: string,
  ) {
    return this.shipments.getZones(ctx.orgId, provider, { cityId, zoneId });
  }

  @Post('v1/couriers/:provider/calculate')
  @UseGuards(JwtAuthGuard)
  calculate(
    @Ctx() ctx: { orgId: string },
    @Param('provider') provider: string,
    @Body() body: any,
  ) {
    return this.shipments.calculateCharge(ctx.orgId, provider, body);
  }
}
