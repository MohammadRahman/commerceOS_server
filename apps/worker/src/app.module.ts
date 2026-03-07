import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorkerModule } from './worker.module';
import { DatabaseModule } from '@app/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/api/.env',
    }),
    DatabaseModule,
    WorkerModule,
  ],
})
export class AppModule {}
// import { Module } from '@nestjs/common';
// import { ConfigModule } from '@nestjs/config';
// import { DatabaseModule } from '@app/common/database/database.module';
// import { WorkerModule } from './worker.module';
// import { OutboxProcessor } from './workers/outbox.processor';
// import { FakeCourierProvider } from './workers/providers/fake-courier.provider';
// import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
// import { PathaoProvider } from '@app/common';
// import { SteadfastProvider } from '@app/common';

// @Module({
//   imports: [
//     ConfigModule.forRoot({
//       isGlobal: true,
//       envFilePath: 'apps/api/.env', // reuse same env for now
//     }),
//     DatabaseModule,
//     WorkerModule,
//   ],
//   providers: [
//     OutboxProcessor,
//     FakePaymentProvider,
//     FakeCourierProvider,
//     SteadfastProvider,
//     PathaoProvider,
//   ],
// })
// export class AppModule {}
