import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common/database/database.module';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { ShipmentEntity } from './entities/shipment.entity';
import { ShipmentEventEntity } from './entities/shipment-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { IdempotencyModule, OutboxModule, RedxProvider } from '@app/common';
import { HttpModule } from '@nestjs/axios';
import { OrgCourierProviderEntity } from '../providers/entities/org-courier-provider.entity';
import { SteadfastProvider } from '@app/common/couriers/steadfast.provider';
import { PathaoProvider } from '@app/common/couriers/pathao.provider';
import { MetaModule } from '../../integrations/meta/meta.module';

@Module({
  imports: [
    DatabaseModule.forFeature([
      ShipmentEntity,
      ShipmentEventEntity,
      OrderEntity,
      OrderEventEntity,
      OrgCourierProviderEntity,
    ]),
    OutboxModule,
    IdempotencyModule,
    HttpModule,
    MetaModule,
  ],
  controllers: [ShipmentsController],
  providers: [
    ShipmentsService,
    SteadfastProvider,
    PathaoProvider,
    RedxProvider,
  ],
})
export class ShipmentsModule {}
