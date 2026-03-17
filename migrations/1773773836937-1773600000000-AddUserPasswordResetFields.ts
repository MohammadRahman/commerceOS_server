import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPasswordResetFields1773600000000 implements MigrationInterface {
  name = 'AddUserPasswordResetFields1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add phone number (already collected at register but not persisted to users table)
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "phone" VARCHAR(30) NULL
    `);

    // Magic link token — sha256 hex of the raw token stored here
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "reset_password_token" VARCHAR(200) NULL
    `);

    // Expiry — 1 hour from issue time
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "reset_password_expires_at" TIMESTAMPTZ NULL
    `);

    // Index for fast token lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_reset_password_token"
      ON "users" ("reset_password_token")
      WHERE "reset_password_token" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_reset_password_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "phone"`,
    );
  }
}
