import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common/database/database.module';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxService } from './outbox.service';

@Module({
  imports: [DatabaseModule.forFeature([OutboxEventEntity])],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
