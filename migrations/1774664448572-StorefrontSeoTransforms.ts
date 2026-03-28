// apps/api/src/migrations/1774664448572-StorefrontSeoTransforms.ts
//
// FIXED VERSION — replaces the auto-generated migration that was trying
// to drop/recreate FK constraints already present in production.
//
// This migration does exactly three things and nothing else:
//   1. ADD store_settings.seo        JSONB DEFAULT '{}'
//   2. ADD products.transforms       JSONB DEFAULT '[]'
//   3. ADD products.seo              JSONB DEFAULT '{}'
//
// All three use IF NOT EXISTS so it's safe to re-run if the column
// was already added manually in Railway.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class StorefrontSeoTransforms1774664448572 implements MigrationInterface {
  name = 'StorefrontSeoTransforms1774664448572';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // store_settings — seo column
    await queryRunner.query(`
      ALTER TABLE store_settings
      ADD COLUMN IF NOT EXISTS seo JSONB NOT NULL DEFAULT '{}'
    `);

    // products — transforms column
    await queryRunner.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS transforms JSONB NOT NULL DEFAULT '[]'
    `);

    // products — seo column
    await queryRunner.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS seo JSONB NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE products DROP COLUMN IF EXISTS seo`);
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS transforms`,
    );
    await queryRunner.query(
      `ALTER TABLE store_settings DROP COLUMN IF EXISTS seo`,
    );
  }
}
