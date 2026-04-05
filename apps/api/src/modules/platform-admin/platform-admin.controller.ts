/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/modules/platform-admin/platform-admin.controller.ts

import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('v1/admin')
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  // ── Overview ───────────────────────────────────────────────────────────────

  @Get('overview')
  getOverview() {
    return this.service.getOverview();
  }

  // ── System health ──────────────────────────────────────────────────────────

  @Get('system')
  getSystemHealth() {
    return this.service.getSystemHealth();
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  @Get('subscriptions')
  getSubscriptions() {
    return this.service.getSubscriptions();
  }

  // ── Org list ───────────────────────────────────────────────────────────────

  @Get('orgs')
  listOrgs(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.service.listOrgs(Number(page), Number(limit), search);
  }

  // ── Single org ─────────────────────────────────────────────────────────────

  @Get('orgs/:id')
  getOrg(@Param('id') id: string) {
    return this.service.getOrg(id);
  }

  // ── Update plan ────────────────────────────────────────────────────────────
  // PATCH /v1/admin/orgs/:id/plan
  // Body: { plan: "FREE" | "PRO" | "ENTERPRISE" }

  @Patch('orgs/:id/plan')
  @HttpCode(200)
  updatePlan(
    @Param('id') id: string,
    @Body() body: { plan: string },
    @Request() req: any,
  ) {
    if (!body?.plan) throw new BadRequestException('plan is required');
    return this.service.updatePlan(id, body.plan, req.user.id);
  }

  // ── Feature flags ──────────────────────────────────────────────────────────
  // PATCH /v1/admin/orgs/:id/feature-flags
  // Body: { flags: Record<string, boolean> }
  // The frontend sends the full flags object (not a delta) so we replace, not merge.

  @Patch('orgs/:id/feature-flags')
  @HttpCode(200)
  setFeatureFlags(
    @Param('id') id: string,
    @Body() body: { flags: Record<string, boolean> },
    @Request() req: any,
  ) {
    if (!body?.flags || typeof body.flags !== 'object') {
      throw new BadRequestException('flags object is required');
    }
    return this.service.setFeatureFlags(id, body.flags, req.user.id);
  }

  // ── Toggle org active/suspended ────────────────────────────────────────────

  @Patch('orgs/:id/status')
  @HttpCode(200)
  setOrgStatus(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.service.setOrgActive(id, body.isActive);
  }

  // ── Impersonate ────────────────────────────────────────────────────────────

  @Post('orgs/:id/impersonate')
  @HttpCode(200)
  impersonate(@Param('id') id: string, @Request() req: any) {
    return this.service.impersonate(id, req.user.id);
  }
}
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/modules/platform-admin/platform-admin.controller.ts

// import {
//   Controller,
//   Get,
//   Patch,
//   Post,
//   Param,
//   Body,
//   Query,
//   UseGuards,
//   Request,
//   HttpCode,
// } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { PlatformAdminGuard } from './guards/platform-admin.guard';
// import { PlatformAdminService } from './platform-admin.service';

// // Apply both guards to every route in this controller:
// // 1. JwtAuthGuard — must be authenticated
// // 2. PlatformAdminGuard — must have isPlatformAdmin = true on JWT
// @UseGuards(JwtAuthGuard, PlatformAdminGuard)
// @Controller('v1/admin')
// export class PlatformAdminController {
//   constructor(private readonly service: PlatformAdminService) {}

//   // ── Overview ───────────────────────────────────────────────────────────────

//   @Get('overview')
//   getOverview() {
//     return this.service.getOverview();
//   }

//   // ── System health ──────────────────────────────────────────────────────────

//   @Get('system')
//   getSystemHealth() {
//     return this.service.getSystemHealth();
//   }

//   // ── Subscriptions ──────────────────────────────────────────────────────────

//   @Get('subscriptions')
//   getSubscriptions() {
//     return this.service.getSubscriptions();
//   }

//   // ── Org list ───────────────────────────────────────────────────────────────

//   @Get('orgs')
//   listOrgs(
//     @Query('page') page = '1',
//     @Query('limit') limit = '20',
//     @Query('search') search?: string,
//   ) {
//     return this.service.listOrgs(Number(page), Number(limit), search);
//   }

//   // ── Single org ─────────────────────────────────────────────────────────────

//   @Get('orgs/:id')
//   getOrg(@Param('id') id: string) {
//     return this.service.getOrg(id);
//   }

//   // ── Toggle org active/suspended ────────────────────────────────────────────

//   @Patch('orgs/:id/status')
//   @HttpCode(200)
//   setOrgStatus(@Param('id') id: string, @Body() body: { isActive: boolean }) {
//     return this.service.setOrgActive(id, body.isActive);
//   }

//   // ── Feature flags ──────────────────────────────────────────────────────────

//   @Patch('orgs/:id/feature-flags')
//   @HttpCode(200)
//   setFeatureFlags(
//     @Param('id') id: string,
//     @Body() body: Record<string, boolean>,
//   ) {
//     return this.service.setFeatureFlags(id, body);
//   }

//   // ── Impersonate ────────────────────────────────────────────────────────────

//   @Post('orgs/:id/impersonate')
//   @HttpCode(200)
//   impersonate(@Param('id') id: string, @Request() req: any) {
//     return this.service.impersonate(id, req.user.id);
//   }
// }
