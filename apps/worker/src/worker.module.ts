/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@app/common/database/database.module';
import { ALL_ENTITIES, RedxProvider } from '@app/common';

import { OutboxProcessor } from './workers/outbox.processor';

// Fake providers (dev fallback)
import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
import { FakeCourierProvider } from './workers/providers/fake-courier.provider';

// Real payment providers
import { BkashProvider } from './workers/providers/bkash.provider';
import { NagadProvider } from './workers/providers/nagad.provider';
import { SslCommerzProvider } from './workers/providers/sslcommerz.provider';

// Real courier providers
import { SteadfastProvider } from '@app/common/couriers/steadfast.provider';
import { PathaoProvider } from '@app/common/couriers/pathao.provider';
import { QUEUE_NAMES } from '@app/common/queue/queue.constants';
import { QueueService } from '@app/common/queue/queue.service';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsProcessor } from './processors/analytics.processor';
import { ArchivalProcessor } from './processors/archival.processor';
import { CommentsProcessor } from './processors/comments.processor';
import { LiveSalesProcessor } from './processors/live-sales.processor';
import { NotificationsProcessor } from './processors/notifications.processor';
import { SubscriptionsProcessor } from './processors/subscriptions.processor';
import { WebhooksProcessor } from './processors/webhooks.processor';
import { UploadModule } from '@app/common/upload/upload.module';
import { MetaModule } from 'apps/api/src/integrations/meta/meta.module';
import { SubscriptionModule } from 'apps/api/src/modules/subscriptions/subscriptions.module';
import { NotificationsModule } from 'apps/api/src/modules/notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { OutboxBridgeService } from './outbox-bridge.service';

@Module({
  imports: [
    HttpModule, // Register queues needed by processors
    ConfigModule,
    ScheduleModule.forRoot(),
    NotificationsModule,
    SubscriptionModule,
    MetaModule,
    UploadModule,
    HttpModule,
    ...Object.values(QUEUE_NAMES).map((name) =>
      BullModule.registerQueue({ name }),
    ),
    DatabaseModule.forFeature([...ALL_ENTITIES]),
  ],
  providers: [
    OutboxProcessor,
    // Payment
    FakePaymentProvider,
    BkashProvider,
    NagadProvider,
    SslCommerzProvider,
    // Courier
    FakeCourierProvider,
    SteadfastProvider,
    PathaoProvider,
    RedxProvider,
    // Queue
    QueueService,
    NotificationsProcessor,
    WebhooksProcessor,
    SubscriptionsProcessor,
    CommentsProcessor,
    LiveSalesProcessor,
    ArchivalProcessor,
    AnalyticsProcessor,
  ],
  exports: [QueueService, OutboxBridgeService],
})
export class WorkerModule {}
