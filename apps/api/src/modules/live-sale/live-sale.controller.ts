/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/live-sale/live-sale.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as liveSaleService from './live-sale.service';

@Controller('v1/live')
@UseGuards(JwtAuthGuard)
export class LiveSaleController {
  constructor(private readonly svc: liveSaleService.LiveSaleService) {}

  // ── Sessions ───────────────────────────────────────────────────────────────

  @Get('sessions')
  listSessions(@Request() req: any) {
    return this.svc.listSessions(req.user.orgId);
  }

  @Post('sessions')
  startSession(
    @Request() req: any,
    @Body() body: liveSaleService.StartLiveSaleDto,
  ) {
    return this.svc.startSession(req.user.orgId, body);
  }

  @Get('sessions/:id')
  getSession(@Request() req: any, @Param('id') id: string) {
    return this.svc.getSession(req.user.orgId, id);
  }

  @Get('sessions/by-post/:postId')
  getActiveSession(@Request() req: any, @Param('postId') postId: string) {
    return this.svc.getActiveSession(req.user.orgId, postId);
  }

  @Patch('sessions/:id/end')
  endSession(@Request() req: any, @Param('id') id: string) {
    return this.svc.endSession(req.user.orgId, id);
  }

  @Get('sessions/:id/stats')
  getStats(@Request() req: any, @Param('id') id: string) {
    return this.svc.getStats(req.user.orgId, id);
  }

  // ── Product queue ──────────────────────────────────────────────────────────

  @Post('sessions/:id/products/catalog/:productId')
  addFromCatalog(
    @Request() req: any,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.svc.addProductFromCatalog(req.user.orgId, id, productId);
  }

  @Post('sessions/:id/products/quick-add')
  quickAdd(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: liveSaleService.QuickAddProductDto,
  ) {
    return this.svc.quickAddProduct(req.user.orgId, id, body);
  }

  @Put('sessions/:id/queue')
  updateQueue(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: liveSaleService.UpdateQueueDto,
  ) {
    return this.svc.updateQueue(req.user.orgId, id, body);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  @Post('sessions/:id/products/:productId/announce')
  announceProduct(
    @Request() req: any,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() body: { customText?: string },
  ) {
    return this.svc.announceProduct(
      req.user.orgId,
      id,
      productId,
      body.customText,
    );
  }

  @Post('sessions/:id/products/:productId/sold-out')
  markSoldOut(
    @Request() req: any,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.svc.markSoldOut(req.user.orgId, id, productId);
  }
}
