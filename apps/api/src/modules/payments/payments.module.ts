import { Module } from '@nestjs/common';
// import { PaymentsService } from './payments.service';
// import { PaymentsController } from './payments.controller';
import { DatabaseModule, OutboxModule, IdempotencyModule } from '@app/common';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { PaymentEventEntity } from './entities/payment-event.entity';
import { PaymentLinkEntity } from './entities/payment-link.entity';
import { OrgPaymentProviderEntity } from '../providers/entities/org-payment-provider.entity';
import { UploadModule } from '@app/common/upload';
import { PaymentsController } from './Payments.controller.v2';
import { PaymentsService } from './Payments.service.v2';
import { MetaModule } from '../../integrations/meta/meta.module';

@Module({
  imports: [
    DatabaseModule.forFeature([
      PaymentLinkEntity,
      PaymentEventEntity,
      OrderEntity,
      OrderEventEntity,
      OrgPaymentProviderEntity,
    ]),
    MetaModule,
    OutboxModule,
    IdempotencyModule,
    UploadModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
