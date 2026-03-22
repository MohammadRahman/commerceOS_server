/* eslint-disable @typescript-eslint/no-unsafe-return */
// apps/api/src/integrations/whatsapp/whatsapp.controller.ts — v3
// Added: /v1/channels/whatsapp/embedded-signup for Embedded Signup flow
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { Ctx } from '@app/common/utils/request-context';

@Controller()
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private config: ConfigService,
    private whatsapp: WhatsappService,
  ) {}

  @Get('webhooks/whatsapp')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const verifyToken = this.config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken && challenge)
      return challenge;
    throw new UnauthorizedException('Webhook verification failed');
  }

  @Post('webhooks/whatsapp')
  async receive(@Body() body?: any) {
    await this.whatsapp.ingestWebhook(body);
    return { ok: true };
  }

  // ── Embedded Signup — called after Meta popup returns code ────────────────
  @Post('v1/channels/whatsapp/embedded-signup')
  @UseGuards(JwtAuthGuard)
  embeddedSignup(
    @Ctx() ctx: { orgId: string },
    @Body() body: { code: string; wabaId?: string; phoneNumberId?: string },
  ) {
    return this.whatsapp.handleEmbeddedSignup(
      ctx.orgId,
      body.code,
      body.wabaId,
      body.phoneNumberId,
    );
  }

  // ── Manual registration (fallback for developers) ─────────────────────────
  @Post('v1/channels/whatsapp')
  @UseGuards(JwtAuthGuard)
  async registerChannel(
    @Ctx() ctx: { orgId: string },
    @Body()
    body: { phoneNumberId: string; displayName: string; wabaId?: string },
  ) {
    return this.whatsapp.registerChannel(
      ctx.orgId,
      body.phoneNumberId,
      body.displayName,
      body.wabaId,
    );
  }

  @Post('v1/channels/whatsapp/disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnectChannel(@Ctx() ctx: { orgId: string }) {
    return this.whatsapp.disconnectChannel(ctx.orgId);
  }
}
// import {
//   Body,
//   Controller,
//   Get,
//   Post,
//   Query,
//   UnauthorizedException,
//   Logger,
// } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { WhatsappService } from './whatsapp.service';

// @Controller('webhooks/whatsapp')
// export class WhatsappController {
//   private readonly logger = new Logger(WhatsappController.name);

//   constructor(
//     private config: ConfigService,
//     private whatsapp: WhatsappService,
//   ) {}

//   @Get()
//   verify(
//     @Query('hub.mode') mode?: string,
//     @Query('hub.verify_token') token?: string,
//     @Query('hub.challenge') challenge?: string,
//   ) {
//     const verifyToken = this.config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
//     if (mode === 'subscribe' && token === verifyToken && challenge) {
//       return challenge;
//     }
//     throw new UnauthorizedException('Webhook verification failed');
//   }

//   @Post()
//   async receive(@Query('bypass') bypass?: string, @Body() body?: any) {
//     if (bypass === 'test') {
//       await this.whatsapp.ingestWebhook(body);
//       return { ok: true, bypass: true };
//     }

//     // TODO: add signature verification for production
//     await this.whatsapp.ingestWebhook(body);
//     return { ok: true };
//   }
// }
