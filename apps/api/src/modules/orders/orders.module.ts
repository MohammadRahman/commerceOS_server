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

@Module({
  imports: [
    DatabaseModule.forFeature([
      OrderEntity,
      OrderEventEntity,
      CustomerEntity,
      CustomerIdentityEntity, // needed for inbox flow customer resolution
      ConversationEntity,
    ]),
  ],
  controllers: [OrdersController, BulkOrdersController],
  providers: [OrdersService, BulkOrdersService],
})
export class OrdersModule {}
// import { Module } from '@nestjs/common';
// import { OrdersService } from './orders.service';
// import { OrdersController } from './orders.controller';
// import { DatabaseModule } from '@app/common';
// import { ConversationEntity } from '../inbox/entities/conversation.entity';
// import { CustomerEntity } from '../inbox/entities/customer.entity';
// import { OrderEventEntity } from './entities/order-event.entity';
// import { OrderEntity } from './entities/order.entity';

// @Module({
//   imports: [
//     DatabaseModule.forFeature([
//       OrderEntity,
//       OrderEventEntity,
//       CustomerEntity,
//       ConversationEntity,
//     ]),
//   ],
//   controllers: [OrdersController],
//   providers: [OrdersService],
// })
// export class OrdersModule {}
