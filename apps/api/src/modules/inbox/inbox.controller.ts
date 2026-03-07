/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InboxService } from './inbox.service';
import { Ctx } from '@app/common/utils/request-context';
import { RbacGuard, RequirePerm, UuidParamPipe } from '@app/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1')
@UseGuards(JwtAuthGuard, RbacGuard)
export class InboxController {
  constructor(private inbox: InboxService) {}

  @Get('channels')
  @RequirePerm('inbox:read')
  async listChannels(@Ctx() ctx: { orgId: string }) {
    return this.inbox.listChannels(ctx.orgId);
  }

  @Get('conversations')
  @RequirePerm('inbox:read')
  async listConversations(
    @Ctx() ctx: { orgId: string },
    @Query('channelId') channelId?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.listConversations({
      orgId: ctx.orgId,
      channelId,
      limit: Math.min(Math.max(Number(limit ?? 20), 1), 100),
      cursor,
    });
  }

  @Get('conversations/:id/messages')
  @RequirePerm('inbox:read')
  async listMessages(
    @Ctx() ctx: { orgId: string },
    @Param('id', new UuidParamPipe('conversationId')) conversationId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.inbox.listMessages({
      orgId: ctx.orgId,
      conversationId,
      limit: Math.min(Math.max(Number(limit ?? 50), 1), 200),
      cursor,
    });
  }

  @Post('webhooks/meta')
  metaWebhook(@Req() _req: Request, @Body() _body: any) {
    // For now: accept and log minimal
    // Later: signature verify + enqueue ingestion job
    return { ok: true };
  }
}
