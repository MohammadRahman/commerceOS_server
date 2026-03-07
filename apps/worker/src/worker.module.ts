import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@app/common/database/database.module';
import { ALL_ENTITIES, RedxProvider } from '@app/common';

import { OutboxProcessor } from './workers/outbox.processor';

// Fake providers (dev fallback)
import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
import { FakeCourierProvider } from './workers/providers/fake-courier.provider';

// Real payment providers
import { BkashProvider } from './workers/providers/bkash.provider';
import { NagadProvider } from './workers/providers/nagad.provider';
import { SslCommerzProvider } from './workers/providers/sslcommerz.provider';

// Real courier providers
import { SteadfastProvider } from '@app/common/couriers/steadfast.provider';
import { PathaoProvider } from '@app/common/couriers/pathao.provider';

@Module({
  imports: [HttpModule, DatabaseModule.forFeature([...ALL_ENTITIES])],
  providers: [
    OutboxProcessor,
    // Payment
    FakePaymentProvider,
    BkashProvider,
    NagadProvider,
    SslCommerzProvider,
    // Courier
    FakeCourierProvider,
    SteadfastProvider,
    PathaoProvider,
    RedxProvider,
  ],
})
export class WorkerModule {}
// import { Module } from '@nestjs/common';
// import { HttpModule } from '@nestjs/axios';
// import { DatabaseModule } from '@app/common/database/database.module';
// import { ALL_ENTITIES } from '@app/common';

// import { OutboxProcessor } from './workers/outbox.processor';

// // Fake providers (dev fallback)
// import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
// import { FakeCourierProvider } from './workers/providers/fake-courier.provider';

// // Real payment providers
// import { BkashProvider } from './workers/providers/bkash.provider';
// import { NagadProvider } from './workers/providers/nagad.provider';
// import { SslCommerzProvider } from './workers/providers/sslcommerz.provider';

// // Real courier providers
// import { SteadfastProvider } from '@app/common/couriers/steadfast.provider';
// import { PathaoProvider } from '@app/common/couriers/pathao.provider';

// @Module({
//   imports: [HttpModule, DatabaseModule.forFeature([...ALL_ENTITIES])],
//   providers: [
//     OutboxProcessor,
//     // Payment
//     FakePaymentProvider,
//     BkashProvider,
//     NagadProvider,
//     SslCommerzProvider,
//     // Courier
//     FakeCourierProvider,
//     SteadfastProvider,
//     PathaoProvider,
//   ],
// })
// export class WorkerModule {}
// import { Module } from '@nestjs/common';
// import { DatabaseModule } from '@app/common/database/database.module';

// import { ALL_ENTITIES, PathaoProvider, SteadfastProvider } from '@app/common';
// import { FakePaymentProvider } from './workers/providers/fake-payment.provider';
// import { FakeCourierProvider } from './workers/providers/fake-courier.provider';
// import { OutboxProcessor } from './workers/outbox.processor';
// import { BkashProvider } from './workers/providers/bkash.provider';
// import { NagadProvider } from './workers/providers/nagad.provider';
// import { SslCommerzProvider } from './workers/providers/sslcommerz.provider';
// import { HttpModule } from '@nestjs/axios';

// @Module({
//   imports: [HttpModule, DatabaseModule.forFeature([...ALL_ENTITIES])],
//   providers: [
//     OutboxProcessor,
//     // Payment
//     FakePaymentProvider,
//     BkashProvider,
//     NagadProvider,
//     SslCommerzProvider,
//     // Courier
//     FakeCourierProvider,
//     SteadfastProvider,
//     PathaoProvider,
//   ],
// })
// export class WorkerModule {}
