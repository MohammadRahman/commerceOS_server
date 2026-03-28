/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/api/src/modules/comments/comments.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PostEntity } from './entities/post.entity';
import {
  PostCommentEntity,
  CommentIntent,
  CommentStatus,
} from './entities/post-comment.entity';
import { AutoReplyRuleEntity } from './entities/auto-reply-rule.entity';
import { AiService } from '../ai/ai.service';
import { ChannelEntity, ChannelType } from '../inbox/entities/channel.entity';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface ListCommentsQuery {
  postId?: string;
  intent?: CommentIntent;
  status?: CommentStatus;
  keyword?: string;
  platform?: string;
  returningOnly?: boolean;
  unrepliedOnly?: boolean;
  limit?: number;
  offset?: number;
}
export interface BulkReplyDto {
  commentIds: string[];
  replyText: string;
}
export interface BulkMoveToInboxDto {
  commentIds: string[];
  dmText?: string;
}
export interface BulkHideDto {
  commentIds: string[];
}
export interface CreateAutoRuleDto {
  name: string;
  trigger: string;
  keywords?: string[];
  intents?: string[];
  platforms?: string[];
  action: string;
  replyTemplate?: string;
  dmTemplate?: string;
  productId?: string;
  priority?: number;
}

interface ResolvedChannel {
  pageId: string;
  accessToken: string;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @InjectRepository(PostEntity)
    private posts: Repository<PostEntity>,
    @InjectRepository(PostCommentEntity)
    private comments: Repository<PostCommentEntity>,
    @InjectRepository(AutoReplyRuleEntity)
    private rules: Repository<AutoReplyRuleEntity>,
    @InjectRepository(ChannelEntity)
    private channels: Repository<ChannelEntity>,
    private ai: AiService,
    private config: ConfigService,
  ) {}

  // ── Channel resolution ─────────────────────────────────────────────────────

  /**
   * Finds the org's active Facebook/Instagram channel and decrypts the
   * page access token using AES-256-GCM — identical to MetaService.
   */
  async getChannelForOrg(
    orgId: string,
    platform: 'facebook' | 'instagram' = 'facebook',
  ): Promise<ResolvedChannel> {
    const type =
      platform === 'facebook' ? ChannelType.FACEBOOK : ChannelType.INSTAGRAM;

    const channel = await this.channels.findOne({
      where: { orgId, type, status: 'ACTIVE' } as any,
    });

    if (!channel)
      throw new BadRequestException(
        `No active ${platform} channel. Connect one in Settings → Channels.`,
      );
    if (!channel.pageId)
      throw new BadRequestException('Channel is missing pageId');
    if (!channel.accessTokenEnc)
      throw new BadRequestException('Channel is missing access token');

    return {
      pageId: channel.pageId,
      accessToken: this.decryptToken(channel.accessTokenEnc),
    };
  }

  private decryptToken(enc: string): string {
    const key = this.config.getOrThrow<string>('META_OAUTH_STATE_SECRET');
    const buf = Buffer.from(enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const k = crypto.createHash('sha256').update(key).digest();
    const dc = crypto.createDecipheriv('aes-256-gcm', k, iv);
    dc.setAuthTag(tag);
    return Buffer.concat([dc.update(data), dc.final()]).toString('utf8');
  }

  // ── Posts ──────────────────────────────────────────────────────────────────

  async listPosts(orgId: string): Promise<PostEntity[]> {
    return await this.posts.find({
      where: { orgId } as any,
      order: { createdAt: 'DESC' } as any,
      take: 50,
    });
  }

  async getPost(orgId: string, postId: string): Promise<PostEntity> {
    const post = await this.posts.findOne({
      where: { id: postId, orgId } as any,
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async syncPosts(orgId: string): Promise<PostEntity[]> {
    const { pageId, accessToken } = await this.getChannelForOrg(orgId);
    const fields = 'id,message,story,created_time,permalink_url,full_picture';
    const [postsRes, livesRes] = await Promise.all([
      fetch(
        `https://graph.facebook.com/v19.0/${pageId}/posts?fields=${fields}&limit=25&access_token=${accessToken}`,
      ),
      fetch(
        `https://graph.facebook.com/v19.0/${pageId}/live_videos?fields=id,title,description,status,created_time,permalink_url&limit=10&access_token=${accessToken}`,
      ),
    ]);

    const postsData = (await postsRes.json()) as any;
    const livesData = (await livesRes.json()) as any;
    const upserted: PostEntity[] = [];

    for (const p of postsData.data ?? []) {
      const existing = await this.posts.findOne({
        where: { orgId, platformPostId: p.id } as any,
      });
      if (existing) {
        upserted.push(existing);
        continue;
      }
      const post = (await this.posts.save(
        this.posts.create({
          orgId,
          platformPostId: p.id,
          platform: 'facebook',
          type: 'post',
          message: p.message ?? p.story,
          permalink: p.permalink_url,
          thumbnailUrl: p.full_picture,
          postedAt: new Date(p.created_time),
          isLive: false,
        } as any),
      )) as unknown as PostEntity;
      upserted.push(post);
    }

    for (const l of livesData.data ?? []) {
      const existing = await this.posts.findOne({
        where: { orgId, platformPostId: l.id } as any,
      });
      if (existing) {
        upserted.push(existing);
        continue;
      }
      const post = (await this.posts.save(
        this.posts.create({
          orgId,
          platformPostId: l.id,
          platform: 'facebook',
          type: 'live',
          title: l.title,
          message: l.description,
          permalink: l.permalink_url,
          isLive: l.status === 'LIVE',
          liveStartedAt: new Date(l.created_time),
          postedAt: new Date(l.created_time),
        } as any),
      )) as unknown as PostEntity;
      upserted.push(post);
    }

    return upserted;
  }

  async syncComments(
    orgId: string,
    postId: string,
  ): Promise<{ synced: number; classified: number }> {
    const { accessToken } = await this.getChannelForOrg(orgId);
    const post = await this.getPost(orgId, postId);
    const fields = 'id,message,from,created_time,parent';
    let url: string | null =
      `https://graph.facebook.com/v19.0/${post.platformPostId}/comments?fields=${fields}&limit=100&access_token=${accessToken}`;

    let synced = 0;
    let classified = 0;

    while (url) {
      const res = await fetch(url);
      const data = (await res.json()) as any;

      for (const c of data.data ?? []) {
        const existing = await this.comments.findOne({
          where: { platformCommentId: c.id } as any,
        });
        if (existing) continue;

        const comment = (await this.comments.save(
          this.comments.create({
            orgId,
            postId: post.id,
            platformCommentId: c.id,
            parentCommentId: c.parent?.id,
            platform: post.platform,
            senderId: c.from?.id ?? 'unknown',
            senderName: c.from?.name ?? 'Unknown',
            text: c.message ?? '',
            commentedAt: new Date(c.created_time),
            intent: 'other',
            intentConfidence: 0,
            isClassified: false,
            status: 'new',
            isReturningCustomer: false,
          } as any),
        )) as unknown as PostCommentEntity;
        synced++;

        try {
          const result = await this.ai.classifyCommentIntent(comment.text);
          await this.comments.update({ id: comment.id }, {
            intent: result.intent,
            intentConfidence: result.confidence,
            isClassified: true,
          } as any);
          classified++;
        } catch {
          /* non-fatal */
        }

        await this.runAutoRules(orgId, comment, accessToken).catch(() => {});
      }

      url = data.paging?.next ?? null;
    }

    await this.posts.update({ id: post.id }, {
      processedCount: synced,
      syncedAt: new Date(),
    } as any);
    return { synced, classified };
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  async listComments(
    orgId: string,
    query: ListCommentsQuery,
  ): Promise<{ items: PostCommentEntity[]; total: number }> {
    const qb = this.comments
      .createQueryBuilder('c')
      .where('c.org_id = :orgId', { orgId });
    if (query.postId)
      qb.andWhere('c.post_id = :postId', { postId: query.postId });
    if (query.intent)
      qb.andWhere('c.intent = :intent', { intent: query.intent });
    if (query.status)
      qb.andWhere('c.status = :status', { status: query.status });
    if (query.platform)
      qb.andWhere('c.platform = :platform', { platform: query.platform });
    if (query.returningOnly) qb.andWhere('c.is_returning_customer = true');
    if (query.unrepliedOnly) qb.andWhere("c.status = 'new'");
    if (query.keyword)
      qb.andWhere('LOWER(c.text) LIKE :kw', {
        kw: `%${query.keyword.toLowerCase()}%`,
      });
    qb.orderBy('c.commented_at', 'DESC');
    const total = await qb.getCount();
    const items = await qb
      .limit(query.limit ?? 50)
      .offset(query.offset ?? 0)
      .getMany();
    return { items, total };
  }

  // ── Bulk ops — channel resolved internally ─────────────────────────────────

  async bulkReply(
    orgId: string,
    dto: BulkReplyDto,
    userId: string,
  ): Promise<{ success: number; failed: number }> {
    const { accessToken } = await this.getChannelForOrg(orgId);
    let success = 0;
    let failed = 0;
    const comments = await this.comments.find({
      where: { id: In(dto.commentIds), orgId } as any,
    });
    for (const c of comments) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${c.platformCommentId}/comments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: dto.replyText,
              access_token: accessToken,
            }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await this.comments.update({ id: c.id }, {
          status: 'replied',
          replyText: dto.replyText,
          repliedAt: new Date(),
          repliedBy: userId,
        } as any);
        success++;
      } catch (err) {
        this.logger.error(`Reply failed ${c.id}:`, err);
        failed++;
      }
    }
    return { success, failed };
  }

  async bulkMoveToInbox(
    orgId: string,
    dto: BulkMoveToInboxDto,
  ): Promise<{ success: number; failed: number }> {
    const { accessToken } = await this.getChannelForOrg(orgId);
    let success = 0;
    let failed = 0;
    const comments = await this.comments.find({
      where: { id: In(dto.commentIds), orgId } as any,
    });
    const dmText =
      dto.dmText ??
      'Hi! Thanks for your comment. How can we help you today? 😊';
    for (const c of comments) {
      try {
        const res = await fetch(
          'https://graph.facebook.com/v19.0/me/messages',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: { id: c.senderId },
              message: { text: dmText },
              access_token: accessToken,
            }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await this.comments.update({ id: c.id }, {
          status: 'moved_to_inbox',
          movedToInboxAt: new Date(),
        } as any);
        success++;
      } catch (err) {
        this.logger.error(`DM failed ${c.senderId}:`, err);
        failed++;
      }
    }
    return { success, failed };
  }

  async bulkHide(
    orgId: string,
    dto: BulkHideDto,
  ): Promise<{ success: number; failed: number }> {
    const { accessToken } = await this.getChannelForOrg(orgId);
    let success = 0;
    let failed = 0;
    const comments = await this.comments.find({
      where: { id: In(dto.commentIds), orgId } as any,
    });
    for (const c of comments) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${c.platformCommentId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              is_hidden: true,
              access_token: accessToken,
            }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await this.comments.update({ id: c.id }, { status: 'hidden' } as any);
        success++;
      } catch (err) {
        this.logger.error(`Hide failed ${c.id}:`, err);
        failed++;
      }
    }
    return { success, failed };
  }

  // ── Auto-rules ─────────────────────────────────────────────────────────────

  async listRules(orgId: string): Promise<AutoReplyRuleEntity[]> {
    return await this.rules.find({
      where: { orgId } as any,
      order: { priority: 'ASC' } as any,
    });
  }

  async createRule(
    orgId: string,
    dto: CreateAutoRuleDto,
  ): Promise<AutoReplyRuleEntity> {
    return (await this.rules.save(
      this.rules.create({ orgId, ...dto } as any),
    )) as unknown as AutoReplyRuleEntity;
  }

  async updateRule(
    orgId: string,
    id: string,
    dto: Partial<CreateAutoRuleDto>,
  ): Promise<AutoReplyRuleEntity> {
    const rule = await this.rules.findOne({ where: { id, orgId } as any });
    if (!rule) throw new NotFoundException('Rule not found');
    await this.rules.update({ id }, dto as any);
    return (await this.rules.findOne({ where: { id } })) as AutoReplyRuleEntity;
  }

  async deleteRule(orgId: string, id: string): Promise<void> {
    const rule = await this.rules.findOne({ where: { id, orgId } as any });
    if (!rule) throw new NotFoundException('Rule not found');
    await this.rules.delete({ id });
  }

  async toggleRule(orgId: string, id: string): Promise<AutoReplyRuleEntity> {
    const rule = await this.rules.findOne({ where: { id, orgId } as any });
    if (!rule) throw new NotFoundException('Rule not found');
    await this.rules.update({ id }, { isActive: !rule.isActive } as any);
    return (await this.rules.findOne({ where: { id } })) as AutoReplyRuleEntity;
  }

  async runAutoRules(
    orgId: string,
    comment: PostCommentEntity,
    accessToken: string,
  ): Promise<void> {
    const activeRules = await this.rules.find({
      where: { orgId, isActive: true } as any,
      order: { priority: 'ASC' } as any,
    });
    for (const rule of activeRules) {
      if (!this.ruleMatches(rule, comment)) continue;
      try {
        if (rule.action === 'reply' || rule.action === 'reply_and_move') {
          await this.bulkReply(
            orgId,
            {
              commentIds: [comment.id],
              replyText: this.interpolate(rule.replyTemplate ?? '', comment),
            },
            'auto',
          );
        }
        if (
          rule.action === 'move_to_inbox' ||
          rule.action === 'reply_and_move'
        ) {
          await this.bulkMoveToInbox(orgId, {
            commentIds: [comment.id],
            dmText: this.interpolate(rule.dmTemplate ?? '', comment),
          });
        }
        if (rule.action === 'hide') {
          await this.bulkHide(orgId, { commentIds: [comment.id] });
        }
        await this.rules.update({ id: rule.id }, {
          fireCount: rule.fireCount + 1,
          lastFiredAt: new Date(),
        } as any);
        break;
      } catch (err) {
        this.logger.error(`Auto-rule ${rule.id} failed:`, err);
      }
    }
  }

  // ── Webhook ingestion (called from MetaService) ────────────────────────────

  async ingestWebhookComment(payload: {
    orgId: string;
    platformPostId: string;
    platformCommentId: string;
    senderId: string;
    senderName: string;
    text: string;
    commentedAt: Date;
    platform: string;
  }): Promise<void> {
    const existing = await this.comments.findOne({
      where: { platformCommentId: payload.platformCommentId } as any,
    });
    if (existing) return;

    // Resolve or stub parent post
    let post = await this.posts.findOne({
      where: {
        orgId: payload.orgId,
        platformPostId: payload.platformPostId,
      } as any,
    });
    if (!post) {
      post = (await this.posts.save(
        this.posts.create({
          orgId: payload.orgId,
          platformPostId: payload.platformPostId,
          platform: payload.platform,
          type: 'post',
          isLive: false,
          commentCount: 1,
        } as any),
      )) as unknown as PostEntity;
    }

    const comment = (await this.comments.save(
      this.comments.create({
        orgId: payload.orgId,
        postId: post.id,
        platformCommentId: payload.platformCommentId,
        platform: payload.platform,
        senderId: payload.senderId,
        senderName: payload.senderName,
        text: payload.text,
        commentedAt: payload.commentedAt,
        intent: 'other',
        intentConfidence: 0,
        isClassified: false,
        status: 'new',
        isReturningCustomer: false,
      } as any),
    )) as unknown as PostCommentEntity;

    // Classify async
    this.ai
      .classifyCommentIntent(comment.text)
      .then((r) =>
        this.comments.update({ id: comment.id }, {
          intent: r.intent,
          intentConfidence: r.confidence,
          isClassified: true,
        } as any),
      )
      .catch(() => {});

    // Run auto-rules — resolve token from channel
    this.getChannelForOrg(
      payload.orgId,
      payload.platform as 'facebook' | 'instagram',
    )
      .then(({ accessToken }) =>
        this.runAutoRules(payload.orgId, comment, accessToken),
      )
      .catch(() => {});
  }

  private ruleMatches(
    rule: AutoReplyRuleEntity,
    comment: PostCommentEntity,
  ): boolean {
    if (rule.platforms.length > 0 && !rule.platforms.includes(comment.platform))
      return false;
    if (rule.trigger === 'all') return true;
    if (rule.trigger === 'keyword')
      return rule.keywords.some((k) =>
        comment.text.toLowerCase().includes(k.toLowerCase()),
      );
    if (rule.trigger === 'intent') return rule.intents.includes(comment.intent);
    return false;
  }

  private interpolate(template: string, comment: PostCommentEntity): string {
    return template
      .replace(/{{name}}/g, comment.senderName)
      .replace(/{{comment}}/g, comment.text);
  }

  async debugToken(orgId: string): Promise<{
    pageId: string | undefined;
    permissions: any;
    postsResponse: any;
  }> {
    const channel = await this.channels.findOne({
      where: { orgId, type: 'FACEBOOK', status: 'ACTIVE' } as any,
    });

    if (!channel)
      throw new NotFoundException('No active Facebook channel found');

    const token = this.decryptToken(channel.accessTokenEnc!);

    // Check token permissions
    const [permRes, postsRes] = await Promise.all([
      fetch(
        `https://graph.facebook.com/v19.0/me/permissions?access_token=${token}`,
      ),
      fetch(
        `https://graph.facebook.com/v19.0/${channel.pageId}/posts?fields=id,message,created_time&limit=3&access_token=${token}`,
      ),
    ]);

    const [permissions, postsResponse] = await Promise.all([
      permRes.json(),
      postsRes.json(),
    ]);

    return {
      pageId: channel.pageId,
      permissions, // shows which scopes are granted vs declined
      postsResponse, // direct Graph API result — empty [] means missing scope
    };
  }
}
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
// /* eslint-disable @typescript-eslint/no-unsafe-member-access */
// /* eslint-disable @typescript-eslint/no-unsafe-assignment */
// /* eslint-disable @typescript-eslint/no-explicit-any */
// // apps/api/src/modules/comments/comments.service.ts
// //
// // Uses AiService for all Claude calls — no direct Anthropic SDK import.
// // CommentsService stays focused on comment business logic;
// // AiService owns all LLM interactions.

