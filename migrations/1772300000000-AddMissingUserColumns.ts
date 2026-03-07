// migrations/1772300000000-AddMissingUserColumns.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingUserColumns1772300000000 implements MigrationInterface {
  name = 'AddMissingUserColumns1772300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "name" character varying(200),
        ADD COLUMN IF NOT EXISTS "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS "temp_password" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "temp_password"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "status"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "name"`);
  }
}
