import {
  MigrationInterface,
  QueryRunner,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateAutomationLogTable1775247967605 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // automation_logs table already created by CreateAutomationConfigsTable1775247337393.
    // This migration only adds the extra indexes and FKs not present in that migration.

    // These indexes are new (not in the earlier migration):
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_supplier_id"
      ON "automation_logs" ("supplier_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_status_created"
      ON "automation_logs" ("status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_pending_flush"
      ON "automation_logs" ("status", "entry_id")
      WHERE status = 'confirmed' AND (entry_id IS NULL)
    `);

    // These indexes already exist from the earlier migration — use IF NOT EXISTS as safety:
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_org_id_source_type"
      ON "automation_logs" ("org_id", "source_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_org_id_status"
      ON "automation_logs" ("org_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_external_ref"
      ON "automation_logs" ("external_ref")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_entry_id"
      ON "automation_logs" ("entry_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_created_at"
      ON "automation_logs" ("created_at")
    `);

    // FK to suppliers — only add if suppliers table exists and FK not already present
    const hasSuppliersTable = await queryRunner.hasTable('suppliers');
    if (hasSuppliersTable) {
      const table = await queryRunner.getTable('automation_logs');
      const fkExists = table?.foreignKeys.some(
        (fk) => fk.name === 'fk_automation_logs_supplier_id',
      );
      if (!fkExists) {
        await queryRunner.createForeignKey(
          'automation_logs',
          new TableForeignKey({
            name: 'fk_automation_logs_supplier_id',
            columnNames: ['supplier_id'],
            referencedTableName: 'suppliers',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          }),
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop only what THIS migration added
    const table = await queryRunner.getTable('automation_logs');
    if (table) {
      const fk = table.foreignKeys.find(
        (fk) => fk.name === 'fk_automation_logs_supplier_id',
      );
      if (fk) {
        await queryRunner.dropForeignKey('automation_logs', fk.name!);
      }
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_pending_flush"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_supplier_id"`,
    );

    // Do NOT drop the table or the shared indexes — those belong to the earlier migration
  }
}