// import { Injectable, Logger, NotFoundException } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository, In } from 'typeorm';
// import { PostEntity } from './entities/post.entity';
// import {
//   PostCommentEntity,
//   CommentIntent,
//   CommentStatus,
// } from './entities/post-comment.entity';
// import { AutoReplyRuleEntity } from './entities/auto-reply-rule.entity';
// import { AiService } from '../ai/ai.service';

// // ─── DTOs ─────────────────────────────────────────────────────────────────────

// export interface ListCommentsQuery {
//   postId?: string;
//   intent?: CommentIntent;
//   status?: CommentStatus;
//   keyword?: string;
//   platform?: string;
//   returningOnly?: boolean;
//   unrepliedOnly?: boolean;
//   limit?: number;
//   offset?: number;
// }

// export interface BulkReplyDto {
//   commentIds: string[];
//   replyText: string;
// }
// export interface BulkMoveToInboxDto {
//   commentIds: string[];
//   dmText?: string;
// }
// export interface BulkSendPaymentDto {
//   commentIds: string[];
//   productId: string;
//   messageText?: string;
// }
// export interface BulkHideDto {
//   commentIds: string[];
// }

// export interface CreateAutoRuleDto {
//   name: string;
//   trigger: string;
//   keywords?: string[];
//   intents?: string[];
//   platforms?: string[];
//   action: string;
//   replyTemplate?: string;
//   dmTemplate?: string;
//   productId?: string;
//   priority?: number;
// }

