// migrations/1772667941487-SeedProviderCatalogs.ts

import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedProviderCatalogs1772667941487 implements MigrationInterface {
  name = 'SeedProviderCatalogs1772667941487';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Column is "isEnabled" (camelCase) — that's what migration 1771346921772 created
    await queryRunner.query(`
      INSERT INTO "courier_provider_catalog"
        ("type", "name", "isEnabled", "supported_countries", "website")
      VALUES
        ('steadfast', 'Steadfast Courier',  true, ARRAY['BD']::text[], 'https://steadfast.com.bd'),
        ('pathao',    'Pathao Courier',     true, ARRAY['BD']::text[], 'https://courier.pathao.com'),
        ('redx',      'REDX',              true, ARRAY['BD']::text[], 'https://redx.com.bd'),
        ('paperfly',  'Paperfly',          true, ARRAY['BD']::text[], 'https://paperfly.com.bd'),
        ('sundarban', 'Sundarban Courier', true, ARRAY['BD']::text[], 'https://sundarban.com')
      ON CONFLICT ("type") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "payment_provider_catalog"
        ("type", "name", "isEnabled", "supported_countries", "website")
      VALUES
        ('bkash',      'bKash',      true, ARRAY['BD']::text[], 'https://www.bkash.com'),
        ('nagad',      'Nagad',      true, ARRAY['BD']::text[], 'https://nagad.com.bd'),
        ('rocket',     'Rocket',     true, ARRAY['BD']::text[], 'https://rocket.dbbl.com.bd'),
        ('sslcommerz', 'SSLCommerz', true, ARRAY['BD']::text[], 'https://sslcommerz.com'),
        ('shurjopay',  'ShurjoPay',  true, ARRAY['BD']::text[], 'https://shurjopay.com.bd')
      ON CONFLICT ("type") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "courier_provider_catalog"
      WHERE "type" IN ('steadfast','pathao','redx','paperfly','sundarban')
    `);
    await queryRunner.query(`
      DELETE FROM "payment_provider_catalog"
      WHERE "type" IN ('bkash','nagad','rocket','sslcommerz','shurjopay')
    `);
  }
}
