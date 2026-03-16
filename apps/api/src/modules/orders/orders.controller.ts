/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
// v2
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
import { Ctx, OrgId, UserId } from '@app/common/utils/request-context';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, OrderEntity } from './entities/order.entity';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// ─── Customer DTO — no id, no orgId, no internal fields ─────────────────────

function toCustomerDto(customer: OrderEntity['customer'] | null | undefined) {
  if (!customer) return null;
  return {
    name: customer.name ?? null,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    addressText: customer.addressText ?? null,
  };
}

function toOrderDto(order: OrderEntity | null | undefined) {
  if (!order) return order;
  const { customer, conversation, events, ...rest } = order as any;
  return {
    ...rest,
    customer: toCustomerDto(customer),
  };
}

@Controller('v1/orders')
@UseGuards(JwtAuthGuard, RbacGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post()
  @RequirePerm('orders:write')
  async create(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: CreateOrderDto,
  ) {
    const order = await this.orders.createOrder(ctx.orgId, ctx.userId, dto);
    return toOrderDto(order);
  }

  @Get()
  @RequirePerm('orders:read')
  async list(
    @Ctx() ctx: { orgId: string },
    @Query('status') status?: OrderStatus,
  ) {
    const orders = await this.orders.listOrders(ctx.orgId, status);
    return orders.map(toOrderDto);
  }

  @Get(':id')
  @RequirePerm('orders:read')
  async get(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    const order = await this.orders.getOrder(ctx.orgId, id);
    return toOrderDto(order);
  }

  @Get(':id/timeline')
  @RequirePerm('orders:read')
  timeline(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
    return this.orders.getTimeline(ctx.orgId, id);
  }

  @Post(':id/confirm')
  @RequirePerm('orders:write')
  async confirm(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.CONFIRMED,
    );
    return toOrderDto(order);
  }

  @Post(':id/pack')
  @RequirePerm('orders:write')
  async pack(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.PACKED,
    );
    return toOrderDto(order);
  }

  @Post(':id/dispatch')
  @RequirePerm('orders:write')
  async dispatch(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DISPATCHED,
    );
    return toOrderDto(order);
  }

  @Post(':id/deliver')
  @RequirePerm('orders:write')
  async deliver(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DELIVERED,
    );
    return toOrderDto(order);
  }

  @Post(':id/cancel')
  @RequirePerm('orders:write')
  async cancel(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.CANCELLED,
    );
    return toOrderDto(order);
  }

  @Post(':id/return')
  @RequirePerm('orders:write')
  async returned(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.RETURNED,
    );
    return toOrderDto(order);
  }

  @Post(':id/cod-collected')
  @UseGuards(JwtAuthGuard)
  collectCod(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Param('id') orderId: string,
    @Body() body: { collectedAmount: number; note?: string },
  ) {
    return this.orders.recordCodCollection(
      orgId,
      userId,
      orderId,
      body.collectedAmount,
      body.note,
    );
  }
}
// import {
//   Body,
//   Controller,
//   Get,
//   Param,
//   Post,
//   Query,
//   UseGuards,
// } from '@nestjs/common';
// import { OrdersService } from './orders.service';
// import { Ctx, OrgId, UserId } from '@app/common/utils/request-context';
// import { CreateOrderDto } from './dto/create-order.dto';
// import { OrderStatus } from './entities/order.entity';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// @Controller('v1/orders')
// @UseGuards(JwtAuthGuard, RbacGuard)
// export class OrdersController {
//   constructor(private orders: OrdersService) {}

//   @Post()
//   @RequirePerm('orders:write')
//   create(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: CreateOrderDto,
//   ) {
//     return this.orders.createOrder(ctx.orgId, ctx.userId, dto);
//   }

//   @Get()
//   @RequirePerm('orders:read')
//   list(@Ctx() ctx: { orgId: string }, @Query('status') status?: OrderStatus) {
//     return this.orders.listOrders(ctx.orgId, status);
//   }

//   @Get(':id')
//   @RequirePerm('orders:read')
//   get(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     return this.orders.getOrder(ctx.orgId, id);
//   }

//   @Get(':id/timeline')
//   @RequirePerm('orders:read')
//   timeline(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     return this.orders.getTimeline(ctx.orgId, id);
//   }

//   // Command endpoints (enterprise)
//   @Post(':id/confirm')
//   @RequirePerm('orders:write')
//   confirm(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.CONFIRMED,
//     );
//   }

//   @Post(':id/pack')
//   @RequirePerm('orders:write')
//   pack(@Ctx() ctx: { orgId: string; userId: string }, @Param('id') id: string) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.PACKED,
//     );
//   }

//   @Post(':id/dispatch')
//   @RequirePerm('orders:write')
//   dispatch(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.DISPATCHED,
//     );
//   }

//   @Post(':id/deliver')
//   @RequirePerm('orders:write')
//   deliver(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.DELIVERED,
//     );
//   }

//   @Post(':id/cancel')
//   @RequirePerm('orders:write')
//   cancel(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.CANCELLED,
//     );
//   }

//   @Post(':id/return')
//   @RequirePerm('orders:write')
//   returned(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     return this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.RETURNED,
//     );
//   }
//   // newly added endpoint for COD collection recording
//   @Post(':id/cod-collected')
//   @UseGuards(JwtAuthGuard)
//   collectCod(
//     @OrgId() orgId: string,
//     @UserId() userId: string,
//     @Param('id') orderId: string,
//     @Body() body: { collectedAmount: number; note?: string },
//   ) {
//     return this.orders.recordCodCollection(
//       orgId,
//       userId,
//       orderId,
//       body.collectedAmount,
//       body.note,
//     );
//   }
// }
