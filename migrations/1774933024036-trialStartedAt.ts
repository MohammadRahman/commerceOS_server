import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrialStartedAt1774933024036 implements MigrationInterface {
  name = 'TrialStartedAt1774933024036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add trialStartedAt — defaults to created_at so existing orgs
    // automatically get a trial that started when they registered.
    // This means existing users get 7 days from their signup date,
    // which is fair and requires no manual intervention.
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMP WITH TIME ZONE
      DEFAULT NULL
    `);

    // Backfill existing orgs — set trial_started_at = created_at
    // so they get credit for however long they've been using the app.
    await queryRunner.query(`
      UPDATE "organizations"
      SET "trial_started_at" = "created_at"
      WHERE "trial_started_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      DROP COLUMN IF EXISTS "trial_started_at"
    `);
  }
}
