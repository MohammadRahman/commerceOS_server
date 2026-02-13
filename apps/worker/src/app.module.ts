import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@app/common/database/database.module';
import { WorkerModule } from './worker.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/api/.env', // reuse same env for now
    }),
    DatabaseModule,
    WorkerModule,
  ],
})
export class AppModule {}