// @Injectable()
// export class CommentsService {
//   private readonly logger = new Logger(CommentsService.name);

//   constructor(
//     @InjectRepository(PostEntity)
//     private posts: Repository<PostEntity>,
//     @InjectRepository(PostCommentEntity)
//     private comments: Repository<PostCommentEntity>,
//     @InjectRepository(AutoReplyRuleEntity)
//     private rules: Repository<AutoReplyRuleEntity>,
//     // AiService owns all LLM calls — injected here instead of raw Anthropic SDK
//     private ai: AiService,
//   ) {}

//   // ── Posts ──────────────────────────────────────────────────────────────────

//   async listPosts(orgId: string): Promise<PostEntity[]> {
//     return this.posts.find({
//       where: { orgId } as any,
//       order: { createdAt: 'DESC' } as any,
//       take: 50,
//     });
//   }

//   async getPost(orgId: string, postId: string): Promise<PostEntity> {
//     const post = await this.posts.findOne({
//       where: { id: postId, orgId } as any,
//     });
//     if (!post) throw new NotFoundException('Post not found');
//     return post;
//   }

//   async syncPosts(
//     orgId: string,
//     pageId: string,
//     accessToken: string,
//   ): Promise<PostEntity[]> {
//     const fields = 'id,message,story,created_time,permalink_url,full_picture';
//     const [postsRes, livesRes] = await Promise.all([
//       fetch(
//         `https://graph.facebook.com/v19.0/${pageId}/posts?fields=${fields}&limit=25&access_token=${accessToken}`,
//       ),
//       fetch(
//         `https://graph.facebook.com/v19.0/${pageId}/live_videos?fields=id,title,description,status,created_time,permalink_url&limit=10&access_token=${accessToken}`,
//       ),
//     ]);

