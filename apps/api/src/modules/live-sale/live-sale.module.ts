// apps/api/src/modules/live-sale/live-sale.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { LiveSaleEntity } from './entities/live-sale.entity';
import { ProductEntity } from '../storefront/entities/product.entity';
import { PostEntity } from '../comments/entities/post.entity';
import { ChannelEntity } from '../inbox/entities/channel.entity';
import { LiveSaleService } from './live-sale.service';
import { LiveSaleController } from './live-sale.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      LiveSaleEntity,
      ProductEntity,
      PostEntity,
      ChannelEntity,
    ]),
  ],
  providers: [LiveSaleService],
  controllers: [LiveSaleController],
  exports: [LiveSaleService], // exported for CommentsService to call handleIncomingComment
})
export class LiveSaleModule {}
