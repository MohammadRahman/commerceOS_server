// typeorm.config.ts (repo root) — v5
// Fix: migrations path now points to dist/migrations/ which is where
// the Dockerfile compiles them. This ensures the entrypoint finds them.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// ── Env loading ───────────────────────────────────────────────────────────────
const env = process.env.NODE_ENV ?? 'development';
const root = path.resolve(__dirname);
const api = path.join(root, 'apps', 'api');

function loadIfExists(filePath: string) {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: false });
  }
}

loadIfExists(path.join(api, '.env'));
loadIfExists(path.join(api, `.env.${env}`));
loadIfExists(path.join(api, `.env.${env}.local`));

// ── Validate / parse DATABASE_URL ─────────────────────────────────────────────
const required = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USERNAME',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
];
const missing = required.filter((k) => !process.env[k]);

if (missing.length > 0 && process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  process.env.POSTGRES_HOST ??= u.hostname;
  process.env.POSTGRES_PORT ??= u.port || '5432';
  process.env.POSTGRES_USERNAME ??= u.username;
  process.env.POSTGRES_PASSWORD ??= u.password;
  process.env.POSTGRES_DATABASE ??= u.pathname.replace('/', '');
}

const stillMissing = required.filter((k) => !process.env[k]);
if (stillMissing.length > 0) {
  throw new Error(
    `[typeorm.config] Missing required env vars: ${stillMissing.join(', ')}\n` +
      `  Loaded env: ${env}`,
  );
}

const isProd = env === 'production';

// ── DataSource ────────────────────────────────────────────────────────────────
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USERNAME,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,

  synchronize: false, // NEVER true — migrations are the source of truth

  entities: [
    path.join(root, 'apps/api/src/**/*.entity.{ts,js}'),
    path.join(root, 'libs/common/src/**/*.entity.{ts,js}'),
  ],

  // ✅ Fixed: migrations live in dist/migrations/ after Dockerfile compiles them
  // __dirname in compiled dist/typeorm.config.js = dist/
  // so path.join(__dirname, 'migrations') = dist/migrations/ ✓
  migrations: [path.join(__dirname, 'migrations', '*.js')],

  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',

  logging: isProd ? ['error', 'warn'] : ['query', 'error', 'warn'],
  maxQueryExecutionTime: 1000,

  extra: {
    max: isProd ? 20 : 5,
    min: isProd ? 2 : 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  },

  ssl: false,
});

export default AppDataSource;
// // typeorm.config.ts  (repo root)
// // v4 — environment-aware, replaces the previous version.
// // Used by:
// //   • TypeORM CLI:  npm run migration:run / migration:generate
// //   • NestJS app:   docker-entrypoint.sh runs this before boot
// //
// // Priority chain (highest wins):
// //   1. Process env vars already set (Railway / CI inject these — never overridden)
// //   2. apps/api/.env.{NODE_ENV}.local   gitignored, machine-specific overrides
// //   3. apps/api/.env.{NODE_ENV}         committed safe defaults per environment
// //   4. apps/api/.env                    legacy single-file fallback

// import 'reflect-metadata';
// import { DataSource } from 'typeorm';
// import * as path from 'path';
// import * as dotenv from 'dotenv';
// import * as fs from 'fs';

// // ── Env loading ───────────────────────────────────────────────────────────────
// const env = process.env.NODE_ENV ?? 'development';
// const root = path.resolve(__dirname); // repo root (this file lives there)
// const api = path.join(root, 'apps', 'api');

// function loadIfExists(filePath: string) {
//   if (fs.existsSync(filePath)) {
//     dotenv.config({ path: filePath, override: false }); // never overwrite already-set vars
//   }
// }

// // Load lowest priority first so higher-priority files win
// loadIfExists(path.join(api, '.env'));
// loadIfExists(path.join(api, `.env.${env}`));
// loadIfExists(path.join(api, `.env.${env}.local`));

// // ── Validate ──────────────────────────────────────────────────────────────────
// const required = [
//   'POSTGRES_HOST',
//   'POSTGRES_PORT',
//   'POSTGRES_USERNAME',
//   'POSTGRES_PASSWORD',
//   'POSTGRES_DATABASE',
// ];
// const missing = required.filter((k) => !process.env[k]);

// // Railway injects DATABASE_URL — parse it as fallback
// if (missing.length > 0 && process.env.DATABASE_URL) {
//   const u = new URL(process.env.DATABASE_URL);
//   process.env.POSTGRES_HOST ??= u.hostname;
//   process.env.POSTGRES_PORT ??= u.port || '5432';
//   process.env.POSTGRES_USERNAME ??= u.username;
//   process.env.POSTGRES_PASSWORD ??= u.password;
//   process.env.POSTGRES_DATABASE ??= u.pathname.replace('/', '');
// }

// const stillMissing = required.filter((k) => !process.env[k]);
// if (stillMissing.length > 0) {
//   throw new Error(
//     `[typeorm.config] Missing required env vars: ${stillMissing.join(', ')}\n` +
//       `  Loaded env: ${env}\n` +
//       `  Tip: copy apps/api/.env.example to apps/api/.env.${env}.local and fill values.`,
//   );
// }

// const isProd = env === 'production';

// // ── DataSource ────────────────────────────────────────────────────────────────
// const AppDataSource = new DataSource({
//   type: 'postgres',
//   host: process.env.POSTGRES_HOST,
//   port: Number(process.env.POSTGRES_PORT ?? 5432),
//   username: process.env.POSTGRES_USERNAME,
//   password: process.env.POSTGRES_PASSWORD,
//   database: process.env.POSTGRES_DATABASE,

//   synchronize: false, // ALWAYS false — migrations are the source of truth

//   // Entity discovery — covers both .ts (CLI / ts-node) and .js (compiled dist/)
//   entities: [
//     path.join(root, 'apps/api/src/**/*.entity.{ts,js}'),
//     path.join(root, 'libs/common/src/**/*.entity.{ts,js}'),
//   ],

//   // Migration discovery
//   // migrations: [path.join(root, 'migrations/*.{ts,js}')],
//   migrations: [path.join(__dirname, '..', 'migrations/*.{js}')],

//   migrationsTableName: 'typeorm_migrations', // explicit, never conflicts with app tables
//   migrationsTransactionMode: 'each', // each migration in its own transaction

//   logging: isProd ? ['error', 'warn'] : ['query', 'error', 'warn'],

//   maxQueryExecutionTime: 1000, // log queries slower than 1s

//   extra: {
//     max: isProd ? 20 : 5,
//     min: isProd ? 2 : 1,
//     idleTimeoutMillis: 30_000,
//     connectionTimeoutMillis: 5_000,
//     statement_timeout: 30_000,
//     idle_in_transaction_session_timeout: 60_000,
//   },

//   ssl: false,
// });

// export default AppDataSource;