//     const postsData = (await postsRes.json()) as any;
//     const livesData = (await livesRes.json()) as any;
//     const upserted: PostEntity[] = [];

//     for (const p of postsData.data ?? []) {
//       const existing = await this.posts.findOne({
//         where: { orgId, platformPostId: p.id } as any,
//       });
//       if (existing) {
//         upserted.push(existing);
//         continue;
//       }
//       const post = (await this.posts.save(
//         this.posts.create({
//           orgId,
//           platformPostId: p.id,
//           platform: 'facebook',
//           type: 'post',
//           message: p.message ?? p.story,
//           permalink: p.permalink_url,
//           thumbnailUrl: p.full_picture,
//           postedAt: new Date(p.created_time),
//           isLive: false,
//         } as any),
//       )) as unknown as PostEntity;
//       upserted.push(post);
//     }

//     for (const l of livesData.data ?? []) {
//       const existing = await this.posts.findOne({
//         where: { orgId, platformPostId: l.id } as any,
//       });
//       if (existing) {
//         upserted.push(existing);
//         continue;
//       }
//       const post = (await this.posts.save(
//         this.posts.create({
//           orgId,
//           platformPostId: l.id,
//           platform: 'facebook',
//           type: 'live',
//           title: l.title,
//           message: l.description,
//           permalink: l.permalink_url,
//           isLive: l.status === 'LIVE',
//           liveStartedAt: new Date(l.created_time),
//           postedAt: new Date(l.created_time),
//         } as any),
//       )) as unknown as PostEntity;
//       upserted.push(post);
//     }

