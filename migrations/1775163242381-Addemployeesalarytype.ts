import { MigrationInterface, QueryRunner } from 'typeorm';

export class Addemployeesalarytype1775163242381 implements MigrationInterface {
  name = 'Addemployeesalarytype1775163242381';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_type_enum') THEN
          CREATE TYPE "salary_type_enum" AS ENUM ('FIXED', 'HOURLY');
        END IF;
      END $$;
    `);

    // Add salaryType with default FIXED (non-breaking — all existing rows get FIXED)
    await queryRunner.query(`
      ALTER TABLE "bookkeeping_employees"
        ADD COLUMN IF NOT EXISTS "salaryType" "salary_type_enum" NOT NULL DEFAULT 'FIXED'
    `);

    // Add hourlyRate — nullable, only populated for HOURLY employees
    await queryRunner.query(`
      ALTER TABLE "bookkeeping_employees"
        ADD COLUMN IF NOT EXISTS "hourlyRate" numeric(10,2) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookkeeping_employees" DROP COLUMN IF EXISTS "hourlyRate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookkeeping_employees" DROP COLUMN IF EXISTS "salaryType"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "salary_type_enum"`);
  }
}
