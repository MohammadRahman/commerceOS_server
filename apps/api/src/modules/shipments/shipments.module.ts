import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common/database/database.module';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { ShipmentEntity } from './entities/shipment.entity';
import { ShipmentEventEntity } from './entities/shipment-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { IdempotencyModule, OutboxModule } from '@app/common';

@Module({
  imports: [
    DatabaseModule.forFeature([
      ShipmentEntity,
      ShipmentEventEntity,
      OrderEntity,
      OrderEventEntity,
    ]),
    OutboxModule,
    IdempotencyModule,
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
})
export class ShipmentsModule {}
