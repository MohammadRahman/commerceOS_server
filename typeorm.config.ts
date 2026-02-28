// v3
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/api/.env' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USERNAME,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,

  synchronize: false,

  entities: [
    path.join(__dirname, 'apps/api/src/**/*.entity.{ts,js}'),
    path.join(__dirname, 'libs/common/src/**/*.entity.{ts,js}'),
  ],

  migrations: [path.join(__dirname, 'migrations/*.{js,ts}')],

  // 'each' = each migration runs in its own transaction by default,
  // BUT individual migrations can set transaction=false to opt out
  // (needed for CREATE INDEX which can't run inside a transaction)
  migrationsTransactionMode: 'each',

  maxQueryExecutionTime: 1000,

  logging:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error', 'warn'],

  extra: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  },

  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : false,
});
// // v2
// import 'reflect-metadata';
// import { DataSource } from 'typeorm';
// import * as path from 'path';
// import * as dotenv from 'dotenv';

// dotenv.config({ path: 'apps/api/.env' });

// export const AppDataSource = new DataSource({
//   type: 'postgres',
//   host: process.env.POSTGRES_HOST,
//   port: Number(process.env.POSTGRES_PORT),
//   username: process.env.POSTGRES_USERNAME,
//   password: process.env.POSTGRES_PASSWORD,
//   database: process.env.POSTGRES_DATABASE,

//   synchronize: false, // NEVER true — use migrations

//   entities: [
//     path.join(__dirname, 'apps/api/src/**/*.entity.{ts,js}'),
//     path.join(__dirname, 'libs/common/src/**/*.entity.{ts,js}'),
//   ],

//   // ✅ Fixed: picks up both .ts (dev) and .js (compiled prod) migrations
//   migrations: [path.join(__dirname, 'migrations/*.{js,ts}')],

//   maxQueryExecutionTime: 1000,

//   logging:
//     process.env.NODE_ENV === 'development'
//       ? ['query', 'error', 'warn']
//       : ['error', 'warn'],

//   extra: {
//     max: 10,
//     min: 2,
//     idleTimeoutMillis: 30_000,
//     connectionTimeoutMillis: 5_000,
//     statement_timeout: 30_000,
//     idle_in_transaction_session_timeout: 60_000,
//   },

//   ssl:
//     process.env.NODE_ENV === 'production'
//       ? { rejectUnauthorized: true }
//       : false,
// });
// v1
// import 'reflect-metadata';
// import { DataSource } from 'typeorm';
// import * as path from 'path';
// import * as dotenv from 'dotenv';

// dotenv.config({ path: 'apps/api/.env' });

// export const AppDataSource = new DataSource({
//   type: 'postgres',
//   host: process.env.POSTGRES_HOST,
//   port: Number(process.env.POSTGRES_PORT),
//   username: process.env.POSTGRES_USERNAME,
//   password: process.env.POSTGRES_PASSWORD,
//   database: process.env.POSTGRES_DATABASE,
//   synchronize: false,
//   // logging: ['error', 'warn'],
//   entities: [
//     path.join(__dirname, 'apps/api/src/**/*.entity.{ts,js}'),
//     path.join(__dirname, 'libs/common/src/**/*.entity.{ts,js}'),
//   ],
//   migrations: [path.join(__dirname, 'migrations/*.js')],

//   // Log slow queries (>1s) in production
//   maxQueryExecutionTime: 1000,

//   logging:
//     process.env.NODE_ENV === 'development'
//       ? ['query', 'error', 'warn']
//       : ['error', 'warn'],

//   // Connection pool — matches PgBouncer transaction mode pool size
//   extra: {
//     max: 10, // Max connections per NestJS instance
//     min: 2, // Keep minimum warm
//     idleTimeoutMillis: 30_000,
//     connectionTimeoutMillis: 5_000,
//     statement_timeout: 30_000, // Kill queries running > 30s
//     idle_in_transaction_session_timeout: 60_000,
//   },

//   ssl:
//     process.env.NODE_ENV === 'production'
//       ? { rejectUnauthorized: true }
//       : false,
// });
