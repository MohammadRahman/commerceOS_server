import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookKeyAndConversationStatus1772226231743 implements MigrationInterface {
  name = 'AddWebhookKeyAndConversationStatus1772226231743';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      SELECT 1 -- already applied, this file exists only to satisfy TypeORM's migration tracking
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP COLUMN IF EXISTS "status" FROM "conversations"`,
    );
    await queryRunner.query(
      `DROP COLUMN IF EXISTS "webhook_key" FROM "org_courier_providers"`,
    );
  }
}
