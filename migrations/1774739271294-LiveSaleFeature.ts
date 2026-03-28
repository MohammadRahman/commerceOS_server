import { MigrationInterface, QueryRunner } from 'typeorm';

export class LiveSaleFeature1774739271294 implements MigrationInterface {
  name = 'LiveSaleFeature1774739271294';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "live_sales" (
                "id"                  uuid         NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "org_id"              uuid         NOT NULL,
                "post_id"             uuid         NOT NULL,
                "platform_post_id"    character varying(100) NOT NULL,
                "status"              character varying(20)  NOT NULL DEFAULT 'active',
                "product_queue"       jsonb        NOT NULL DEFAULT '[]',
                "trigger_keywords"    text array   NOT NULL DEFAULT '{WANT,want,ORDER,order,চাই,অর্ডার}',
                "trigger_dm_template" text         NOT NULL DEFAULT 'Hi {{name}}! 🎉 Thanks for your interest! Here is your payment link to order {{product}} for ৳{{price}}: {{link}}',
                "total_orders"        integer      NOT NULL DEFAULT '0',
                "total_revenue"       integer      NOT NULL DEFAULT '0',
                "total_comments"      integer      NOT NULL DEFAULT '0',
                "unique_buyers"       integer      NOT NULL DEFAULT '0',
                "started_at"          TIMESTAMP WITH TIME ZONE,
                "ended_at"            TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_aafd93dd5e6b0dbcfebe31f497a" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_e9bcf1ff7dd7bcd63765ce4044"
            ON "live_sales" ("org_id")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_2ba2c94725ddda624d67f8c316"
            ON "live_sales" ("post_id")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_2ba2c94725ddda624d67f8c316"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_e9bcf1ff7dd7bcd63765ce4044"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "live_sales"`);
  }
}
