import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import { ChannelEntity } from './entities/channel.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import {
  decodeCursor,
  encodeCursor,
  CursorPage,
} from '@app/common/utils/pagination';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private messages: Repository<MessageEntity>,
  ) {}

  async listChannels(orgId: string) {
    return this.channels.find({
      where: { orgId },
      order: { createdAt: 'DESC' },
    });
  }

  async listConversations(params: {
    orgId: string;
    channelId?: string;
    limit: number;
    cursor?: string;
  }): Promise<CursorPage<ConversationEntity>> {
    const { orgId, channelId, limit, cursor } = params;

    const qb = this.conversations
      .createQueryBuilder('c')
      .where('c.org_id = :orgId', { orgId });

    if (channelId) {
      qb.andWhere('c.channel_id = :channelId', { channelId });
    }

    // Sort by lastMessageAt desc, fallback to createdAt desc for new/empty convos
    // We’ll use createdAt as stable cursor key to keep it simple for now:
    // Enterprise improvement later: a computed "sortAt" column.
    qb.orderBy('c.created_at', 'DESC').addOrderBy('c.id', 'DESC');

    if (cursor) {
      const { occurredAt, id } = decodeCursor(cursor);
      qb.andWhere(
        new Brackets((w) => {
          w.where('c.created_at < :t', { t: occurredAt.toISOString() }).orWhere(
            'c.created_at = :t AND c.id < :id',
            { t: occurredAt.toISOString(), id },
          );
        }),
      );
    }

    qb.take(limit + 1);

    const rows = await qb.getMany();
    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;

    const nextCursor = hasNext
      ? encodeCursor(
          items[items.length - 1].createdAt,
          items[items.length - 1].id,
        )
      : null;

    return { items, nextCursor };
  }

  async listMessages(params: {
    orgId: string;
    conversationId: string;
    limit: number;
    cursor?: string;
  }): Promise<CursorPage<MessageEntity>> {
    const { orgId, conversationId, limit, cursor } = params;

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.org_id = :orgId', { orgId })
      .andWhere('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.occurred_at', 'DESC')
      .addOrderBy('m.id', 'DESC');

    if (cursor) {
      const { occurredAt, id } = decodeCursor(cursor);
      qb.andWhere(
        new Brackets((w) => {
          w.where('m.occurred_at < :t', {
            t: occurredAt.toISOString(),
          }).orWhere('m.occurred_at = :t AND m.id < :id', {
            t: occurredAt.toISOString(),
            id,
          });
        }),
      );
    }

    qb.take(limit + 1);

    const rows = await qb.getMany();
    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;

    const nextCursor = hasNext
      ? encodeCursor(
          items[items.length - 1].occurredAt,
          items[items.length - 1].id,
        )
      : null;

    return { items, nextCursor };
  }
}
