// v3
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
// apps/api/src/modules/orders/orders.controller.ts — v3
// Adds: force flag + codCollectedAmount to dispatch/deliver endpoints
// Applies same payment gate to bulk operations

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { OrdersService } from './orders.service';
import { Ctx, OrgId, UserId } from '@app/common/utils/request-context';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, OrderEntity } from './entities/order.entity';
import { RbacGuard, RequirePerm } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class StatusTransitionDto {
  /**
   * For DISPATCHED: pass force=true to proceed on a COD-only order
   *   (where nothing has been paid in advance).
   * For DELIVERED: pass force=true to deliver despite outstanding balance
   *   (creates an audit event — use sparingly).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /**
   * For DELIVERED only: amount of cash collected at the door.
   * If provided and >= balanceDue, the payment is auto-recorded before
   * status changes to DELIVERED.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  codCollectedAmount?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

// ─── Customer DTO helpers ─────────────────────────────────────────────────────

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
  return { ...rest, customer: toCustomerDto(customer) };
}

// ─── Controller ───────────────────────────────────────────────────────────────

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

  // ── Status transitions ─────────────────────────────────────────────────────

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

  /**
   * POST /v1/orders/:id/dispatch
   * Body: { force?: boolean, note?: string }
   *
   * If nothing has been paid and no advance was sent, returns 400 with
   * code: NO_PAYMENT_INITIATED — frontend shows confirmation dialog.
   * Re-send with force: true to proceed (COD-only order).
   */
  @Post(':id/dispatch')
  @RequirePerm('orders:write')
  async dispatch(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: StatusTransitionDto,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DISPATCHED,
      { force: dto.force, note: dto.note },
    );
    return toOrderDto(order);
  }

  /**
   * POST /v1/orders/:id/deliver
   * Body: { codCollectedAmount?: number, force?: boolean, note?: string }
   *
   * Cases:
   *   1. balanceDue === 0               → delivered immediately ✅
   *   2. codCollectedAmount >= balanceDue → COD recorded, then delivered ✅
   *   3. force: true                     → force-delivered, audit logged ⚠️
   *   4. none of the above               → 400 BALANCE_DUE_ON_DELIVERY
   */
  @Post(':id/deliver')
  @RequirePerm('orders:write')
  async deliver(
    @Ctx() ctx: { orgId: string; userId: string },
    @Param('id') id: string,
    @Body() dto: StatusTransitionDto,
  ) {
    const order = await this.orders.changeStatus(
      ctx.orgId,
      ctx.userId,
      id,
      OrderStatus.DELIVERED,
      {
        force: dto.force,
        codCollectedAmount: dto.codCollectedAmount,
        note: dto.note,
      },
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
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unused-vars */
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// // v2
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
// import { OrderStatus, OrderEntity } from './entities/order.entity';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// // ─── Customer DTO — no id, no orgId, no internal fields ─────────────────────

// function toCustomerDto(customer: OrderEntity['customer'] | null | undefined) {
//   if (!customer) return null;
//   return {
//     name: customer.name ?? null,
//     phone: customer.phone ?? null,
//     email: customer.email ?? null,
//     addressText: customer.addressText ?? null,
//   };
// }

// function toOrderDto(order: OrderEntity | null | undefined) {
//   if (!order) return order;
//   const { customer, conversation, events, ...rest } = order as any;
//   return {
//     ...rest,
//     customer: toCustomerDto(customer),
//   };
// }

// @Controller('v1/orders')
// @UseGuards(JwtAuthGuard, RbacGuard)
// export class OrdersController {
//   constructor(private orders: OrdersService) {}

//   @Post()
//   @RequirePerm('orders:write')
//   async create(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: CreateOrderDto,
//   ) {
//     const order = await this.orders.createOrder(ctx.orgId, ctx.userId, dto);
//     return toOrderDto(order);
//   }

//   @Get()
//   @RequirePerm('orders:read')
//   async list(
//     @Ctx() ctx: { orgId: string },
//     @Query('status') status?: OrderStatus,
//   ) {
//     const orders = await this.orders.listOrders(ctx.orgId, status);
//     return orders.map(toOrderDto);
//   }

//   @Get(':id')
//   @RequirePerm('orders:read')
//   async get(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     const order = await this.orders.getOrder(ctx.orgId, id);
//     return toOrderDto(order);
//   }

//   @Get(':id/timeline')
//   @RequirePerm('orders:read')
//   timeline(@Ctx() ctx: { orgId: string }, @Param('id') id: string) {
//     return this.orders.getTimeline(ctx.orgId, id);
//   }

//   @Post(':id/confirm')
//   @RequirePerm('orders:write')
//   async confirm(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.CONFIRMED,
//     );
//     return toOrderDto(order);
//   }

//   @Post(':id/pack')
//   @RequirePerm('orders:write')
//   async pack(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.PACKED,
//     );
//     return toOrderDto(order);
//   }

//   @Post(':id/dispatch')
//   @RequirePerm('orders:write')
//   async dispatch(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.DISPATCHED,
//     );
//     return toOrderDto(order);
//   }

//   @Post(':id/deliver')
//   @RequirePerm('orders:write')
//   async deliver(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.DELIVERED,
//     );
//     return toOrderDto(order);
//   }

//   @Post(':id/cancel')
//   @RequirePerm('orders:write')
//   async cancel(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.CANCELLED,
//     );
//     return toOrderDto(order);
//   }

//   @Post(':id/return')
//   @RequirePerm('orders:write')
//   async returned(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Param('id') id: string,
//   ) {
//     const order = await this.orders.changeStatus(
//       ctx.orgId,
//       ctx.userId,
//       id,
//       OrderStatus.RETURNED,
//     );
//     return toOrderDto(order);
//   }

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
