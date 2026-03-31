import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionTables1774935402339 implements MigrationInterface {
  name = 'SubscriptionTables1774935402339';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── subscriptions ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id"                       uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "org_id"                   uuid         NOT NULL UNIQUE,
        "plan"                     varchar(20)  NOT NULL DEFAULT 'FREE',
        "status"                   varchar(20)  NOT NULL DEFAULT 'TRIAL',
        "billing_cycle"            varchar(20)  NOT NULL DEFAULT 'MONTHLY',
        "amount"                   integer      NOT NULL DEFAULT 0,
        "currency"                 varchar(10)  NOT NULL DEFAULT 'BDT',
        "payment_provider"         varchar(30),
        "provider_subscription_id" varchar(200),
        "trial_started_at"         TIMESTAMP WITH TIME ZONE,
        "current_period_start"     TIMESTAMP WITH TIME ZONE,
        "current_period_end"       TIMESTAMP WITH TIME ZONE,
        "cancelled_at"             TIMESTAMP WITH TIME ZONE,
        "auto_renew"               boolean      NOT NULL DEFAULT true,
        "pending_plan"             varchar(20),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscriptions_org_id"
      ON "subscriptions" ("org_id")
    `);

    // ── subscription_payments ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_payments" (
        "id"               uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "org_id"           uuid         NOT NULL,
        "subscription_id"  uuid         NOT NULL,
        "amount"           integer      NOT NULL,
        "currency"         varchar(10)  NOT NULL DEFAULT 'BDT',
        "payment_provider" varchar(30)  NOT NULL,
        "status"           varchar(30)  NOT NULL DEFAULT 'PENDING',
        "provider_ref"     varchar(200),
        "trx_id"           varchar(100),
        "screenshot_url"   text,
        "period_start"     TIMESTAMP WITH TIME ZONE,
        "period_end"       TIMESTAMP WITH TIME ZONE,
        "confirmed_by"     uuid,
        "confirmed_at"     TIMESTAMP WITH TIME ZONE,
        "raw_payload"      jsonb,
        "failure_reason"   text,
        CONSTRAINT "PK_subscription_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_payments_subscription"
          FOREIGN KEY ("subscription_id")
          REFERENCES "subscriptions"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_payments_org_id"
      ON "subscription_payments" ("org_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_subscription_payments_subscription_id"
      ON "subscription_payments" ("subscription_id")
    `);

    // ── Backfill: create a trial subscription for every existing org ──────────
    await queryRunner.query(`
      INSERT INTO "subscriptions" (org_id, plan, status, trial_started_at, created_at, updated_at)
      SELECT
        o.id,
        'FREE',
        'TRIAL',
        COALESCE(o.trial_started_at, o.created_at),
        now(),
        now()
      FROM organizations o
      WHERE NOT EXISTS (
        SELECT 1 FROM subscriptions s WHERE s.org_id = o.id
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_payments_subscription_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_payments_org_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_payments"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_org_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
  }
}
