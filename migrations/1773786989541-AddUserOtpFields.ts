import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserOtpFields1773700000000 implements MigrationInterface {
  name = 'AddUserOtpFields1773700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 4-digit OTP stored as bcrypt hash (same security pattern as passwords)
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "otp_hash" VARCHAR(200) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "otp_expires_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "otp_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "otp_hash"`,
    );
  }
}
