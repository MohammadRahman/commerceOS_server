import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import {
  AppThrottlerModule,
  DatabaseModule,
  IdempotencyModule,
  OutboxModule,
} from '@app/common';
import { AuthModule } from './modules/auth/auth.module';
import { MeModule } from './modules/me/me.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { MetaModule } from './integrations/meta/meta.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { WhatsappModule } from './integrations/whatsapp/whatsapp.module';
import { AppLoggerModule } from '@app/common';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { AiModule } from './modules/ai/ai.module';
import { CommentsModule } from './modules/comments/comments.module';
import { LiveSaleModule } from './modules/live-sale/live-sale.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/api/.env',
    }),
    // ── Logging (Pino) — must be first so all modules get structured logs ──
    AppLoggerModule,
    // ── Rate limiting (Redis-backed) ──────────────────────────────────────
    AppThrottlerModule,

    DatabaseModule,
    TenancyModule,
    AuthModule,
    MeModule,
    InboxModule,
    MetaModule,
    IdempotencyModule,
    OrdersModule,
    OutboxModule,
    PaymentsModule,
    ShipmentsModule,
    OrganizationsModule,
    ProvidersModule,
    WhatsappModule,
    HealthModule,
    NotificationsModule,
    StorefrontModule,
    AiModule,
    CommentsModule,
    LiveSaleModule,
    PlatformAdminModule,
  ],
})
export class AppModule {}
