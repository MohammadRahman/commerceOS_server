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

    // Identify user + page
    const userId = isEcho ? recipientId : senderId;
    const pageId = isEcho ? senderId : recipientId;

    // Match channel using your actual schema
    const channel = await this.channels.findOne({
      where: [
        { pageId, status: 'ACTIVE' },
        { externalAccountId: pageId, status: 'ACTIVE' },
      ] as any,
    });

    console.log(
      '[meta] lookup pageId=',
      pageId,
      'found=',
      Boolean(channel),
      'statusWanted=ACTIVE',
    );

    if (!channel) return;

    const orgId = channel.orgId;

    // Idempotency
    const mid = evt?.message?.mid;
    const ts = evt?.timestamp ?? Date.now();

    const idemKey = mid
      ? `mid:${mid}`
      : `ts:${ts}:s:${senderId}:r:${recipientId}`;

    const claimed = await this.idem.claim(orgId, 'webhook:meta', idemKey);
    if (!claimed) return;

    // Upsert conversation
    const externalThreadId = userId;

    let convo = await this.conversations.findOne({
      where: { channelId: channel.id, externalThreadId },
    });
    console.log('[meta] pageId=', pageId, 'userId=', userId);
    console.log('[meta] channel=', channel?.id, channel?.status);

    if (!convo) {
      convo = this.conversations.create({
        orgId,
        channelId: channel.id,
        externalThreadId,
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

    const text = evt?.message?.text;

    const msg = this.messages.create({
      orgId,
      conversationId: convo.id,
      direction,
      externalMessageId: mid ?? undefined,
      messageType: 'TEXT',
      text: text ?? undefined,
      rawPayload: rawBody,
      occurredAt: new Date(ts),
    });

    await this.messages.save(msg);
  }
}
