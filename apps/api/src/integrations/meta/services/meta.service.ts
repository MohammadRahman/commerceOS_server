/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
// v2 this version contains the meta comments service
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
// apps/api/src/integrations/meta/services/meta.service.ts — v5
//
// v5 changes:
//  - ingestWebhook now handles BOTH messaging (existing) AND feed/changes events
//  - feed events contain comment notifications from posts and lives
//  - Comment events are routed to CommentsService.ingestWebhookComment
//  - Messaging events unchanged — still handled by ingestMessagingEvent

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

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
import { CommentsService } from 'apps/api/src/modules/comments/comments.service';

type MetaMessagingEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

@Injectable()
export class MetaService {
  constructor(
    private idem: IdempotencyService,
    private gateway: InboxGateway,
    private http: HttpService,
    private config: ConfigService,
    private commentsService: CommentsService,
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

  // ── Main webhook entry ─────────────────────────────────────────────────────

  async ingestWebhook(body: any) {
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      // ── Messaging events (DMs) — existing behaviour unchanged ─────────────
      const messagingEvents: MetaMessagingEvent[] = Array.isArray(
        entry?.messaging,
      )
        ? entry.messaging
        : [];
      for (const evt of messagingEvents) {
        await this.ingestMessagingEvent(evt, body);
      }

      // ── Feed/changes events (comments on posts/lives) ──────────────────────
      const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (change?.field === 'feed') {
          await this.ingestFeedChange(change.value, entry.id).catch((err) =>
            console.error('[meta] feed change error:', err?.message),
          );
        }
      }
    }
  }

  // ── Feed comment ingestion ─────────────────────────────────────────────────

  /**
   * Handles a single `feed` change value from the Meta webhook.
   *
   * Meta sends feed changes for:
   *  - New comments on a post:       item=comment, verb=add
   *  - Replies to comments:          item=comment, verb=add, parent_id set
   *  - Comment edits:                item=comment, verb=edited
   *  - Post reactions, shares, etc.: ignored here
   *
   * The pageId comes from the entry.id (top-level entry).
   * We use it to find the org's channel and route to CommentsService.
   */
  private async ingestFeedChange(
    value: any,
    entryPageId: string,
  ): Promise<void> {
    // Only handle new comments
    if (value?.item !== 'comment' || value?.verb !== 'add') return;

    const commentId = value?.comment_id as string | undefined;
    const postId = value?.post_id as string | undefined;
    const senderId = value?.sender_id as string | undefined;
    const senderName =
      value?.sender_name ??
      (value?.from?.name as string | undefined) ??
      'Unknown';
    const text = value?.message as string | undefined;
    const timestamp = value?.created_time
      ? new Date(value.created_time * 1000)
      : new Date();

    if (!commentId || !postId || !senderId || !text) {
      console.log('[meta] skipping incomplete feed comment event');
      return;
    }

    // Find the org this page belongs to
    const channel = await this.channels.findOne({
      where: [
        { pageId: entryPageId, status: 'ACTIVE' as any },
        { externalAccountId: entryPageId, status: 'ACTIVE' as any },
      ],
    });

    if (!channel) {
      console.log(
        '[meta] feed comment: no channel found for pageId=',
        entryPageId,
      );
      return;
    }

    // Determine platform from channel type
    const platform = channel.type === 'FACEBOOK' ? 'facebook' : 'instagram';

    // Delegate to CommentsService — deduplication handled there
    await this.commentsService.ingestWebhookComment({
      orgId: channel.orgId,
      platformPostId: postId,
      platformCommentId: commentId,
      senderId,
      senderName,
      text,
      commentedAt: timestamp,
      platform,
    });

    console.log('[meta] ingested comment', commentId, 'for org', channel.orgId);
  }

  // ── Messaging events (DMs) — unchanged from v4 ────────────────────────────

  private async ingestMessagingEvent(evt: MetaMessagingEvent, rawBody: any) {
    const senderId = evt?.sender?.id;
    const recipientId = evt?.recipient?.id;
    if (!senderId || !recipientId) return;

    const isEcho = Boolean(evt?.message?.is_echo);
    if (isEcho) {
      console.log('[meta] skipping echo');
      return;
    }

    const userId = senderId;
    const pageId = recipientId;

    // const rawChannels = await this.channels.find({
    //   where: [
    //     { pageId, status: 'ACTIVE' as any },
    //     { externalAccountId: pageId, status: 'ACTIVE' as any },
    //   ],
    // });
    const rawChannels = await this.channels.find({
      where: [
        { pageId, status: 'ACTIVE' as any },
        { externalAccountId: pageId, status: 'ACTIVE' as any },
        { igBusinessId: pageId, status: 'ACTIVE' as any }, // ← Instagram DMs
      ],
    });

    const seen = new Set<string>();
    const channels = rawChannels.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

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

      let identity = await this.identities.findOne({
        where: { channelId: channel.id, externalUserId: userId },
        relations: ['customer'],
      });

      if (!identity) {
        const realName = await this.fetchMetaUserName(userId, channel);
        const customer = await this.customers.save(
          this.customers.create({
            orgId,
            name: realName ?? `User ${userId.slice(-6)}`,
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
        identity.customer = customer;
      }

      let convo = await this.conversations.findOne({
        where: { channelId: channel.id, externalThreadId: userId },
      });

      if (!convo) {
        convo = await this.conversations.save(
          this.conversations.create({
            orgId,
            channelId: channel.id,
            externalThreadId: userId,
            externalUserId: userId,
            lastMessageAt: new Date(ts),
          }),
        );
      } else {
        await this.conversations.update(
          { id: convo.id, orgId },
          { lastMessageAt: new Date(ts) },
        );
      }

      const msg = this.messages.create({
        orgId,
        conversationId: convo.id,
        direction: MessageDirection.IN,
        externalMessageId: mid ?? undefined,
        messageType: 'TEXT',
        text: evt?.message?.text ?? undefined,
        rawPayload: rawBody,
        occurredAt: new Date(ts),
      });
      await this.messages.save(msg);

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
        conversation: { id: convo.id, lastMessageAt: new Date(ts) },
      });
    }
  }

  private async fetchMetaUserName(
    userId: string,
    channel: ChannelEntity,
  ): Promise<string | null> {
    try {
      if (!channel.accessTokenEnc) return null;
      const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
      const buf = Buffer.from(channel.accessTokenEnc, 'base64');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const k = crypto.createHash('sha256').update(key).digest();
      const dc = crypto.createDecipheriv('aes-256-gcm', k, iv);
      dc.setAuthTag(tag);
      const token = Buffer.concat([dc.update(enc), dc.final()]).toString(
        'utf8',
      );
      const { data } = await firstValueFrom(
        this.http.get(
          `https://graph.facebook.com/v19.0/${userId}?fields=name&access_token=${token}`,
        ),
      );
      return (data?.name as string) ?? null;
    } catch (e: any) {
      console.warn(
        '[meta] fetchMetaUserName failed:',
        e?.response?.data?.error?.message ?? e?.message,
      );
      return null;
    }
  }
}
// v1 without comments service
/* eslint-disable @typescript-eslint/no-unused-vars */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// // apps/api/src/integrations/meta/services/meta.service.ts — v4
// // Fixes:
// // 1. if (isEcho) return — prevents duplicate outbound messages
// // 2. Decrypt page token to fetch real Facebook display name
// // 3. Deduplicate channels when pageId === externalAccountId
// import { Injectable } from '@nestjs/common';
// import { HttpService } from '@nestjs/axios';
// import { firstValueFrom } from 'rxjs';
// import { ConfigService } from '@nestjs/config';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import * as crypto from 'crypto';

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
//     private http: HttpService,
//     private config: ConfigService,
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
//     console.log('[meta-service] v4');
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

