/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// inbox.controller.ts

import { Ctx } from '@app/common';
import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  Logger,
  UseGuards,
  Post,
  Body,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtAuthGuard } from 'apps/api/src/modules/auth/guards/jwt-auth.guard';
import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import { MessageEntity } from 'apps/api/src/modules/inbox/entities/message.entity';
import { Repository } from 'typeorm';
import {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageDto,
} from '../dto/inbox.dto';
import { InboxService } from '../services/inbox.service';

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller('v1/inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  private readonly logger = new Logger(InboxController.name);

  constructor(
    private readonly inboxService: InboxService,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private messages: Repository<MessageEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
  ) {}

  // ── GET /v1/inbox/conversations ───────────────────────────────────────────

  @Get('conversations')
  async listConversations(
    @Ctx() ctx: { orgId: string },
    @Query() query: ListConversationsQuery,
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const qb = this.conversations
      .createQueryBuilder('c')
      .where('c.orgId = :orgId', { orgId: ctx.orgId })
      .leftJoinAndSelect('c.channel', 'channel')
      .orderBy('c.lastMessageAt', 'DESC')
      .skip(skip)
      .take(limit);

    // Optional filters
    if (query.status) {
      qb.andWhere('c.status = :status', { status: query.status });
    }

    if (query.channel) {
      qb.andWhere('channel.type = :channelType', {
        channelType: query.channel.toUpperCase(),
      });
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map((c) => ({
        id: c.id,
        externalThreadId: c.externalThreadId,
        externalUserId: c.externalUserId,
        status: c.status ?? 'open',
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
        channel: c.channel
          ? {
              id: c.channel.id,
              type: c.channel.type,
              name:
                c.channel.pageId ??
                c.channel.externalAccountId ??
                c.channel.type,
            }
          : null,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }
  // ── GET /v1/inbox/conversations/:id/messages ──────────────────────────────

  @Get('conversations/:id/messages')
  async listMessages(
    @Ctx() ctx: { orgId: string },
    @Param('id') conversationId: string,
    @Query() query: ListMessagesQuery,
  ) {
    // Verify the conversation belongs to this org — never trust the ID alone
    const conversation = await this.conversations.findOne({
      where: { id: conversationId, orgId: ctx.orgId } as any,
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', { conversationId })
      .andWhere('m.orgId = :orgId', { orgId: ctx.orgId })
      .orderBy('m.occurredAt', 'ASC')
      .skip(skip)
      .take(limit);

    // Cursor-style: return messages before a given timestamp
    if (query.before) {
      const before = new Date(query.before);
      if (!isNaN(before.getTime())) {
        qb.andWhere('m.occurredAt < :before', { before });
      }
    }

    const [rows, total] = await qb.getManyAndCount();

    return {
      conversation: {
        id: conversation.id,
        externalUserId: conversation.externalUserId,
        status: conversation.status,
        lastMessageAt: conversation.lastMessageAt,
      },
      data: rows.map((m) => ({
        id: m.id,
        direction: m.direction, // "IN" | "OUT"
        messageType: m.messageType, // "TEXT" etc.
        text: m.text ?? null,
        // status: c.status ?? 'open',
        externalMessageId: m.externalMessageId ?? null,
        occurredAt: m.occurredAt,
        createdAt: m.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }
  @Post('conversations/:id/messages')
  sendMessage(
    @Ctx() ctx: { orgId: string },
    @Param('id') conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.inboxService.sendMessage(ctx.orgId, conversationId, body.text);
  }
}
