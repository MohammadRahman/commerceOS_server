// apps/api/src/modules/orders/bulk-orders.controller.ts — v2
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RbacGuard, RequirePerm } from '@app/common';
import { Ctx } from '@app/common/utils/request-context';
import { BulkOrdersService } from './bulk-orders.service';
import {
  BulkOrderIdsDto,
  BulkStatusDto,
  BulkCourierDto,
  BulkPaymentLinkDto,
} from './dto/bulk-order.dto';

class BulkStatusWithForceDto extends BulkStatusDto {
  /** Pass force=true to override payment gate (COD-only or operator override) */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller('v1/orders/bulk')
@UseGuards(JwtAuthGuard, RbacGuard)
export class BulkOrdersController {
  constructor(private readonly bulk: BulkOrdersService) {}

  @Post('confirm')
  @HttpCode(200)
  @RequirePerm('orders:write')
  confirm(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: BulkOrderIdsDto,
  ) {
    return this.bulk.bulkConfirm(ctx.orgId, ctx.userId, dto.orderIds);
  }

  @Post('status')
  @HttpCode(200)
  @RequirePerm('orders:write')
  status(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: BulkStatusWithForceDto,
  ) {
    return this.bulk.bulkChangeStatus(
      ctx.orgId,
      ctx.userId,
      dto.orderIds,
      dto.status,
      dto.force ?? false,
    );
  }

  @Post('courier')
  @HttpCode(200)
  @RequirePerm('orders:write')
  courier(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: BulkCourierDto,
  ) {
    return this.bulk.bulkBookCourier(
      ctx.orgId,
      ctx.userId,
      dto.orderIds,
      dto.provider,
      dto.serviceType,
    );
  }

  @Post('payment-links')
  @HttpCode(200)
  @RequirePerm('orders:write')
  paymentLinks(
    @Ctx() ctx: { orgId: string; userId: string },
    @Body() dto: BulkPaymentLinkDto,
  ) {
    return this.bulk.bulkCreatePaymentLinks(
      ctx.orgId,
      ctx.userId,
      dto.orderIds,
      dto.provider,
      dto.deliveryFee,
    );
  }

  @Post('invoice')
  @HttpCode(200)
  @RequirePerm('orders:read')
  invoice(@Ctx() ctx: { orgId: string }, @Body() dto: BulkOrderIdsDto) {
    return this.bulk.bulkGetInvoiceData(ctx.orgId, dto.orderIds);
  }
}
// /* eslint-disable @typescript-eslint/no-unsafe-return */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/modules/orders/bulk-orders.controller.ts
// import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RbacGuard, RequirePerm } from '@app/common';
// import { Ctx } from '@app/common/utils/request-context';
// import { BulkOrdersService } from './bulk-orders.service';
// import {
//   BulkOrderIdsDto,
//   BulkStatusDto,
//   BulkCourierDto,
//   BulkPaymentLinkDto,
// } from './dto/bulk-order.dto';

// @Controller('v1/orders/bulk')
// @UseGuards(JwtAuthGuard, RbacGuard)
// export class BulkOrdersController {
//   constructor(private readonly bulk: BulkOrdersService) {}

//   /**
//    * POST /v1/orders/bulk/confirm
//    * Confirm multiple NEW orders in one request.
//    */
//   @Post('confirm')
//   @HttpCode(200)
//   @RequirePerm('orders:write')
//   confirm(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: BulkOrderIdsDto,
//   ) {
//     return this.bulk.bulkConfirm(ctx.orgId, ctx.userId, dto.orderIds);
//   }

//   /**
//    * POST /v1/orders/bulk/status
//    * Transition multiple orders to a given status.
//    * Validates each transition individually — invalid ones fail gracefully.
//    */
//   @Post('status')
//   @HttpCode(200)
//   @RequirePerm('orders:write')
//   status(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: BulkStatusDto,
//   ) {
//     return this.bulk.bulkChangeStatus(
//       ctx.orgId,
//       ctx.userId,
//       dto.orderIds,
//       dto.status,
//     );
//   }

//   /**
//    * POST /v1/orders/bulk/courier
//    * Book a courier for multiple PACKED orders.
//    * Orders not in PACKED status are rejected individually.
//    */
//   @Post('courier')
//   @HttpCode(200)
//   @RequirePerm('orders:write')
//   courier(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: BulkCourierDto,
//   ) {
//     return this.bulk.bulkBookCourier(
//       ctx.orgId,
//       ctx.userId,
//       dto.orderIds,
//       dto.provider,
//       dto.serviceType,
//     );
//   }

//   /**
//    * POST /v1/orders/bulk/payment-links
//    * Generate payment links for multiple orders.
//    * Skips terminal or already-paid orders with a per-order reason.
//    */
//   @Post('payment-links')
//   @HttpCode(200)
//   @RequirePerm('orders:write')
//   paymentLinks(
//     @Ctx() ctx: { orgId: string; userId: string },
//     @Body() dto: BulkPaymentLinkDto,
//   ) {
//     return this.bulk.bulkCreatePaymentLinks(
//       ctx.orgId,
//       ctx.userId,
//       dto.orderIds,
//       dto.provider,
//       dto.deliveryFee,
//     );
//   }

//   /**
//    * POST /v1/orders/bulk/invoice
//    * Return structured invoice data for multiple orders.
//    * Frontend renders to PDF.
//    */
//   @Post('invoice')
//   @HttpCode(200)
//   @RequirePerm('orders:read')
//   invoice(@Ctx() ctx: { orgId: string }, @Body() dto: BulkOrderIdsDto) {
//     return this.bulk.bulkGetInvoiceData(ctx.orgId, dto.orderIds);
//   }
// }
