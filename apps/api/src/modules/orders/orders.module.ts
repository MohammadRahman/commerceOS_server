import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { DatabaseModule } from '@app/common';
import { ConversationEntity } from '../inbox/entities/conversation.entity';
import { CustomerEntity } from '../inbox/entities/customer.entity';
import { CustomerIdentityEntity } from '../inbox/entities/customer-identity.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { BulkOrdersController } from './bulk-orders.controller';
import { BulkOrdersService } from './bulk-orders.service';
import { MetaModule } from '../../integrations/meta/meta.module';

@Module({
  imports: [
    DatabaseModule.forFeature([
      OrderEntity,
      OrderEventEntity,
      CustomerEntity,
      CustomerIdentityEntity, // needed for inbox flow customer resolution
      ConversationEntity,
    ]),
    MetaModule,
  ],
  controllers: [BulkOrdersController, OrdersController],
  providers: [BulkOrdersService, OrdersService],
})
export class OrdersModule {}
