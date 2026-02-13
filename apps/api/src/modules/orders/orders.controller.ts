import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Ctx } from '@app/common/utils/request-context';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from './entities/order.entity';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/orders')
@UseGuards(JwtAuthGuard, RbacGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  @RequirePerm('orders:write')
  create(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.createOrder(ctx.orgId, ctx.userId, dto);
  }

  @Get()
  @RequirePerm('orders:read')
  list(@Ctx() ctx: { orgId: string }, @Query('status') status?: OrderStatus) {
    return this.orders.listOrders(ctx.orgId, status);
  }

  @Get(':id')
  @RequirePerm('orders:read')
  get(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.orders.getOrder(ctx.orgId, id);
  }

  @Get(':id/timeline')
  @RequirePerm('orders:read')
  timeline(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.orders.getTimeline(ctx.orgId, id);
  }

  // Command endpoints (enterprise)
  @Post(':id/confirm')
  @RequirePerm('orders:write')
  confirm(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.CONFIRMED,
    );
  }

  @Post(':id/pack')
  @RequirePerm('orders:write')
  pack(@Ctx() ctx: { orgId: string; userId: string }, @Param('id') id: string) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.PACKED,
    );
  }

  @Post(':id/dispatch')
  @RequirePerm('orders:write')
  dispatch(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DISPATCHED,
    );
  }

  @Post(':id/deliver')
  @RequirePerm('orders:write')
  deliver(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DELIVERED,
    );
  }

  @Post(':id/cancel')
  @RequirePerm('orders:write')
  cancel(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.CANCELLED,
    );
  }

  @Post(':id/return')
  @RequirePerm('orders:write')
  returned(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    return this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.RETURNED,
    );
  }
}