//     return upserted;
//   }

//   async syncComments(
//     orgId: string,
//     postId: string,
//     accessToken: string,
//   ): Promise<{ synced: number; classified: number }> {
//     const post = await this.getPost(orgId, postId);
//     const fields = 'id,message,from,created_time,parent';
//     let url: string | null =
//       `https://graph.facebook.com/v19.0/${post.platformPostId}/comments?fields=${fields}&limit=100&access_token=${accessToken}`;

//     let synced = 0;
//     let classified = 0;

//     while (url) {
//       const res = await fetch(url);
//       const data = (await res.json()) as any;

//       for (const c of data.data ?? []) {
//         const existing = await this.comments.findOne({
//           where: { platformCommentId: c.id } as any,
//         });
//         if (existing) continue;

//         const comment = (await this.comments.save(
//           this.comments.create({
//             orgId,
//             postId: post.id,
//             platformCommentId: c.id,
//             parentCommentId: c.parent?.id,
//             platform: post.platform,
//             senderId: c.from?.id ?? 'unknown',
//             senderName: c.from?.name ?? 'Unknown',
//             text: c.message ?? '',
//             commentedAt: new Date(c.created_time),
//             intent: 'other',
//             intentConfidence: 0,
//             isClassified: false,
//             status: 'new',
//             isReturningCustomer: false,
//           } as any),
//         )) as unknown as PostCommentEntity;
//         synced++;

