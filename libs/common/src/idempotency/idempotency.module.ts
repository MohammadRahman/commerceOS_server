import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common/database/database.module';
import { IdempotencyKeyEntity } from './idempotency-key.entity';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [DatabaseModule.forFeature([IdempotencyKeyEntity])],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
