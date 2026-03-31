import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformAdminColumns1774925491079 implements MigrationInterface {
  name = 'PlatformAdminColumns1774925491079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── users: is_platform_admin ───────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean NOT NULL DEFAULT false
    `);

    // ── organizations: mrr, is_active, feature_flags ───────────────────────
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "mrr" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "feature_flags" jsonb NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "feature_flags"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "is_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN IF EXISTS "mrr"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_platform_admin"`,
    );
  }
}
