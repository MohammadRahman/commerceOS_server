// libs/common/src/queue/queue.constants.ts
// Single source of truth for all queue names and job types.
// Import from here everywhere — never hardcode queue names as strings.

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  WEBHOOKS: 'webhooks',
  SUBSCRIPTIONS: 'subscriptions',
  COMMENTS: 'comments',
  LIVE_SALES: 'live-sales',
  ARCHIVAL: 'archival',
  ANALYTICS: 'analytics',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Notification jobs ────────────────────────────────────────────────────────
export const NOTIFICATION_JOBS = {
  SEND_EMAIL: 'send-email',
  SEND_SMS: 'send-sms',
  TRIAL_EXPIRING: 'trial-expiring',
  TRIAL_EXPIRED: 'trial-expired',
  SUBSCRIPTION_ACTIVATED: 'subscription-activated',
  SUBSCRIPTION_CANCELLED: 'subscription-cancelled',
  PAYMENT_RECEIVED: 'payment-received',
  PAYMENT_FAILED: 'payment-failed',
  PAYMENT_PROOF_SUBMITTED: 'payment-proof-submitted',
} as const;

// ─── Webhook jobs ─────────────────────────────────────────────────────────────
export const WEBHOOK_JOBS = {
  PROCESS_META: 'process-meta',
  PROCESS_PAYMENT: 'process-payment',
  PROCESS_SUBSCRIPTION: 'process-subscription',
} as const;

// ─── Subscription jobs ────────────────────────────────────────────────────────
export const SUBSCRIPTION_JOBS = {
  CHECK_TRIAL_EXPIRIES: 'check-trial-expiries',
  PROCESS_RENEWAL: 'process-renewal',
  ACTIVATE_PLAN: 'activate-plan',
  GENERATE_CHECKOUT: 'generate-checkout',
} as const;

// ─── Comment jobs ─────────────────────────────────────────────────────────────
export const COMMENT_JOBS = {
  CLASSIFY_INTENT: 'classify-intent',
  TRIGGER_AUTO_REPLY: 'trigger-auto-reply',
  PROCESS_BATCH: 'process-batch',
} as const;

// ─── Live sale jobs ───────────────────────────────────────────────────────────
export const LIVE_SALE_JOBS = {
  PROCESS_COMMENT: 'process-comment',
  CREATE_ORDER: 'create-order',
  SEND_PAYMENT_LINK: 'send-payment-link',
  UPDATE_COUNTERS: 'update-counters',
} as const;

// ─── Archival jobs ────────────────────────────────────────────────────────────
export const ARCHIVAL_JOBS = {
  ARCHIVE_ORG_COMMENTS: 'archive-org-comments',
  ARCHIVE_ALL_ORGS: 'archive-all-orgs',
  RESTORE_FROM_S3: 'restore-from-s3',
} as const;

// ─── Analytics jobs ───────────────────────────────────────────────────────────
export const ANALYTICS_JOBS = {
  ROLLUP_HOURLY: 'rollup-hourly',
  ROLLUP_DAILY: 'rollup-daily',
  ROLLUP_ORG: 'rollup-org',
} as const;
