import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateAutomationLogTable1775247967605 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'automation_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'org_id', type: 'uuid', isNullable: false },
          {
            name: 'source_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'external_ref',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          { name: 'raw_payload', type: 'jsonb', isNullable: true },
          { name: 'parsed_data', type: 'jsonb', isNullable: true },
          { name: 'entry_id', type: 'uuid', isNullable: true },
          { name: 'supplier_id', type: 'uuid', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 4,
            scale: 3,
            isNullable: true,
          },
          { name: 'reviewed_by', type: 'uuid', isNullable: true },
          { name: 'reviewed_at', type: 'timestamp', isNullable: true },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_automation_logs_updated_at ON automation_logs;
      CREATE TRIGGER trg_automation_logs_updated_at
      BEFORE UPDATE ON automation_logs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_org_id_source_type" ON "automation_logs" ("org_id", "source_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_org_id_status" ON "automation_logs" ("org_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_external_ref" ON "automation_logs" ("external_ref")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_entry_id" ON "automation_logs" ("entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_supplier_id" ON "automation_logs" ("supplier_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_created_at" ON "automation_logs" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_automation_logs_status_created" ON "automation_logs" ("status", "created_at")`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_automation_logs_pending_flush"
      ON "automation_logs" ("status", "entry_id")
      WHERE status = 'confirmed' AND entry_id IS NULL
    `);

    await queryRunner.createForeignKey(
      'automation_logs',
      new TableForeignKey({
        name: 'fk_automation_logs_org_id',
        columnNames: ['org_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    const hasEntries = await queryRunner.hasTable('bookkeeping_entries');
    if (hasEntries) {
      await queryRunner.createForeignKey(
        'automation_logs',
        new TableForeignKey({
          name: 'fk_automation_logs_entry_id',
          columnNames: ['entry_id'],
          referencedTableName: 'bookkeeping_entries',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }

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

    const hasUsers = await queryRunner.hasTable('users');
    if (hasUsers) {
      await queryRunner.createForeignKey(
        'automation_logs',
        new TableForeignKey({
          name: 'fk_automation_logs_reviewed_by',
          columnNames: ['reviewed_by'],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_automation_logs_updated_at ON automation_logs`,
    );

    const table = await queryRunner.getTable('automation_logs');
    if (table) {
      for (const fk of table.foreignKeys) {
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
      `DROP INDEX IF EXISTS "idx_automation_logs_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_supplier_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_entry_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_external_ref"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_org_id_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_automation_logs_org_id_source_type"`,
    );

    await queryRunner.dropTable('automation_logs');
  }
}
