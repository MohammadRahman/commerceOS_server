// apps/api/src/workers/outbox-bridge.service.ts
// Phase 1 migration bridge:
// OutboxService.enqueue() calls this bridge which routes to BullMQ.
// This lets us migrate queue-by-queue without touching every call site.
//
// USAGE: inject OutboxBridgeService and call bridge() in OutboxService.enqueue()
// instead of writing to the DB outbox table.

import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '@app/common/queue/queue.service';
import { QUEUE_NAMES } from '@app/common/queue/queue.constants';

// Map outbox event types → BullMQ queue + job name
const OUTBOX_TO_BULLMQ: Record<string, { queue: string; job: string }> = {
  // Subscription events
  'subscription.activated': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'subscription-activated',
  },
  'subscription.cancelled': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'subscription-cancelled',
  },
  'subscription.trial_expiring': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'trial-expiring',
  },
  'subscription.trial_expired': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'trial-expired',
  },
  'subscription.payment_failed': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'payment-failed',
  },
  'subscription.payment_proof_submitted': {
    queue: QUEUE_NAMES.NOTIFICATIONS,
    job: 'payment-proof-submitted',
  },
  'subscription.generate_checkout': {
    queue: QUEUE_NAMES.SUBSCRIPTIONS,
    job: 'generate-checkout',
  },

  // Payment events
  'payment_link.generate': {
    queue: QUEUE_NAMES.WEBHOOKS,
    job: 'process-payment',
  },

  // Meta webhook
  'meta.webhook': { queue: QUEUE_NAMES.WEBHOOKS, job: 'process-meta' },

  // Notifications
  'notification.email': { queue: QUEUE_NAMES.NOTIFICATIONS, job: 'send-email' },
  'notification.sms': { queue: QUEUE_NAMES.NOTIFICATIONS, job: 'send-sms' },
};

@Injectable()
export class OutboxBridgeService {
  private readonly logger = new Logger(OutboxBridgeService.name);

  constructor(private readonly queue: QueueService) {}

  async bridge(eventType: string, payload: any): Promise<boolean> {
    const mapping = OUTBOX_TO_BULLMQ[eventType];
    if (!mapping) {
      // Unknown event type — fall back to DB outbox (old behaviour)
      this.logger.debug(
        `[OutboxBridge] No mapping for ${eventType} — using DB outbox`,
      );
      return false;
    }

    await this.queue.enqueue(mapping.queue as any, mapping.job, payload);

    this.logger.debug(
      `[OutboxBridge] Routed ${eventType} → ${mapping.queue}:${mapping.job}`,
    );
    return true; // signal that BullMQ handled it
  }
}

// ── How to wire into OutboxService ───────────────────────────────────────────
//
// In OutboxService.enqueue(orgId, eventType, payload):
//
//   async enqueue(orgId: string, eventType: string, payload: any): Promise<void> {
//     // Try BullMQ first
//     const handled = await this.bridge.bridge(eventType, payload);
//     if (handled) return;
//
//     // Fall back to DB outbox for unmapped events
//     await this.outboxRepo.save({ orgId, eventType, payload });
//   }
//
// This lets you migrate event types one by one just by adding entries
// to OUTBOX_TO_BULLMQ above.
