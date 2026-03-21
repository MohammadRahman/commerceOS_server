/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import {
  MessageEntity,
  MessageDirection,
} from 'apps/api/src/modules/inbox/entities/message.entity';
import { InboxGateway } from '../gateway/inbox.gateway';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    private messages: Repository<MessageEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    private http: HttpService,
    private config: ConfigService,
    private gateway: InboxGateway,
  ) {}

  async sendMessage(orgId: string, conversationId: string, text: string) {
    const convo = await this.conversations.findOne({
      where: { id: conversationId, orgId } as any,
      relations: ['channel'],
    });
    if (!convo) throw new NotFoundException('Conversation not found');
    if (!convo.channel)
      throw new BadRequestException('No channel on conversation');

    const channelType = convo.channel.type;

    if (channelType === 'WHATSAPP') {
      return this.sendWhatsappMessage(convo, text, orgId);
    } else {
      return this.sendMessengerMessage(convo, text, orgId);
    }
  }

  private decrypt(enc: string): string {
    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const buf = Buffer.from(enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const k = crypto.createHash('sha256').update(key).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  private async sendMessengerMessage(convo: any, text: string, orgId: string) {
    const pageToken = this.decrypt(convo.channel.accessTokenEnc);

    await firstValueFrom(
      this.http.post(
        `https://graph.facebook.com/v19.0/me/messages`,
        {
          recipient: { id: convo.externalUserId },
          message: { text },
          messaging_type: 'RESPONSE',
        },
        { params: { access_token: pageToken } },
      ),
    );

    return this.saveAndEmit(convo.id, orgId, text);
  }
  private async sendWhatsappMessage(convo: any, text: string, orgId: string) {
    const phoneNumberId = convo.channel.externalAccountId;
    const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');

    await firstValueFrom(
      this.http.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: convo.externalUserId,
          type: 'text',
          text: { body: text },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    );

    return this.saveAndEmit(convo.id, orgId, text);
  }
  private async saveAndEmit(
    conversationId: string,
    orgId: string,
    text: string,
  ) {
    const msg = await this.messages.save(
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
      { lastMessageAt: msg.occurredAt },
    );

    this.gateway.emitNewMessage(orgId, {
      conversationId,
      message: {
        id: msg.id,
        direction: 'OUT',
        messageType: 'TEXT',
        text,
        externalMessageId: null,
        occurredAt: msg.occurredAt,
        createdAt: msg.createdAt,
      },
      conversation: { id: conversationId, lastMessageAt: msg.occurredAt },
    });

    return { id: msg.id, text, occurredAt: msg.occurredAt };
  }
}
