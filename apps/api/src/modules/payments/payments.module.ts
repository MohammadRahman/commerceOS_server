import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { DatabaseModule, OutboxModule, IdempotencyModule } from '@app/common';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PaymentEventEntity } from './entities/payment-event.entity';
import { PaymentLinkEntity } from './entities/payment-link.entity';

@Module({
  imports: [
    DatabaseModule.forFeature([
      PaymentLinkEntity,
      PaymentEventEntity,
      OrderEntity,
      OrderEventEntity,
    ]),
    OutboxModule,
    IdempotencyModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
