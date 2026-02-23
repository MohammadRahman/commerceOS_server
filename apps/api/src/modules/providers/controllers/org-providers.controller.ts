import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Ctx } from '@app/common'; // your ctx decorator
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UpdateOrgProviderDto } from '../dto/update-org-provider.dto';
import { OrgProvidersService } from '../services/org-providers.service';
import { CourierProviderType } from '../entities/courier-provider-catalog.entity';

@Controller('v1/org/providers')
@UseGuards(JwtAuthGuard)
export class OrgProvidersController {
  constructor(private orgProviders: OrgProvidersService) {}

  // GET /v1/org/providers/payments
  @Get('payments')
  listPayments(@Ctx() ctx: { orgId: string }) {
    return this.orgProviders.listOrgPayments(ctx.orgId);
  }

  // GET /v1/org/providers/couriers
  @Get('couriers')
  listCouriers(@Ctx() ctx: { orgId: string }) {
    return this.orgProviders.listOrgCouriers(ctx.orgId);
  }

  // PATCH /v1/org/providers/payments/:type
  @Patch('payments/:type')
  updatePayment(
    @Ctx() ctx: { orgId: string },
    @Body() dto: UpdateOrgProviderDto,
  ) {
    return this.orgProviders.upsertPayment(ctx.orgId, dto);
  }

  // PATCH /v1/org/providers/couriers/:type
  @Patch('couriers/:type')
  updateCourier(
    @Ctx() ctx: { orgId: string },
    @Param('type') type: CourierProviderType,
    @Body() dto: UpdateOrgProviderDto,
  ) {
    return this.orgProviders.upsertOrgCourier(ctx.orgId, type, dto);
  }
}