//     // ✅ FIX 1: Skip echo events — InboxService already saves outbound messages.
//     // Meta echoes back every message sent via the API as is_echo=true.
//     // Processing it here causes duplicates.
//     if (isEcho) {
//       console.log('[meta] skipping echo');
//       return;
//     }

//     const userId = senderId; // customer's Facebook user ID
//     const pageId = recipientId; // your page ID

//     const rawChannels = await this.channels.find({
//       where: [
//         { pageId, status: 'ACTIVE' as any },
//         { externalAccountId: pageId, status: 'ACTIVE' as any },
//       ],
//     });

//     // ✅ FIX 2: Deduplicate channels — OR query returns same row twice
//     // when pageId === externalAccountId (always true for Facebook pages)
//     const seen = new Set<string>();
//     const channels = rawChannels.filter((c) => {
//       if (seen.has(c.id)) return false;
//       seen.add(c.id);
//       return true;
//     });

//     console.log(
//       '[meta] pageId=',
//       pageId,
//       'channels=',
//       channels.length,
//       '(raw=',
//       rawChannels.length,
//       ')',
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

//       let identity = await this.identities.findOne({
//         where: { channelId: channel.id, externalUserId: userId },
//         relations: ['customer'],
//       });

//       if (!identity) {
//         // ✅ FIX 3: Use decrypted page token — WHATSAPP_ACCESS_TOKEN cannot
//         // fetch Messenger user profiles, only the page token can
//         const realName = await this.fetchMetaUserName(userId, channel);
//         console.log(
//           '[meta] name=',
//           realName ?? 'fallback',
//           'for userId=',
//           userId,
//         );

//         const customer = await this.customers.save(
//           this.customers.create({
//             orgId,
//             name: realName ?? `User ${userId.slice(-6)}`,
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
//         identity.customer = customer;

//         console.log('[meta] created customer:', customer.name, 'orgId=', orgId);
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

//       // ── 3. Save Message (always IN — echos are skipped above) ─────────────

//       const msg = this.messages.create({
//         orgId,
//         conversationId: convo.id,
//         direction: MessageDirection.IN,
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

//   // ✅ FIX 3: Decrypt page token from channel entity and use it to call Graph API
//   private async fetchMetaUserName(
//     userId: string,
//     channel: ChannelEntity,
//   ): Promise<string | null> {
//     try {
//       if (!channel.accessTokenEnc) {
//         console.warn('[meta] channel has no accessTokenEnc');
//         return null;
//       }

//       const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
//       const buf = Buffer.from(channel.accessTokenEnc, 'base64');
//       const iv = buf.subarray(0, 12);
//       const tag = buf.subarray(12, 28);
//       const enc = buf.subarray(28);
//       const k = crypto.createHash('sha256').update(key).digest();
//       const dc = crypto.createDecipheriv('aes-256-gcm', k, iv);
//       dc.setAuthTag(tag);
//       const token = Buffer.concat([dc.update(enc), dc.final()]).toString(
//         'utf8',
//       );

//       const url = `https://graph.facebook.com/v19.0/${userId}?fields=name&access_token=${token}`;
//       const { data } = await firstValueFrom(this.http.get(url));
//       return (data?.name as string) ?? null;
//     } catch (e: any) {
//       console.warn(
//         '[meta] fetchMetaUserName failed:',
//         e?.response?.data?.error?.message ?? e?.message,
//       );
//       return null;
//     }
//   }
// }
