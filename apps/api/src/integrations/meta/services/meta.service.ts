/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IdempotencyService } from '@app/common';
import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import {
  MessageEntity,
  MessageDirection,
} from 'apps/api/src/modules/inbox/entities/message.entity';
import { InboxGateway } from '../gateway/inbox.gateway';

type MetaMessagingEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
  };
};

@Injectable()
export class MetaService {
  constructor(
    private idem: IdempotencyService,
    private gateway: InboxGateway,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private messages: Repository<MessageEntity>,
  ) {}

  async ingestWebhook(body: any) {
    console.log('[meta-service] THIS IS services/meta.service.ts');

    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      const events: MetaMessagingEvent[] = Array.isArray(entry?.messaging)
        ? entry.messaging
        : [];

      for (const evt of events) {
        await this.ingestMessagingEvent(evt, body);
      }
    }
  }

  private async ingestMessagingEvent(evt: MetaMessagingEvent, rawBody: any) {
    const senderId = evt?.sender?.id;
    const recipientId = evt?.recipient?.id;
    if (!senderId || !recipientId) return;

    const isEcho = Boolean(evt?.message?.is_echo);
    const userId = isEcho ? recipientId : senderId;
    const pageId = isEcho ? senderId : recipientId;

    // ✅ Find ALL active channels matching this pageId — not just one
    const channels = await this.channels.find({
      where: [
        { pageId, status: 'ACTIVE' as any },
        { externalAccountId: pageId, status: 'ACTIVE' as any },
      ],
    });

    console.log(
      '[meta] lookup pageId=',
      pageId,
      'found=',
      channels.length,
      'channels',
    );

    if (!channels.length) return;

    const mid = evt?.message?.mid;
    const ts = evt?.timestamp ?? Date.now();

    // ✅ Process for each org that has this page connected
    for (const channel of channels) {
      const orgId = channel.orgId;

      const idemKey = mid
        ? `mid:${mid}:org:${orgId}` // ← scope idempotency per org too
        : `ts:${ts}:s:${senderId}:r:${recipientId}:org:${orgId}`;

      const claimed = await this.idem.claim(orgId, 'webhook:meta', idemKey);
      if (!claimed) continue;

      let convo = await this.conversations.findOne({
        where: { channelId: channel.id, externalThreadId: userId },
      });

      if (!convo) {
        convo = this.conversations.create({
          orgId,
          channelId: channel.id,
          externalThreadId: userId,
          externalUserId: userId,
          lastMessageAt: new Date(ts),
        });
        convo = await this.conversations.save(convo);
      } else {
        await this.conversations.update(
          { id: convo.id, orgId },
          { lastMessageAt: new Date(ts) },
        );
      }

      const direction = isEcho ? MessageDirection.OUT : MessageDirection.IN;
      const msg = this.messages.create({
        orgId,
        conversationId: convo.id,
        direction,
        externalMessageId: mid ?? undefined,
        messageType: 'TEXT',
        text: evt?.message?.text ?? undefined,
        rawPayload: rawBody,
        occurredAt: new Date(ts),
      });
      await this.messages.save(msg);
      // for socket.io
      this.gateway.emitNewMessage(orgId, {
        conversationId: convo.id,
        message: {
          id: msg.id,
          direction: msg.direction,
          messageType: msg.messageType,
          text: msg.text ?? null,
          occurredAt: msg.occurredAt,
          createdAt: msg.createdAt,
        },
        conversation: {
          id: convo.id,
          lastMessageAt: new Date(ts),
        },
      });

      console.log('[meta] saved message for orgId=', orgId);
    }
  }
}