//         try {
//           // Delegate to AiService — single source of truth for all LLM calls
//           const result = await this.ai.classifyCommentIntent(comment.text);
//           await this.comments.update({ id: comment.id }, {
//             intent: result.intent,
//             intentConfidence: result.confidence,
//             isClassified: true,
//           } as any);
//           classified++;
//         } catch {
//           /* non-fatal — comment still saved */
//         }

//         await this.runAutoRules(orgId, comment, accessToken).catch(() => {});
//       }

//       url = data.paging?.next ?? null;
//     }

//     await this.posts.update({ id: post.id }, {
//       processedCount: synced,
//       syncedAt: new Date(),
//     } as any);
//     return { synced, classified };
//   }

//   // ── Comments ───────────────────────────────────────────────────────────────

//   async listComments(
//     orgId: string,
//     query: ListCommentsQuery,
//   ): Promise<{ items: PostCommentEntity[]; total: number }> {
//     const qb = this.comments
//       .createQueryBuilder('c')
//       .where('c.org_id = :orgId', { orgId });
//     if (query.postId)
//       qb.andWhere('c.post_id = :postId', { postId: query.postId });
//     if (query.intent)
//       qb.andWhere('c.intent = :intent', { intent: query.intent });
//     if (query.status)
//       qb.andWhere('c.status = :status', { status: query.status });
//     if (query.platform)
//       qb.andWhere('c.platform = :platform', { platform: query.platform });
//     if (query.returningOnly) qb.andWhere('c.is_returning_customer = true');
//     if (query.unrepliedOnly) qb.andWhere("c.status = 'new'");
//     if (query.keyword)
//       qb.andWhere('LOWER(c.text) LIKE :kw', {
//         kw: `%${query.keyword.toLowerCase()}%`,
//       });
//     qb.orderBy('c.commented_at', 'DESC');
//     const total = await qb.getCount();
//     const items = await qb
//       .limit(query.limit ?? 50)
//       .offset(query.offset ?? 0)
//       .getMany();
//     return { items, total };
//   }

