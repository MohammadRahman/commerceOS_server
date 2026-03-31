/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
// apps/api/src/workers/comments.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, COMMENT_JOBS } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import {
  CommentIntent,
  CommentStatus,
  PostCommentEntity,
} from 'apps/api/src/modules/comments/entities/post-comment.entity';
import {
  AutoReplyRuleEntity,
  RuleAction,
  RuleTrigger,
} from 'apps/api/src/modules/comments/entities/auto-reply-rule.entity';

// ─── Intent map: classifier output → entity CommentIntent ─────────────────────
const INTENT_MAP: Record<string, CommentIntent> = {
  purchase_intent: 'buy_intent',
  complaint: 'complaint',
  question: 'other',
  other: 'other',
};

@Processor(QUEUE_NAMES.COMMENTS, { concurrency: 10 })
@Injectable()
export class CommentsProcessor extends WorkerHost {
  private readonly logger = new Logger(CommentsProcessor.name);

  constructor(
    private readonly queue: QueueService,
    @InjectRepository(PostCommentEntity)
    private readonly comments: Repository<PostCommentEntity>,
    @InjectRepository(AutoReplyRuleEntity)
    private readonly rules: Repository<AutoReplyRuleEntity>,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.debug(`[Comments] Processing ${job.name} id=${job.id}`);

    switch (job.name) {
      case COMMENT_JOBS.CLASSIFY_INTENT:
        return this.handleClassifyIntent(job.data);
      case COMMENT_JOBS.TRIGGER_AUTO_REPLY:
        return this.handleAutoReply(job.data);
      case COMMENT_JOBS.PROCESS_BATCH:
        return this.handleBatch(job.data);
      default:
        this.logger.warn(`[Comments] Unknown job: ${job.name}`);
    }
  }

  // ─── Intent classification ─────────────────────────────────────────────────
  // Classify → persist → trigger rule matching.
  // Swap classifyIntent() for an AI call when ready — interface stays the same.

  private async handleClassifyIntent(data: {
    commentId: string;
    orgId: string;
    text: string;
    platform: string;
    postId: string;
  }) {
    this.logger.log(`[Comments] Classifying comment ${data.commentId}`);

    const { intent, confidence } = this.classifyIntent(data.text);

    // Persist to DB
    await this.comments.update(
      { id: data.commentId, orgId: data.orgId } as any,
      {
        intent: INTENT_MAP[intent] ?? 'other',
        intentConfidence: confidence,
        isClassified: true,
      } as Partial<PostCommentEntity>,
    );

    this.logger.log(`[Comments] ${data.commentId} → ${intent} (${confidence})`);

    // Always trigger rule matching — rules decide what to do with every intent
    await this.queue.comment(COMMENT_JOBS.TRIGGER_AUTO_REPLY, {
      commentId: data.commentId,
      orgId: data.orgId,
      intent,
      postId: data.postId,
      platform: data.platform,
      text: data.text,
    });
  }

  // ─── Auto-reply rule matching ──────────────────────────────────────────────
  // Enterprise pattern:
  //  1. Load active rules sorted by priority (lower = runs first)
  //  2. Filter by platform
  //  3. Match trigger: keyword | intent | all
  //  4. Execute first matching rule only
  //  5. Update comment status + rule fire stats

  private async handleAutoReply(data: {
    commentId: string;
    orgId: string;
    intent: string;
    postId: string;
    platform: string;
    text: string;
  }) {
    const comment = await this.comments.findOne({
      where: { id: data.commentId, orgId: data.orgId } as any,
    });
    if (!comment) {
      this.logger.warn(`[Comments] Comment ${data.commentId} not found`);
      return;
    }

    // Load all active rules sorted by priority
    const allRules = await this.rules.find({
      where: { orgId: data.orgId, isActive: true } as any,
      order: { priority: 'ASC' } as any,
    });

    const matchedRule = allRules.find((rule) =>
      this.ruleMatches(rule, comment, data.intent),
    );

    if (!matchedRule) {
      this.logger.debug(
        `[Comments] No rule matched ${data.commentId} (intent=${data.intent})`,
      );
      return;
    }

    this.logger.log(
      `[Comments] Rule "${matchedRule.name}" matched ${data.commentId} → ${matchedRule.action}`,
    );

    await this.executeRuleAction(matchedRule, comment);

    // Update rule fire stats
    await this.rules.update(
      { id: matchedRule.id } as any,
      {
        fireCount: (matchedRule.fireCount ?? 0) + 1,
        lastFiredAt: new Date(),
      } as any,
    );
  }

  // ─── Batch processing ──────────────────────────────────────────────────────
  // Fetches text from DB so callers don't need to pass it.
  // Used for backfill when an org connects a new channel.

