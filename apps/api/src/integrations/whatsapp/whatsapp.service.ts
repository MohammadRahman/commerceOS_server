/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import {
  ChannelEntity,
  ChannelType,
} from '../../modules/inbox/entities/channel.entity';
import { ConversationEntity } from '../../modules/inbox/entities/conversation.entity';
import {
  MessageEntity,
  MessageDirection,
} from '../../modules/inbox/entities/message.entity';
import { IdempotencyService } from '@app/common';
import { InboxGateway } from '../meta/gateway/inbox.gateway';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private config: ConfigService,
    private http: HttpService,
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
    this.logger.log('[whatsapp] ingestWebhook called');

    const entries = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (change?.field !== 'messages') continue;
        const value = change?.value;
        await this.ingestMessages(value);
      }
    }
  }

  private async ingestMessages(value: any) {
    const phoneNumberId = value?.metadata?.phone_number_id;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

    if (!phoneNumberId || !messages.length) return;

    // Find channel by phone number ID
    const channel = await this.channels.findOne({
      where: {
        type: ChannelType.WHATSAPP as any,
        externalAccountId: phoneNumberId,
        status: 'ACTIVE',
      } as any,
    });

    this.logger.log(
      `[whatsapp] phoneNumberId=${phoneNumberId} found=${Boolean(channel)}`,
    );

    if (!channel) return;

    const orgId = channel.orgId;

    for (const msg of messages) {
      const from = msg?.from; // customer's whatsapp number
      const mid = msg?.id;
      const ts = msg?.timestamp
        ? new Date(Number(msg.timestamp) * 1000)
        : new Date();
      const text = msg?.text?.body ?? null;
      const type = msg?.type ?? 'text';

      if (!from || !mid) continue;

      // Idempotency
      const claimed = await this.idem.claim(
        orgId,
        'webhook:whatsapp',
        `mid:${mid}`,
      );
      if (!claimed) continue;

      // Get contact name if available
      const contact = contacts.find((c: any) => c.wa_id === from);
      const displayName = contact?.profile?.name ?? from;

      // Upsert conversation
      let convo = await this.conversations.findOne({
        where: { channelId: channel.id, externalThreadId: from },
      });

      if (!convo) {
        convo = this.conversations.create({
          orgId,
          channelId: channel.id,
          externalThreadId: from,
          externalUserId: from,
          lastMessageAt: ts,
        });
        convo = await this.conversations.save(convo);
      } else {
        await this.conversations.update(
          { id: convo.id },
          { lastMessageAt: ts },
        );
      }

      // Save message
      const savedMsg = await this.messages.save(
        this.messages.create({
          orgId,
          conversationId: convo.id,
          direction: MessageDirection.IN,
          externalMessageId: mid,
          messageType: type.toUpperCase(),
          text,
          occurredAt: ts,
        }),
      );

      // Real-time push
      this.gateway.emitNewMessage(orgId, {
        conversationId: convo.id,
        message: {
          id: savedMsg.id,
          direction: 'IN',
          messageType: savedMsg.messageType,
          text: savedMsg.text ?? null,
          externalMessageId: mid,
          occurredAt: savedMsg.occurredAt,
          createdAt: savedMsg.createdAt,
        },
        conversation: {
          id: convo.id,
          lastMessageAt: ts,
        },
      });

      this.logger.log(
        `[whatsapp] saved message from=${from} text="${text}" orgId=${orgId}`,
      );
    }
  }

  async sendMessage(orgId: string, conversationId: string, text: string) {
    const convo = await this.conversations.findOne({
      where: { id: conversationId, orgId } as any,
      relations: ['channel'],
    });

    if (!convo?.channel) throw new Error('Conversation or channel not found');

    const phoneNumberId = convo.channel.externalAccountId;
    const to = convo.externalUserId; // customer's WA number
    const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');

    await firstValueFrom(
      this.http.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );

    const savedMsg = await this.messages.save(
      this.messages.create({
        orgId,
        conversationId,
        direction: MessageDirection.OUT,
        messageType: 'TEXT',
        text,
        occurredAt: new Date(),
      }),
    );

    await this.conversations.update(
      { id: conversationId },
      { lastMessageAt: savedMsg.occurredAt },
    );

    this.gateway.emitNewMessage(orgId, {
      conversationId,
      message: {
        id: savedMsg.id,
        direction: 'OUT',
        messageType: 'TEXT',
        text,
        externalMessageId: null,
        occurredAt: savedMsg.occurredAt,
        createdAt: savedMsg.createdAt,
      },
      conversation: { id: conversationId, lastMessageAt: savedMsg.occurredAt },
    });

    return { id: savedMsg.id, text, occurredAt: savedMsg.occurredAt };
  }
}
