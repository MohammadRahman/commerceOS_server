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
  logging: ['error', 'warn'],
  entities: [
    path.join(__dirname, 'apps/api/src/**/*.entity.{ts,js}'),
    path.join(__dirname, 'libs/common/src/**/*.entity.{ts,js}'),
  ],
  migrations: [path.join(__dirname, 'migrations/*.js')],
});
