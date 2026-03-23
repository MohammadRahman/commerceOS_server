// apps/api/src/modules/storefront/storefront.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common';
import { StoreSettingsEntity } from './entities/store-settings.entity';
import { ProductEntity } from './entities/product.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { CustomerEntity } from '../inbox/entities/customer.entity';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [
    DatabaseModule.forFeature([
      StoreSettingsEntity,
      ProductEntity,
      OrderItemEntity,
      OrderEntity,
      OrderEventEntity,
      CustomerEntity,
    ]),
  ],
  controllers: [StorefrontController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