//   // ── Bulk ops ───────────────────────────────────────────────────────────────

//   async bulkReply(
//     orgId: string,
//     dto: BulkReplyDto,
//     accessToken: string,
//     userId: string,
//   ): Promise<{ success: number; failed: number }> {
//     let success = 0;
//     let failed = 0;
//     const comments = await this.comments.find({
//       where: { id: In(dto.commentIds), orgId } as any,
//     });
//     for (const c of comments) {
//       try {
//         const res = await fetch(
//           `https://graph.facebook.com/v19.0/${c.platformCommentId}/comments`,
//           {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//               message: dto.replyText,
//               access_token: accessToken,
//             }),
//           },
//         );
//         if (!res.ok) throw new Error(await res.text());
//         await this.comments.update({ id: c.id }, {
//           status: 'replied',
//           replyText: dto.replyText,
//           repliedAt: new Date(),
//           repliedBy: userId,
//         } as any);
//         success++;
//       } catch (err) {
//         this.logger.error(`Reply failed ${c.id}:`, err);
//         failed++;
//       }
//     }
//     return { success, failed };
//   }

//   async bulkMoveToInbox(
//     orgId: string,
//     dto: BulkMoveToInboxDto,
//     accessToken: string,
//   ): Promise<{ success: number; failed: number }> {
//     let success = 0;
//     let failed = 0;
//     const comments = await this.comments.find({
//       where: { id: In(dto.commentIds), orgId } as any,
//     });
//     const dmText =
//       dto.dmText ??
//       'Hi! Thanks for your comment. How can we help you today? 😊';
//     for (const c of comments) {
//       try {
//         const res = await fetch(
//           'https://graph.facebook.com/v19.0/me/messages',
//           {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//               recipient: { id: c.senderId },
//               message: { text: dmText },
//               access_token: accessToken,
//             }),
//           },
//         );
//         if (!res.ok) throw new Error(await res.text());
//         await this.comments.update({ id: c.id }, {
//           status: 'moved_to_inbox',
//           movedToInboxAt: new Date(),
//         } as any);
//         success++;
//       } catch (err) {
//         this.logger.error(`DM failed ${c.senderId}:`, err);
//         failed++;
//       }
//     }
//     return { success, failed };
//   }

//   async bulkHide(
//     orgId: string,
//     dto: BulkHideDto,
//     accessToken: string,
//   ): Promise<{ success: number; failed: number }> {
//     let success = 0;
//     let failed = 0;
//     const comments = await this.comments.find({
//       where: { id: In(dto.commentIds), orgId } as any,
//     });
//     for (const c of comments) {
//       try {
//         const res = await fetch(
//           `https://graph.facebook.com/v19.0/${c.platformCommentId}`,
//           {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//               is_hidden: true,
//               access_token: accessToken,
//             }),
//           },
//         );
//         if (!res.ok) throw new Error(await res.text());
//         await this.comments.update({ id: c.id }, { status: 'hidden' } as any);
//         success++;
//       } catch (err) {
//         this.logger.error(`Hide failed ${c.id}:`, err);
//         failed++;
//       }
//     }
//     return { success, failed };
//   }

//   // ── Auto-rules ─────────────────────────────────────────────────────────────

//   async listRules(orgId: string): Promise<AutoReplyRuleEntity[]> {
//     return this.rules.find({
//       where: { orgId } as any,
//       order: { priority: 'ASC' } as any,
//     });
//   }

//   async createRule(
//     orgId: string,
//     dto: CreateAutoRuleDto,
//   ): Promise<AutoReplyRuleEntity> {
//     return (await this.rules.save(
//       this.rules.create({ orgId, ...dto } as any),
//     )) as unknown as AutoReplyRuleEntity;
//   }

//   async updateRule(
//     orgId: string,
//     id: string,
//     dto: Partial<CreateAutoRuleDto>,
//   ): Promise<AutoReplyRuleEntity> {
//     const rule = await this.rules.findOne({ where: { id, orgId } as any });
//     if (!rule) throw new NotFoundException('Rule not found');
//     await this.rules.update({ id }, dto as any);
//     return this.rules.findOne({
//       where: { id },
//     }) as Promise<AutoReplyRuleEntity>;
//   }

