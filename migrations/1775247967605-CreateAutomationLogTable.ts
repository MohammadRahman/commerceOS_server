import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateAutomationLogTable1775247967605 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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
          {
            name: 'org_id',
            type: 'uuid',
            isNullable: false,
          },
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
          {
            name: 'raw_payload',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'parsed_data',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'entry_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'supplier_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'confidence',
            type: 'decimal',
            precision: 4,
            scale: 3,
            isNullable: true,
          },
          {
            name: 'reviewed_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'reviewed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_org_id_source_type',
        columnNames: ['org_id', 'source_type'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_org_id_status',
        columnNames: ['org_id', 'status'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_external_ref',
        columnNames: ['external_ref'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_entry_id',
        columnNames: ['entry_id'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_supplier_id',
        columnNames: ['supplier_id'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_created_at',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_status_created',
        columnNames: ['status', 'created_at'],
      }),
    );

    // Add composite index for common query pattern: pending entries ready for flush
    await queryRunner.createIndex(
      'automation_logs',
      new TableIndex({
        name: 'idx_automation_logs_pending_flush',
        columnNames: ['status', 'entry_id'],
        where: "status = 'confirmed' AND (entry_id IS NULL OR entry_id = '')",
      }),
    );

    // Add foreign key to organizations table
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

    // Add foreign key to bookkeeping_entries (if table exists)
    const hasEntriesTable = await queryRunner.hasTable('bookkeeping_entries');
    if (hasEntriesTable) {
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

    // Add foreign key to suppliers table (if table exists)
    const hasSuppliersTable = await queryRunner.hasTable('suppliers');
    if (hasSuppliersTable) {
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

    // Add foreign key to users table for reviewed_by
    const hasUsersTable = await queryRunner.hasTable('users');
    if (hasUsersTable) {
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
    // Drop foreign keys if they exist
    const table = await queryRunner.getTable('automation_logs');
    if (table) {
      const foreignKeys = table.foreignKeys;
      for (const fk of foreignKeys) {
        if (fk.name) {
          await queryRunner.dropForeignKey('automation_logs', fk.name);
        }
      }
    }

    // Drop indexes
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_pending_flush')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_status_created')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_created_at')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_supplier_id')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_entry_id')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_external_ref')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_org_id_status')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_org_id_source_type')
      .catch(() => {});

    // Drop the table
    await queryRunner.dropTable('automation_logs');
  }
}
