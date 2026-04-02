import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThirdPartyAndVadExclusion1775163346508 implements MigrationInterface {
  name = 'AddThirdPartyAndVadExclusion1775163346508';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── New enum: third party platforms ───────────────────────────────────

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'third_party_platform_enum') THEN
          CREATE TYPE "third_party_platform_enum" AS ENUM (
            'WOLT', 'BOLT_FOOD', 'GLOVO', 'UBER_EATS', 'CUSTOM'
          );
        END IF;
      END $$;
    `);

    // ── Extend entry_category_enum with new values ─────────────────────────
    // PostgreSQL requires ALTER TYPE to add values.

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'SALES_THIRD_PARTY'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_category_enum')
        ) THEN
          ALTER TYPE "entry_category_enum" ADD VALUE 'SALES_THIRD_PARTY';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'PLATFORM_COMMISSION'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_category_enum')
        ) THEN
          ALTER TYPE "entry_category_enum" ADD VALUE 'PLATFORM_COMMISSION';
        END IF;
      END $$;
    `);

    // ── bookkeeping_entries: new columns ──────────────────────────────────

    await queryRunner.query(`
      ALTER TABLE "bookkeeping_entries"
        ADD COLUMN IF NOT EXISTS "excludeFromVat"          boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "thirdPartyPlatform"      "third_party_platform_enum" NULL,
        ADD COLUMN IF NOT EXISTS "platformCommissionRate"  numeric(5,4) NULL,
        ADD COLUMN IF NOT EXISTS "platformCommissionAmount" numeric(12,2) NULL,
        ADD COLUMN IF NOT EXISTS "platformPayoutAmount"    numeric(12,2) NULL
    `);

    // Index for querying third party entries efficiently
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_entries_third_party"
      ON "bookkeeping_entries" ("org_id", "thirdPartyPlatform")
      WHERE "thirdPartyPlatform" IS NOT NULL
    `);

    // ── bookkeeping_monthly_periods: new summary columns ─────────────────

    await queryRunner.query(`
      ALTER TABLE "bookkeeping_monthly_periods"
        ADD COLUMN IF NOT EXISTS "totalThirdPartyGross"    numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalPlatformCommission" numeric(14,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "totalThirdPartyPayout"   numeric(14,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_entries_third_party"`);

    await queryRunner.query(`
      ALTER TABLE "bookkeeping_monthly_periods"
        DROP COLUMN IF EXISTS "totalThirdPartyPayout",
        DROP COLUMN IF EXISTS "totalPlatformCommission",
        DROP COLUMN IF EXISTS "totalThirdPartyGross"
    `);

    await queryRunner.query(`
      ALTER TABLE "bookkeeping_entries"
        DROP COLUMN IF EXISTS "platformPayoutAmount",
        DROP COLUMN IF EXISTS "platformCommissionAmount",
        DROP COLUMN IF EXISTS "platformCommissionRate",
        DROP COLUMN IF EXISTS "thirdPartyPlatform",
        DROP COLUMN IF EXISTS "excludeFromVat"
    `);

    // Note: cannot remove values from PostgreSQL enums — would need to recreate type
    await queryRunner.query(`DROP TYPE IF EXISTS "third_party_platform_enum"`);
  }
}
