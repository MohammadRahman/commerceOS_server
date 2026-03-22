// v3
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/integrations/whatsapp/whatsapp.service.ts — v3
// Added: handleEmbeddedSignup() — exchanges Meta code for token, fetches phone numbers, saves channels
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  // ── Embedded Signup ───────────────────────────────────────────────────────
  // Called after the Meta Embedded Signup popup completes.
  // Meta returns a short-lived code — we exchange it for a user access token,
  // then get the WABA phone numbers and save channels.

  async handleEmbeddedSignup(
    orgId: string,
    code: string,
    wabaId?: string,
    phoneNumberId?: string,
  ): Promise<{
    connected: number;
    channels: { id: string; name: string; phoneNumber: string }[];
  }> {
    const appId = this.config.getOrThrow<string>('META_APP_ID');
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET');
    const redirectUri = 'https://developers.facebook.com/setup-guide/wa';

    // Step 1: Exchange code for user access token
    let userToken: string;
    try {
      const tokenRes = await firstValueFrom(
        this.http.get('https://graph.facebook.com/v19.0/oauth/access_token', {
          params: {
            client_id: appId,
            client_secret: appSecret,
            code,
            redirect_uri: redirectUri,
          },
        }),
      );
      userToken = tokenRes.data.access_token;
      this.logger.log(`[whatsapp-signup] got user token for orgId=${orgId}`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ??
        err?.message ??
        'Token exchange failed';
      this.logger.error(`[whatsapp-signup] token exchange failed: ${msg}`);
      throw new BadRequestException(`Meta token exchange failed: ${msg}`);
    }

    // Step 2: If phoneNumberId provided directly (from SDK session), use it
    // Otherwise fetch all phone numbers from the WABA
    const connectedChannels: {
      id: string;
      name: string;
      phoneNumber: string;
    }[] = [];

    if (phoneNumberId) {
      // Direct phone number ID from Embedded Signup session
      const channel = await this.upsertWhatsAppChannel(
        orgId,
        phoneNumberId,
        userToken,
        '',
      );
      if (channel)
        connectedChannels.push({
          id: channel.id,
          name: channel.name ?? '',
          phoneNumber: phoneNumberId,
        });
    } else if (wabaId) {
      // Fetch all phone numbers for this WABA
      try {
        const numbersRes = await firstValueFrom(
          this.http.get(
            `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`,
            {
              params: {
                fields: 'display_phone_number,verified_name,id',
                access_token: userToken,
              },
            },
          ),
        );
        const numbers = numbersRes.data?.data ?? [];
        this.logger.log(
          `[whatsapp-signup] found ${numbers.length} phone numbers for wabaId=${wabaId}`,
        );

        for (const num of numbers) {
          const channel = await this.upsertWhatsAppChannel(
            orgId,
            num.id,
            userToken,
            num.verified_name ?? num.display_phone_number ?? '',
          );
          if (channel)
            connectedChannels.push({
              id: channel.id,
              name: channel.name ?? '',
              phoneNumber: num.display_phone_number ?? num.id,
            });
        }
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message ?? err?.message;
        this.logger.error(
          `[whatsapp-signup] phone numbers fetch failed: ${msg}`,
        );
        throw new BadRequestException(
          `Could not fetch WhatsApp phone numbers: ${msg}`,
        );
      }
    } else {
      throw new BadRequestException(
        'Either phoneNumberId or wabaId must be provided',
      );
    }

    return { connected: connectedChannels.length, channels: connectedChannels };
  }

  private async upsertWhatsAppChannel(
    orgId: string,
    phoneNumberId: string,
    accessToken: string,
    nameHint: string,
  ): Promise<ChannelEntity | null> {
    try {
      // Verify phone number and get display name from Meta
      let channelName = nameHint;
      try {
        const res = await firstValueFrom(
          this.http.get(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
            params: {
              fields: 'display_phone_number,verified_name',
              access_token: accessToken,
            },
          }),
        );
        channelName =
          res.data?.verified_name ?? res.data?.display_phone_number ?? nameHint;
      } catch {
        /* use nameHint as fallback */
      }

      const existing = await this.channels.findOne({
        where: {
          orgId,
          type: ChannelType.WHATSAPP,
          externalAccountId: phoneNumberId,
        } as any,
      });

      if (existing) {
        await this.channels.update({ id: existing.id }, {
          name: channelName,
          status: 'ACTIVE',
        } as any);
        return this.channels.findOne({
          where: { id: existing.id },
        }) as Promise<ChannelEntity>;
      }

      return (await this.channels.save(
        this.channels.create({
          orgId,
          type: ChannelType.WHATSAPP,
          name: channelName,
          externalAccountId: phoneNumberId,
          status: 'ACTIVE',
        } as any),
      )) as unknown as ChannelEntity;
    } catch (err: any) {
      this.logger.error(
        `[whatsapp-signup] upsertChannel failed for ${phoneNumberId}: ${err?.message}`,
      );
      return null;
    }
  }

  // ── Manual registration (developer fallback) ──────────────────────────────

  async registerChannel(
    orgId: string,
    phoneNumberId: string,
    displayName: string,
    wabaId?: string,
  ) {
    if (!phoneNumberId?.trim())
      throw new BadRequestException('Phone Number ID is required');
    const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    const channel = await this.upsertWhatsAppChannel(
      orgId,
      phoneNumberId,
      accessToken,
      displayName,
    );
    if (!channel) throw new BadRequestException('Failed to register channel');
    return channel;
  }

  async disconnectChannel(orgId: string) {
    await this.channels.update(
      { orgId, type: ChannelType.WHATSAPP } as any,
      { status: 'INACTIVE' } as any,
    );
    return { disconnected: true };
  }

  // ── Webhook ingestion ─────────────────────────────────────────────────────

  async ingestWebhook(body: any) {
    this.logger.log('[whatsapp] ingestWebhook called');
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (change?.field !== 'messages') continue;
        await this.ingestMessages(change?.value);
      }
    }
  }

  private async ingestMessages(value: any) {
    const phoneNumberId = value?.metadata?.phone_number_id;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    if (!phoneNumberId || !messages.length) return;

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
      const from = msg?.from;
      const mid = msg?.id;
      const ts = msg?.timestamp
        ? new Date(Number(msg.timestamp) * 1000)
        : new Date();
      const text = msg?.text?.body ?? null;
      const type = msg?.type ?? 'text';
      if (!from || !mid) continue;

      const claimed = await this.idem.claim(
        orgId,
        'webhook:whatsapp',
        `mid:${mid}`,
      );
      if (!claimed) continue;

      const contact = contacts.find((c: any) => c.wa_id === from);
      const displayName = contact?.profile?.name ?? from;

      let convo = await this.conversations.findOne({
        where: { channelId: channel.id, externalThreadId: from },
      });
      if (!convo) {
        convo = await this.conversations.save(
          this.conversations.create({
            orgId,
            channelId: channel.id,
            externalThreadId: from,
            externalUserId: from,
            lastMessageAt: ts,
          }),
        );
      } else {
        await this.conversations.update(
          { id: convo.id },
          { lastMessageAt: ts },
        );
      }

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
        conversation: { id: convo.id, lastMessageAt: ts },
      });
      this.logger.log(
        `[whatsapp] saved message from=${from} text="${text}" orgId=${orgId}`,
      );
    }
  }

  // ── Send message ──────────────────────────────────────────────────────────

  async sendMessage(orgId: string, conversationId: string, text: string) {
    const convo = await this.conversations.findOne({
      where: { id: conversationId, orgId } as any,
      relations: ['channel'],
    });
    if (!convo?.channel) throw new Error('Conversation or channel not found');

    const phoneNumberId = convo.channel.externalAccountId;
    const to = convo.externalUserId;
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
// /* eslint-disable @typescript-eslint/no-unsafe-argument */
// // v2
// /* eslint-disable @typescript-eslint/no-unused-vars */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// // apps/api/src/integrations/whatsapp/whatsapp.service.ts — v2
// // Added: registerChannel(), disconnectChannel()
// // WhatsApp channel registration works just like Messenger:
// //   1. Agent provides Phone Number ID + display name
// //   2. Backend verifies against Meta Graph API using WHATSAPP_ACCESS_TOKEN
// //   3. ChannelEntity saved with type=WHATSAPP, externalAccountId=phoneNumberId
// import { BadRequestException, Injectable, Logger } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { HttpService } from '@nestjs/axios';
// import { ConfigService } from '@nestjs/config';
// import { firstValueFrom } from 'rxjs';

// import {
//   ChannelEntity,
//   ChannelType,
// } from '../../modules/inbox/entities/channel.entity';
// import { ConversationEntity } from '../../modules/inbox/entities/conversation.entity';
// import {
//   MessageEntity,
//   MessageDirection,
// } from '../../modules/inbox/entities/message.entity';
// import { IdempotencyService } from '@app/common';
// import { InboxGateway } from '../meta/gateway/inbox.gateway';

// @Injectable()
// export class WhatsappService {
//   private readonly logger = new Logger(WhatsappService.name);

//   constructor(
//     private config: ConfigService,
//     private http: HttpService,
//     private idem: IdempotencyService,
//     private gateway: InboxGateway,
//     @InjectRepository(ChannelEntity)
//     private channels: Repository<ChannelEntity>,
//     @InjectRepository(ConversationEntity)
//     private conversations: Repository<ConversationEntity>,
//     @InjectRepository(MessageEntity)
//     private messages: Repository<MessageEntity>,
//   ) {}

//   // ── Register WhatsApp channel ─────────────────────────────────────────────
//   // Mirrors how MetaOAuthService saves Facebook channels after OAuth.
//   // Instead of OAuth flow, agent provides Phone Number ID from Meta Dashboard.

//   async registerChannel(
//     orgId: string,
//     phoneNumberId: string,
//     displayName: string,
//     wabaId?: string,
//   ): Promise<ChannelEntity> {
//     if (!phoneNumberId?.trim()) {
//       throw new BadRequestException('Phone Number ID is required');
//     }

//     const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');

//     // Verify the Phone Number ID is valid against Meta Graph API
//     try {
//       const res = await firstValueFrom(
//         this.http.get(`https://graph.facebook.com/v19.0/${phoneNumberId}`, {
//           params: {
//             fields: 'display_phone_number,verified_name',
//             access_token: accessToken,
//           },
//         }),
//       );

//       // Use verified name from Meta if available, otherwise use agent-provided name
//       const verifiedName = res.data?.verified_name ?? displayName;
//       const phoneNumber = res.data?.display_phone_number ?? displayName;
//       const channelName = verifiedName || phoneNumber || displayName;

//       this.logger.log(
//         `[whatsapp] verified phoneNumberId=${phoneNumberId} name="${channelName}" orgId=${orgId}`,
//       );

//       // Upsert channel — if same phoneNumberId already exists for this org, update it
//       const existing = await this.channels.findOne({
//         where: {
//           orgId,
//           type: ChannelType.WHATSAPP,
//           externalAccountId: phoneNumberId,
//         } as any,
//       });

//       if (existing) {
//         await this.channels.update({ id: existing.id }, {
//           name: channelName,
//           status: 'ACTIVE',
//         } as any);
//         return this.channels.findOne({
//           where: { id: existing.id },
//         }) as Promise<ChannelEntity>;
//       }

//       const channel = (await this.channels.save(
//         this.channels.create({
//           orgId,
//           type: ChannelType.WHATSAPP,
//           name: channelName,
//           externalAccountId: phoneNumberId,
//           status: 'ACTIVE',
//         } as any),
//       )) as unknown as ChannelEntity;

//       this.logger.log(
//         `[whatsapp] channel registered id=${channel.id} orgId=${orgId}`,
//       );
//       return channel;
//     } catch (err: any) {
//       const msg =
//         err?.response?.data?.error?.message ??
//         err?.message ??
//         'Verification failed';
//       this.logger.error(`[whatsapp] registerChannel failed: ${msg}`);
//       throw new BadRequestException(
//         `Could not verify Phone Number ID with Meta: ${msg}`,
//       );
//     }
//   }

//   // ── Disconnect WhatsApp channel ───────────────────────────────────────────

//   async disconnectChannel(orgId: string): Promise<{ disconnected: boolean }> {
//     await this.channels.update(
//       { orgId, type: ChannelType.WHATSAPP } as any,
//       { status: 'INACTIVE' } as any,
//     );
//     return { disconnected: true };
//   }

//   // ── Webhook ingestion ─────────────────────────────────────────────────────

//   async ingestWebhook(body: any) {
//     this.logger.log('[whatsapp] ingestWebhook called');
//     const entries = Array.isArray(body?.entry) ? body.entry : [];
//     for (const entry of entries) {
//       const changes = Array.isArray(entry?.changes) ? entry.changes : [];
//       for (const change of changes) {
//         if (change?.field !== 'messages') continue;
//         await this.ingestMessages(change?.value);
//       }
//     }
//   }

//   private async ingestMessages(value: any) {
//     const phoneNumberId = value?.metadata?.phone_number_id;
//     const messages = Array.isArray(value?.messages) ? value.messages : [];
//     const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

//     if (!phoneNumberId || !messages.length) return;

//     const channel = await this.channels.findOne({
//       where: {
//         type: ChannelType.WHATSAPP as any,
//         externalAccountId: phoneNumberId,
//         status: 'ACTIVE',
//       } as any,
//     });

//     this.logger.log(
//       `[whatsapp] phoneNumberId=${phoneNumberId} found=${Boolean(channel)}`,
//     );

//     if (!channel) return;

//     const orgId = channel.orgId;

//     for (const msg of messages) {
//       const from = msg?.from;
//       const mid = msg?.id;
//       const ts = msg?.timestamp
//         ? new Date(Number(msg.timestamp) * 1000)
//         : new Date();
//       const text = msg?.text?.body ?? null;
//       const type = msg?.type ?? 'text';

//       if (!from || !mid) continue;

//       const claimed = await this.idem.claim(
//         orgId,
//         'webhook:whatsapp',
//         `mid:${mid}`,
//       );
//       if (!claimed) continue;

//       const contact = contacts.find((c: any) => c.wa_id === from);
//       const displayName = contact?.profile?.name ?? from;

//       // Upsert conversation
//       let convo = await this.conversations.findOne({
//         where: { channelId: channel.id, externalThreadId: from },
//       });

//       if (!convo) {
//         convo = await this.conversations.save(
//           this.conversations.create({
//             orgId,
//             channelId: channel.id,
//             externalThreadId: from,
//             externalUserId: from,
//             lastMessageAt: ts,
//           }),
//         );
//       } else {
//         await this.conversations.update(
//           { id: convo.id },
//           { lastMessageAt: ts },
//         );
//       }

//       const savedMsg = await this.messages.save(
//         this.messages.create({
//           orgId,
//           conversationId: convo.id,
//           direction: MessageDirection.IN,
//           externalMessageId: mid,
//           messageType: type.toUpperCase(),
//           text,
//           occurredAt: ts,
//         }),
//       );

//       this.gateway.emitNewMessage(orgId, {
//         conversationId: convo.id,
//         message: {
//           id: savedMsg.id,
//           direction: 'IN',
//           messageType: savedMsg.messageType,
//           text: savedMsg.text ?? null,
//           externalMessageId: mid,
//           occurredAt: savedMsg.occurredAt,
//           createdAt: savedMsg.createdAt,
//         },
//         conversation: { id: convo.id, lastMessageAt: ts },
//       });

//       this.logger.log(
//         `[whatsapp] saved message from=${from} text="${text}" orgId=${orgId}`,
//       );
//     }
//   }

//   // ── Send message ──────────────────────────────────────────────────────────

//   async sendMessage(orgId: string, conversationId: string, text: string) {
//     const convo = await this.conversations.findOne({
//       where: { id: conversationId, orgId } as any,
//       relations: ['channel'],
//     });

//     if (!convo?.channel) throw new Error('Conversation or channel not found');

//     const phoneNumberId = convo.channel.externalAccountId;
//     const to = convo.externalUserId;
//     const accessToken = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');

//     await firstValueFrom(
//       this.http.post(
//         `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
//         {
//           messaging_product: 'whatsapp',
//           recipient_type: 'individual',
//           to,
//           type: 'text',
//           text: { body: text },
//         },
//         { headers: { Authorization: `Bearer ${accessToken}` } },
//       ),
//     );

//     const savedMsg = await this.messages.save(
//       this.messages.create({
//         orgId,
//         conversationId,
//         direction: MessageDirection.OUT,
//         messageType: 'TEXT',
//         text,
//         occurredAt: new Date(),
//       }),
//     );

//     await this.conversations.update(
//       { id: conversationId },
//       { lastMessageAt: savedMsg.occurredAt },
//     );

//     this.gateway.emitNewMessage(orgId, {
//       conversationId,
//       message: {
//         id: savedMsg.id,
//         direction: 'OUT',
//         messageType: 'TEXT',
//         text,
//         externalMessageId: null,
//         occurredAt: savedMsg.occurredAt,
//         createdAt: savedMsg.createdAt,
//       },
//       conversation: { id: conversationId, lastMessageAt: savedMsg.occurredAt },
//     });

//     return { id: savedMsg.id, text, occurredAt: savedMsg.occurredAt };
//   }
// }
