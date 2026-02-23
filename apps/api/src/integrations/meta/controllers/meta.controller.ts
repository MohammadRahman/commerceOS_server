/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Logger } from '@nestjs/common';

import { verifyMetaSignature } from '@app/common/utils/webhook-signature';
import { MetaService } from '../services/meta.service';

@Controller('webhooks/meta')
export class MetaController {
  private readonly logger = new Logger(MetaController.name);
  constructor(
    private config: ConfigService,
    private meta: MetaService,
  ) {}

  // Meta verification handshake
  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    console.log(
      '[webhook-verify] mode=',
      mode,
      'token=',
      token,
      'challenge=',
      challenge,
    );
    const verifyToken = this.config.getOrThrow<string>('META_VERIFY_TOKEN');
    console.log('[webhook-verify] expected token=', verifyToken);

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verification failed');
  }
  // @Get()
  // verify(
  //   @Query('hub.mode') mode?: string,
  //   @Query('hub.verify_token') token?: string,
  //   @Query('hub.challenge') challenge?: string,
  // ) {
  //   const verifyToken = this.config.getOrThrow<string>('META_VERIFY_TOKEN');

  //   if (mode === 'subscribe' && token === verifyToken && challenge) {
  //     return challenge;
  //   }

  //   throw new UnauthorizedException('Webhook verification failed');
  // }

  @Post()
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature?: string,
    @Query('bypass') bypass?: string,
    @Body() body?: any,
  ) {
    // ✅ check bypass param, not signature
    if (bypass === 'test') {
      console.log('[webhook] bypass mode — skipping signature');
      await this.meta.ingestWebhook(body);
      return { ok: true, bypass: true };
    }

    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
    const rawBody = (req as any).rawBody;

    if (!rawBody) {
      throw new BadRequestException(
        'Missing rawBody for signature verification',
      );
    }

    const ok = verifyMetaSignature({
      rawBody,
      appSecret,
      headerValue: signature,
    });
    if (!ok) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.meta.ingestWebhook(body);
    return { ok: true };
  }
  // @Post()
  // async receive(
  //   @Req() req: Request & { rawBody?: Buffer },
  //   @Headers('x-hub-signature-256') signature?: string,
  //   @Body() body?: any,
  // ) {
  //   const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');

  //   const rawBody = (req as any).rawBody;
  //   if (!rawBody) {
  //     throw new BadRequestException(
  //       'Missing rawBody for signature verification',
  //     );
  //   }
  //   // remove in production
  //   if (signature === 'test') {
  //     await this.meta.ingestWebhook(body);
  //     return { ok: true, bypass: true };
  //   }
  //   const ok = verifyMetaSignature({
  //     rawBody,
  //     appSecret,
  //     headerValue: signature,
  //   });

  //   if (!ok) {
  //     throw new UnauthorizedException('Invalid webhook signature');
  //   }
  //   console.log('first', ok);
  //   await this.meta.ingestWebhook(body);
  //   return { ok: true };
  // }
}
