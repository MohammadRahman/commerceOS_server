// apps/api/src/modules/ai/ai.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@app/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ChannelEntity } from '../inbox/entities/channel.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProductEntity } from '../storefront/entities/product.entity';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { BankStatementParserModule } from '../bookkeeping/bank-statement-parser.module';

@Module({
  imports: [
    BookkeepingModule,
    ConfigModule,
    HttpModule,
    DatabaseModule.forFeature([ChannelEntity, OrderEntity, ProductEntity]),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService, BankStatementParserModule],
})
export class AiModule {}
