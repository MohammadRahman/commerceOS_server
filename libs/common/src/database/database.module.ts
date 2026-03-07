// v3
// libs/common/src/database/database.module.ts  v3
// Reads same env chain as typeorm.config.ts.
// DATABASE_URL fallback handles Railway where individual vars aren't set.

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const env = process.env.NODE_ENV ?? 'development';
const root = path.resolve(__dirname, '../../../../'); // up from libs/common/src/database/
const api = path.join(root, 'apps', 'api');

function loadIfExists(filePath: string) {
  if (fs.existsSync(filePath))
    dotenv.config({ path: filePath, override: false });
}

loadIfExists(path.join(api, '.env'));
loadIfExists(path.join(api, `.env.${env}`));
loadIfExists(path.join(api, `.env.${env}.local`));

// Parse DATABASE_URL if individual vars aren't set (Railway injects this)
if (process.env.DATABASE_URL && !process.env.POSTGRES_HOST) {
  const u = new URL(process.env.DATABASE_URL);
  process.env.POSTGRES_HOST = u.hostname;
  process.env.POSTGRES_PORT = u.port || '5432';
  process.env.POSTGRES_USERNAME = u.username;
  process.env.POSTGRES_PASSWORD = u.password;
  process.env.POSTGRES_DATABASE = u.pathname.replace('/', '');
}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const isProd = config.get('NODE_ENV') === 'production';

        // Explicit boolean cast — env vars are always strings
        // TypeORM would treat string "false" as truthy → catastrophic in prod
        const syncRaw = config.get<string>('POSTGRES_SYNCHRONIZE', 'false');
        const synchronize = syncRaw === 'true';

        if (synchronize && isProd) {
          throw new Error(
            '[DatabaseModule] POSTGRES_SYNCHRONIZE=true is not allowed in production.\n' +
              'Run: NODE_ENV=production npm run migration:run',
          );
        }
        if (synchronize) {
          console.warn(
            '[DatabaseModule] ⚠️  POSTGRES_SYNCHRONIZE=true — dev only, never use in prod',
          );
        }

        const host = config.getOrThrow<string>('POSTGRES_HOST');
        const port = config.getOrThrow<number>('POSTGRES_PORT');
        const database = config.getOrThrow<string>('POSTGRES_DATABASE');
        const username = config.getOrThrow<string>('POSTGRES_USERNAME');
        const password = config.getOrThrow<string>('POSTGRES_PASSWORD');

        console.log(
          `[DatabaseModule] ${host}:${port}/${database} [${isProd ? 'prod' : 'dev'}]`,
        );

        return {
          type: 'postgres' as const,
          host,
          port,
          database,
          username,
          password,
          autoLoadEntities: true,
          synchronize,
          migrationsTableName: 'typeorm_migrations',
          extra: {
            max: isProd ? 20 : 5,
            min: isProd ? 2 : 1,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
            idle_in_transaction_session_timeout: 60_000,
          },
          ssl: isProd ? { rejectUnauthorized: true } : false,
          logging: ['error', 'warn'] as const,
          maxQueryExecutionTime: 1000,
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {
  static forFeature(models: EntityClassOrSchema[]) {
    return TypeOrmModule.forFeature(models);
  }
}
// // v2
// import { Module } from '@nestjs/common';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';

// @Module({
//   imports: [
//     ConfigModule,
//     TypeOrmModule.forRootAsync({
//       useFactory: (configService: ConfigService) => {
//         // CRITICAL: getOrThrow returns string "false" not boolean false
//         // TypeORM treats string "false" as truthy → synchronize would be ON
//         // Always cast explicitly
//         const syncRaw = configService.get<string>(
//           'POSTGRES_SYNCHRONIZE',
//           'false',
//         );
//         const synchronize = syncRaw === 'true';

//         if (synchronize && configService.get('NODE_ENV') === 'production') {
//           throw new Error(
//             'POSTGRES_SYNCHRONIZE must not be true in production. Use migrations.',
//           );
//         }

//         return {
//           type: 'postgres',
//           host: configService.getOrThrow<string>('POSTGRES_HOST'),
//           port: configService.getOrThrow<number>('POSTGRES_PORT'),
//           database: configService.getOrThrow<string>('POSTGRES_DATABASE'),
//           username: configService.getOrThrow<string>('POSTGRES_USERNAME'),
//           password: configService.getOrThrow<string>('POSTGRES_PASSWORD'),
//           autoLoadEntities: true,
//           synchronize,
//         };
//       },
//       inject: [ConfigService],
//     }),
//   ],
// })
// export class DatabaseModule {
//   static forFeature(models: EntityClassOrSchema[]) {
//     return TypeOrmModule.forFeature(models);
//   }
// }
