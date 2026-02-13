import { Module } from '@nestjs/common';
import { DatabaseModule } from '@app/common/database/database.module';

import { ALL_ENTITIES } from '@app/common';
import { OutboxProcessor } from './workers/providers/outbox.processor';
import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
import { FakeCourierProvider } from './workers/providers/fake-courier.provider';

@Module({
  imports: [DatabaseModule.forFeature([...ALL_ENTITIES])],
  providers: [OutboxProcessor, FakePaymentProvider, FakeCourierProvider],
})
export class WorkerModule {}
