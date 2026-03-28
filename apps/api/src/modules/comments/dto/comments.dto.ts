// apps/api/src/modules/comments/dto/comments.dto.ts
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsUUID,
  IsInt,
  MaxLength,
  MinLength,
  Min,
  IsEnum,
  ArrayMinSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum CommentIntentEnum {
  PRICE_QUERY = 'price_query',
  BUY_INTENT = 'buy_intent',
  AVAILABILITY = 'availability',
  COMPLAINT = 'complaint',
  SPAM = 'spam',
  OTHER = 'other',
}

export enum CommentStatusEnum {
  NEW = 'new',
  REPLIED = 'replied',
  MOVED_TO_INBOX = 'moved_to_inbox',
  HIDDEN = 'hidden',
  DELETED = 'deleted',
  PAYMENT_SENT = 'payment_sent',
}

export enum RuleTriggerEnum {
  KEYWORD = 'keyword',
  INTENT = 'intent',
  ALL = 'all',
}

export enum RuleActionEnum {
  REPLY = 'reply',
  MOVE_TO_INBOX = 'move_to_inbox',
  SEND_PAYMENT = 'send_payment_link',
  HIDE = 'hide',
  REPLY_AND_MOVE = 'reply_and_move',
}

// ─── ListCommentsQuery ────────────────────────────────────────────────────────

export class ListCommentsQuery {
  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsEnum(CommentIntentEnum)
  intent?: CommentIntentEnum;

  @IsOptional()
  @IsEnum(CommentStatusEnum)
  status?: CommentStatusEnum;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  /** Filter to returning customers only */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  returningOnly?: boolean;

  /** Filter to unreplied (status=new) only */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unrepliedOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  offset?: number;
}

// ─── BulkReplyDto ─────────────────────────────────────────────────────────────

export class BulkReplyDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  commentIds: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  replyText: string;
}

// ─── BulkMoveToInboxDto ───────────────────────────────────────────────────────

export class BulkMoveToInboxDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  commentIds: string[];

  /** Optional DM message. Falls back to a default greeting if not provided. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dmText?: string;
}

// ─── BulkHideDto ──────────────────────────────────────────────────────────────

export class BulkHideDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  commentIds: string[];
}

// ─── CreateAutoRuleDto ────────────────────────────────────────────────────────

export class CreateAutoRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsEnum(RuleTriggerEnum)
  trigger: RuleTriggerEnum;

  /** Keywords to match (case-insensitive). Required when trigger=keyword. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  /** Intent types to match. Required when trigger=intent. */
  @IsOptional()
  @IsArray()
  @IsEnum(CommentIntentEnum, { each: true })
  intents?: string[];

  /** Platform filter. Empty array = all platforms. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @IsEnum(RuleActionEnum)
  action: RuleActionEnum;

  /**
   * Public reply template. Supports {{name}} and {{comment}} variables.
   * Required when action is reply or reply_and_move.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  replyTemplate?: string;

  /**
   * DM template sent to the commenter's inbox.
   * Required when action is move_to_inbox or reply_and_move.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  dmTemplate?: string;

  /** Product to attach a payment link to. */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Lower number = runs first when multiple rules match. Default 100. */
  @IsOptional()
  @IsInt()
  @Min(1)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