  private async handleBatch(data: { commentIds: string[]; orgId: string }) {
    this.logger.log(
      `[Comments] Batch of ${data.commentIds.length} for org ${data.orgId}`,
    );

    const comments = await this.comments.find({
      where: data.commentIds.map((id) => ({
        id,
        orgId: data.orgId,
      })) as any,
      select: ['id', 'orgId', 'text', 'platform', 'postId'] as any,
    });

    await this.queue.enqueueBulk(
      QUEUE_NAMES.COMMENTS,
      comments.map((c) => ({
        name: COMMENT_JOBS.CLASSIFY_INTENT,
        data: {
          commentId: c.id,
          orgId: c.orgId,
          text: c.text,
          platform: c.platform,
          postId: c.postId,
        },
      })),
    );
  }

  // ─── Rule matching ─────────────────────────────────────────────────────────

  private ruleMatches(
    rule: AutoReplyRuleEntity,
    comment: PostCommentEntity,
    intent: string,
  ): boolean {
    // Platform filter — empty array means all platforms
    if (
      rule.platforms.length > 0 &&
      !rule.platforms.includes(comment.platform)
    ) {
      return false;
    }

    const lowerText = comment.text.toLowerCase();

    switch (rule.trigger as RuleTrigger) {
      case 'all':
        return true;

      case 'keyword':
        return rule.keywords.some((k) => lowerText.includes(k.toLowerCase()));

      case 'intent':
        return rule.intents.includes(intent);

      default:
        return false;
    }
  }

  // ─── Action execution ──────────────────────────────────────────────────────

  private async executeRuleAction(
    rule: AutoReplyRuleEntity,
    comment: PostCommentEntity,
  ): Promise<void> {
    const vars = {
      name: comment.senderName,
      product: '', // resolved from rule.productId in a future iteration
      price: '',
    };

    switch (rule.action as RuleAction) {
      case 'reply':
        await this.persistReply(comment, rule, vars);
        break;

      case 'move_to_inbox':
        await this.comments.update(
          { id: comment.id } as any,
          {
            status: 'moved_to_inbox' as CommentStatus,
            movedToInboxAt: new Date(),
          } as any,
        );
        break;

      case 'reply_and_move':
        await this.persistReply(comment, rule, vars);
        await this.comments.update(
          { id: comment.id } as any,
          {
            status: 'moved_to_inbox' as CommentStatus,
            movedToInboxAt: new Date(),
          } as any,
        );
        break;

      case 'hide':
        await this.comments.update(
          { id: comment.id } as any,
          { status: 'hidden' as CommentStatus } as any,
        );
        break;

      case 'send_payment_link':
        // Enqueue payment link job — wired when PaymentsService is injectable here
        this.logger.log(
          `[Comments] Payment link queued for comment ${comment.id}, product=${rule.productId ?? 'none'}`,
        );
        break;
    }
  }

  // ─── Reply persistence ─────────────────────────────────────────────────────
  // Stores the rendered reply text in the DB.
  // Actual platform posting (FB/IG Graph API) is a separate concern —
  // keep this processor fast and testable without external calls.

  private async persistReply(
    comment: PostCommentEntity,
    rule: AutoReplyRuleEntity,
    vars: Record<string, string>,
  ): Promise<void> {
    if (!rule.replyTemplate) return;

    const replyText = this.renderTemplate(rule.replyTemplate, vars);

    await this.comments.update(
      { id: comment.id } as any,
      {
        status: 'replied' as CommentStatus,
        replyText,
        repliedAt: new Date(),
      } as any,
    );

    this.logger.log(
      `[Comments] Reply persisted for ${comment.id}: "${replyText.slice(0, 60)}…"`,
    );
  }

  // ─── Template renderer ─────────────────────────────────────────────────────

  private renderTemplate(
    template: string,
    vars: Record<string, string>,
  ): string {
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => vars[key] ?? `{{${key}}}`,
    );
  }

  // ─── Keyword-based intent classifier ──────────────────────────────────────
  // Swap this for an AI/LLM call when ready — same return shape.

  private classifyIntent(text: string): { intent: string; confidence: number } {
    const t = text.toLowerCase();

    const matchers = [
      {
        intent: 'purchase_intent',
        confidence: 0.85,
        keywords: [
          'want',
          'buy',
          'order',
          'price',
          'how much',
          'cost',
          'available',
          'চাই',
          'অর্ডার',
          'দাম',
          'কত',
          'নিবো',
          'পাওয়া যায়',
        ],
      },
      {
        intent: 'complaint',
        confidence: 0.75,
        keywords: [
          'problem',
          'issue',
          'wrong',
          'bad',
          'terrible',
          'refund',
          'broken',
          'not working',
          'damaged',
          'fake',
          'scam',
        ],
      },
      {
        intent: 'question',
        confidence: 0.7,
        keywords: [
          '?',
          'when',
          'how',
          'where',
          'what',
          'which',
          'delivery',
          'কখন',
          'কিভাবে',
          'কোথায়',
          'কি',
          'কোনটা',
        ],
      },
    ];

    for (const m of matchers) {
      if (m.keywords.some((k) => t.includes(k))) {
        return { intent: m.intent, confidence: m.confidence };
      }
    }

    return { intent: 'other', confidence: 0.5 };
  }
}
