import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1772226231744 implements MigrationInterface {
  name = 'AddPerformanceIndexes1772226231744';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add missing status column first
    await queryRunner.query(`
    ALTER TABLE "conversations" 
    ADD COLUMN IF NOT EXISTS "status" character varying(30) NOT NULL DEFAULT 'OPEN'
  `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversations_org_updated" ON "conversations" ("org_id", "updated_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversations_org_status" ON "conversations" ("org_id", "status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_conversations_org_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_conversations_org_updated"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP COLUMN IF EXISTS "status"`,
    );
  }
  // public async up(queryRunner: QueryRunner): Promise<void> {
  //   // conversations
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_conversations_org_updated" ON "conversations" ("org_id", "updated_at" DESC)`,
  //   );
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_conversations_org_status" ON "conversations" ("org_id", "status")`,
  //   );
  //   // messages
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created" ON "messages" ("conversation_id", "created_at" DESC)`,
  //   );
  //   // orders
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_orders_org_created" ON "orders" ("org_id", "created_at" DESC)`,
  //   );
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_orders_org_status" ON "orders" ("org_id", "status")`,
  //   );
  //   // shipments
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_shipments_org_created" ON "shipments" ("org_id", "created_at" DESC)`,
  //   );
  //   // user_sessions — partial index: only active (non-revoked) sessions
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_user_sessions_token" ON "user_sessions" ("refresh_token_hash") WHERE "revoked_at" IS NULL`,
  //   );
  //   // org providers
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_org_payment_providers_org" ON "org_payment_providers" ("org_id")`,
  //   );
  //   await queryRunner.query(
  //     `CREATE INDEX IF NOT EXISTS "idx_org_courier_providers_org" ON "org_courier_providers" ("org_id")`,
  //   );
  // }

  // public async down(queryRunner: QueryRunner): Promise<void> {
  //   await queryRunner.query(
  //     `DROP INDEX IF EXISTS "idx_conversations_org_updated"`,
  //   );
  //   await queryRunner.query(
  //     `DROP INDEX IF EXISTS "idx_conversations_org_status"`,
  //   );
  //   await queryRunner.query(
  //     `DROP INDEX IF EXISTS "idx_messages_conversation_created"`,
  //   );
  //   await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_org_created"`);
  //   await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_org_status"`);
  //   await queryRunner.query(`DROP INDEX IF EXISTS "idx_shipments_org_created"`);
  //   await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_sessions_token"`);
  //   await queryRunner.query(
  //     `DROP INDEX IF EXISTS "idx_org_payment_providers_org"`,
  //   );
  //   await queryRunner.query(
  //     `DROP INDEX IF EXISTS "idx_org_courier_providers_org"`,
  //   );
  // }
}
