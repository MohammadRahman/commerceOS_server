/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/integrations/meta/services/meta.service.ts
// Fix: create CustomerEntity + CustomerIdentityEntity when a new conversation
// is received — without this, createOrder from inbox always fails with
// "Could not resolve customer from conversation"
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { IdempotencyService } from '@app/common';
import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
import { CustomerEntity } from 'apps/api/src/modules/inbox/entities/customer.entity';
import { CustomerIdentityEntity } from 'apps/api/src/modules/inbox/entities/customer-identity.entity';
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
    private http: HttpService,
    private config: ConfigService,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    @InjectRepository(ConversationEntity)
    private conversations: Repository<ConversationEntity>,
    @InjectRepository(CustomerEntity)
    private customers: Repository<CustomerEntity>,
    @InjectRepository(CustomerIdentityEntity)
    private identities: Repository<CustomerIdentityEntity>,
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

    const rawChannels = await this.channels.find({
      where: [
        { pageId, status: 'ACTIVE' as any },
        { externalAccountId: pageId, status: 'ACTIVE' as any },
      ],
    });

    // ✅ Deduplicate — OR query returns same row twice when pageId === externalAccountId
    const seen = new Set<string>();
    const channels = rawChannels.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    console.log(
      '[meta] lookup pageId=',
      pageId,
      'found=',
      channels.length,
      'unique channels (raw=',
      rawChannels.length,
      ')',
    );
    if (!channels.length) return;

    const mid = evt?.message?.mid;
    const ts = evt?.timestamp ?? Date.now();

    for (const channel of channels) {
      const orgId = channel.orgId;

      const idemKey = mid
        ? `mid:${mid}:org:${orgId}`
        : `ts:${ts}:s:${senderId}:r:${recipientId}:org:${orgId}`;

      const claimed = await this.idem.claim(orgId, 'webhook:meta', idemKey);
      if (!claimed) continue;

      // ── 1. Find or create Customer + Identity ─────────────────────────────
      // This is what enables createOrder from inbox to resolve the customer.
      // Without this, customer_identities is always empty → order creation fails.

      let identity = await this.identities.findOne({
        where: { channelId: channel.id, externalUserId: userId },
        relations: ['customer'],
      });

      if (!identity) {
        // Create a bare customer record — name/phone can be enriched later
        // via Meta Graph API or when the agent fills in order details
        const customer = await this.customers.save(
          this.customers.create({
            orgId,
            // Use externalUserId as a temporary name placeholder
            // so the UI shows something instead of blank
            // Fetch real name from Meta Graph API using the channel's page token
            name:
              (await this.fetchMetaUserName(userId, channel)) ??
              `User ${userId.slice(-6)}`,
          }),
        );

        identity = await this.identities.save(
          this.identities.create({
            orgId,
            customerId: customer.id,
            channelId: channel.id,
            externalUserId: userId,
            metadata: { source: 'meta_webhook', pageId },
          }),
        );

        // Load the relation so identity.customer is populated below
        identity.customer = customer;

        console.log(
          '[meta] created customer+identity for orgId=',
          orgId,
          'userId=',
          userId,
        );
      }

      // ── 2. Find or create Conversation ───────────────────────────────────

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

      // ── 3. Save Message ───────────────────────────────────────────────────

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

      // ── 4. Emit via WebSocket ─────────────────────────────────────────────

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

  /** Fetch the user's real name from Meta Graph API using the page token */
  private async fetchMetaUserName(
    userId: string,
    channel: ChannelEntity,
  ): Promise<string | null> {
    try {
      // Decrypt the page token stored on the channel
      // For now we use the system-level access token from config as fallback
      const token =
        this.config.get<string>('WHATSAPP_ACCESS_TOKEN') ??
        this.config.get<string>('META_ACCESS_TOKEN');
      if (!token) return null;

      const url = `https://graph.facebook.com/v19.0/${userId}?fields=name&access_token=${token}`;
      const { data } = await firstValueFrom(this.http.get(url));
      return (data?.name as string) ?? null;
    } catch {
      return null; // Non-fatal — fall back to User XXXXXX
    }
  }
}
// // v2 this version also ingests messages for all channels matching the pageId, not just one. This is important for orgs that have the same page connected in multiple channels (eg for different brands/regions).
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // apps/api/src/integrations/meta/services/meta.service.ts
// // Fix: create CustomerEntity + CustomerIdentityEntity when a new conversation
// // is received — without this, createOrder from inbox always fails with
// // "Could not resolve customer from conversation"
// import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

// import { IdempotencyService } from '@app/common';
// import { ChannelEntity } from 'apps/api/src/modules/inbox/entities/channel.entity';
// import { ConversationEntity } from 'apps/api/src/modules/inbox/entities/conversation.entity';
// import { CustomerEntity } from 'apps/api/src/modules/inbox/entities/customer.entity';
// import { CustomerIdentityEntity } from 'apps/api/src/modules/inbox/entities/customer-identity.entity';
// import {
//   MessageEntity,
//   MessageDirection,
// } from 'apps/api/src/modules/inbox/entities/message.entity';
// import { InboxGateway } from '../gateway/inbox.gateway';

// type MetaMessagingEvent = {
//   sender?: { id: string };
//   recipient?: { id: string };
//   timestamp?: number;
//   message?: {
//     mid?: string;
//     text?: string;
//     is_echo?: boolean;
//   };
// };

