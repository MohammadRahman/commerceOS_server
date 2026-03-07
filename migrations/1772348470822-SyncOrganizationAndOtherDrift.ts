import { MigrationInterface, QueryRunner } from 'typeorm';

export class SyncOrganizationAndOtherDrift1772348470822 implements MigrationInterface {
  name = 'SyncOrganizationAndOtherDrift1772348470822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_9441b9af98ab993ff6a24c52ecf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_conversations_org_updated"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_conversations_org_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN "channelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "timezone" character varying(50) NOT NULL DEFAULT 'Asia/Dhaka'`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "currency" character varying(10) NOT NULL DEFAULT 'BDT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "pickupAddress" character varying(300) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" ADD "isOnboarded" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_courier_providers" ADD "webhook_key" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'AGENT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "temp_password"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "temp_password" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "status"`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "status" character varying(20) NOT NULL DEFAULT 'open'`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_1a99838ee2e2e940ad98ed2e9d8" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_1a99838ee2e2e940ad98ed2e9d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "status"`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD "status" character varying(30) NOT NULL DEFAULT 'OPEN'`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "temp_password"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "temp_password" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'OWNER'`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_courier_providers" DROP COLUMN "webhook_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "isOnboarded"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "pickupAddress"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "organizations" DROP COLUMN "timezone"`,
    );
    await queryRunner.query(`ALTER TABLE "conversations" ADD "channelId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "idx_conversations_org_status" ON "conversations" ("org_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversations_org_updated" ON "conversations" ("updated_at", "org_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_9441b9af98ab993ff6a24c52ecf" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
