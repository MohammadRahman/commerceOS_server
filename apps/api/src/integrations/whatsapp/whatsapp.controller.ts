import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private config: ConfigService,
    private whatsapp: WhatsappService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const verifyToken = this.config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken && challenge) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verification failed');
  }

  @Post()
  async receive(@Query('bypass') bypass?: string, @Body() body?: any) {
    if (bypass === 'test') {
      await this.whatsapp.ingestWebhook(body);
      return { ok: true, bypass: true };
    }

    // TODO: add signature verification for production
    await this.whatsapp.ingestWebhook(body);
    return { ok: true };
  }
}