//   async deleteRule(orgId: string, id: string): Promise<void> {
//     const rule = await this.rules.findOne({ where: { id, orgId } as any });
//     if (!rule) throw new NotFoundException('Rule not found');
//     await this.rules.delete({ id });
//   }

//   async toggleRule(orgId: string, id: string): Promise<AutoReplyRuleEntity> {
//     const rule = await this.rules.findOne({ where: { id, orgId } as any });
//     if (!rule) throw new NotFoundException('Rule not found');
//     await this.rules.update({ id }, { isActive: !rule.isActive } as any);
//     return this.rules.findOne({
//       where: { id },
//     }) as Promise<AutoReplyRuleEntity>;
//   }

//   async runAutoRules(
//     orgId: string,
//     comment: PostCommentEntity,
//     accessToken: string,
//   ): Promise<void> {
//     const activeRules = await this.rules.find({
//       where: { orgId, isActive: true } as any,
//       order: { priority: 'ASC' } as any,
//     });
//     for (const rule of activeRules) {
//       if (!this.ruleMatches(rule, comment)) continue;
//       try {
//         if (rule.action === 'reply' || rule.action === 'reply_and_move') {
//           await this.bulkReply(
//             orgId,
//             {
//               commentIds: [comment.id],
//               replyText: this.interpolate(rule.replyTemplate ?? '', comment),
//             },
//             accessToken,
//             'auto',
//           );
//         }
//         if (
//           rule.action === 'move_to_inbox' ||
//           rule.action === 'reply_and_move'
//         ) {
//           await this.bulkMoveToInbox(
//             orgId,
//             {
//               commentIds: [comment.id],
//               dmText: this.interpolate(rule.dmTemplate ?? '', comment),
//             },
//             accessToken,
//           );
//         }
//         if (rule.action === 'hide') {
//           await this.bulkHide(orgId, { commentIds: [comment.id] }, accessToken);
//         }
//         await this.rules.update({ id: rule.id }, {
//           fireCount: rule.fireCount + 1,
//           lastFiredAt: new Date(),
//         } as any);
//         break;
//       } catch (err) {
//         this.logger.error(`Auto-rule ${rule.id} failed:`, err);
//       }
//     }
//   }

//   async ingestWebhookComment(payload: {
//     orgId: string;
//     postId: string;
//     platformCommentId: string;
//     senderId: string;
//     senderName: string;
//     text: string;
//     commentedAt: Date;
//     platform: string;
//     accessToken: string;
//   }): Promise<void> {
//     const existing = await this.comments.findOne({
//       where: { platformCommentId: payload.platformCommentId } as any,
//     });
//     if (existing) return;

//     const comment = (await this.comments.save(
//       this.comments.create({
//         orgId: payload.orgId,
//         postId: payload.postId,
//         platformCommentId: payload.platformCommentId,
//         platform: payload.platform,
//         senderId: payload.senderId,
//         senderName: payload.senderName,
//         text: payload.text,
//         commentedAt: payload.commentedAt,
//         intent: 'other',
//         intentConfidence: 0,
//         isClassified: false,
//         status: 'new',
//         isReturningCustomer: false,
//       } as any),
//     )) as unknown as PostCommentEntity;

//     // Classify async via AiService — don't block webhook response
//     this.ai
//       .classifyCommentIntent(comment.text)
//       .then((r) =>
//         this.comments.update({ id: comment.id }, {
//           intent: r.intent,
//           intentConfidence: r.confidence,
//           isClassified: true,
//         } as any),
//       )
//       .catch(() => {});

//     this.runAutoRules(payload.orgId, comment, payload.accessToken).catch(
//       () => {},
//     );
//   }

//   // ── Private helpers ────────────────────────────────────────────────────────

//   private ruleMatches(
//     rule: AutoReplyRuleEntity,
//     comment: PostCommentEntity,
//   ): boolean {
//     if (rule.platforms.length > 0 && !rule.platforms.includes(comment.platform))
//       return false;
//     if (rule.trigger === 'all') return true;
//     if (rule.trigger === 'keyword')
//       return rule.keywords.some((k) =>
//         comment.text.toLowerCase().includes(k.toLowerCase()),
//       );
//     if (rule.trigger === 'intent') return rule.intents.includes(comment.intent);
//     return false;
//   }

//   private interpolate(template: string, comment: PostCommentEntity): string {
//     return template
//       .replace(/{{name}}/g, comment.senderName)
//       .replace(/{{comment}}/g, comment.text);
//   }
// }