// @Injectable()
// export class MetaService {
//   constructor(
//     private idem: IdempotencyService,
//     private gateway: InboxGateway,
//     @InjectRepository(ChannelEntity)
//     private channels: Repository<ChannelEntity>,
//     @InjectRepository(ConversationEntity)
//     private conversations: Repository<ConversationEntity>,
//     @InjectRepository(CustomerEntity)
//     private customers: Repository<CustomerEntity>,
//     @InjectRepository(CustomerIdentityEntity)
//     private identities: Repository<CustomerIdentityEntity>,
//     @InjectRepository(MessageEntity)
//     private messages: Repository<MessageEntity>,
//   ) {}

//   async ingestWebhook(body: any) {
//     console.log('[meta-service] THIS IS services/meta.service.ts');
//     const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
//     for (const entry of entries) {
//       const events: MetaMessagingEvent[] = Array.isArray(entry?.messaging)
//         ? entry.messaging
//         : [];
//       for (const evt of events) {
//         await this.ingestMessagingEvent(evt, body);
//       }
//     }
//   }

//   private async ingestMessagingEvent(evt: MetaMessagingEvent, rawBody: any) {
//     const senderId = evt?.sender?.id;
//     const recipientId = evt?.recipient?.id;
//     if (!senderId || !recipientId) return;

//     const isEcho = Boolean(evt?.message?.is_echo);
//     const userId = isEcho ? recipientId : senderId;
//     const pageId = isEcho ? senderId : recipientId;

//     const channels = await this.channels.find({
//       where: [
//         { pageId, status: 'ACTIVE' as any },
//         { externalAccountId: pageId, status: 'ACTIVE' as any },
//       ],
//     });

//     console.log(
//       '[meta] lookup pageId=',
//       pageId,
//       'found=',
//       channels.length,
//       'channels',
//     );
//     if (!channels.length) return;

//     const mid = evt?.message?.mid;
//     const ts = evt?.timestamp ?? Date.now();

//     for (const channel of channels) {
//       const orgId = channel.orgId;

//       const idemKey = mid
//         ? `mid:${mid}:org:${orgId}`
//         : `ts:${ts}:s:${senderId}:r:${recipientId}:org:${orgId}`;

//       const claimed = await this.idem.claim(orgId, 'webhook:meta', idemKey);
//       if (!claimed) continue;

//       // ── 1. Find or create Customer + Identity ─────────────────────────────
//       // This is what enables createOrder from inbox to resolve the customer.
//       // Without this, customer_identities is always empty → order creation fails.

//       let identity = await this.identities.findOne({
//         where: { channelId: channel.id, externalUserId: userId },
//         relations: ['customer'],
//       });

//       if (!identity) {
//         // Create a bare customer record — name/phone can be enriched later
//         // via Meta Graph API or when the agent fills in order details
//         const customer = await this.customers.save(
//           this.customers.create({
//             orgId,
//             // Use externalUserId as a temporary name placeholder
//             // so the UI shows something instead of blank
//             name: `User ${userId.slice(-6)}`,
//           }),
//         );

//         identity = await this.identities.save(
//           this.identities.create({
//             orgId,
//             customerId: customer.id,
//             channelId: channel.id,
//             externalUserId: userId,
//             metadata: { source: 'meta_webhook', pageId },
//           }),
//         );

//         // Load the relation so identity.customer is populated below
//         identity.customer = customer;

//         console.log(
//           '[meta] created customer+identity for orgId=',
//           orgId,
//           'userId=',
//           userId,
//         );
//       }

//       // ── 2. Find or create Conversation ───────────────────────────────────

//       let convo = await this.conversations.findOne({
//         where: { channelId: channel.id, externalThreadId: userId },
//       });

//       if (!convo) {
//         convo = this.conversations.create({
//           orgId,
//           channelId: channel.id,
//           externalThreadId: userId,
//           externalUserId: userId,
//           lastMessageAt: new Date(ts),
//         });
//         convo = await this.conversations.save(convo);
//       } else {
//         await this.conversations.update(
//           { id: convo.id, orgId },
//           { lastMessageAt: new Date(ts) },
//         );
//       }

//       // ── 3. Save Message ───────────────────────────────────────────────────

//       const direction = isEcho ? MessageDirection.OUT : MessageDirection.IN;
//       const msg = this.messages.create({
//         orgId,
//         conversationId: convo.id,
//         direction,
//         externalMessageId: mid ?? undefined,
//         messageType: 'TEXT',
//         text: evt?.message?.text ?? undefined,
//         rawPayload: rawBody,
//         occurredAt: new Date(ts),
//       });
//       await this.messages.save(msg);

//       // ── 4. Emit via WebSocket ─────────────────────────────────────────────

//       this.gateway.emitNewMessage(orgId, {
//         conversationId: convo.id,
//         message: {
//           id: msg.id,
//           direction: msg.direction,
//           messageType: msg.messageType,
//           text: msg.text ?? null,
//           occurredAt: msg.occurredAt,
//           createdAt: msg.createdAt,
//         },
//         conversation: {
//           id: convo.id,
//           lastMessageAt: new Date(ts),
//         },
//       });

//       console.log('[meta] saved message for orgId=', orgId);
//     }
//   }
// }
