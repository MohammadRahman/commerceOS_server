import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { DatabaseModule, IdempotencyModule, OutboxModule } from '@app/common';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/api/.env',
    }),
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
  ],
})
export class AppModule {}
