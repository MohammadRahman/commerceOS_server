import {
  MigrationInterface,
  QueryRunner,
  TableForeignKey,
  TableIndex,
  Table,
} from 'typeorm';

export class CreateAutomationConfigsTable1775247337393 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create automation_logs table first
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
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes
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
        name: 'idx_automation_logs_org_id_source_type',
        columnNames: ['org_id', 'source_type'],
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
        name: 'idx_automation_logs_created_at',
        columnNames: ['created_at'],
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

    // ==================== CREATE AUTOMATION_CONFIGS TABLE ====================
    await queryRunner.createTable(
      new Table({
        name: 'automation_configs',
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
            name: 'email_enabled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'email_access_token',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'email_refresh_token',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'email_provider',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          {
            name: 'email_watch_label',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'email_auto_confirm_below',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'daily_report_subjects',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'bank_statement_enabled',
            type: 'boolean',
            default: true,
          },
          {
            name: 'bank_name',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'open_banking_enabled',
            type: 'boolean',
            default: false,
          },
          {
            name: 'open_banking_provider',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'open_banking_access_token',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'open_banking_refresh_token',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'open_banking_account_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'open_banking_last_sync',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'auto_confirm_confidence',
            type: 'decimal',
            precision: 3,
            scale: 2,
            default: 0.9,
          },
          {
            name: 'notify_on_queue',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add indexes for automation_configs
    await queryRunner.createIndex(
      'automation_configs',
      new TableIndex({
        name: 'idx_automation_configs_org_id',
        columnNames: ['org_id'],
      }),
    );

    await queryRunner.createIndex(
      'automation_configs',
      new TableIndex({
        name: 'idx_automation_configs_org_id_unique',
        columnNames: ['org_id'],
        isUnique: true,
      }),
    );

    // Add foreign key for automation_configs
    await queryRunner.createForeignKey(
      'automation_configs',
      new TableForeignKey({
        name: 'fk_automation_configs_org_id',
        columnNames: ['org_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop automation_configs table and its dependencies first
    const configsTable = await queryRunner.getTable('automation_configs');
    if (configsTable) {
      const configsForeignKeys = configsTable.foreignKeys;
      for (const fk of configsForeignKeys) {
        if (fk.name) {
          await queryRunner.dropForeignKey('automation_configs', fk.name);
        }
      }
      await queryRunner.dropIndex(
        'automation_configs',
        'idx_automation_configs_org_id_unique',
      );
      await queryRunner.dropIndex(
        'automation_configs',
        'idx_automation_configs_org_id',
      );
      await queryRunner.dropTable('automation_configs');
    }

    // Drop automation_logs table and its dependencies
    const logsTable = await queryRunner.getTable('automation_logs');
    if (logsTable) {
      const logsForeignKeys = logsTable.foreignKeys;
      for (const fk of logsForeignKeys) {
        if (fk.name) {
          await queryRunner.dropForeignKey('automation_logs', fk.name);
        }
      }
    }

    // Drop indexes
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_created_at')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_entry_id')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_external_ref')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_org_id_source_type')
      .catch(() => {});
    await queryRunner
      .dropIndex('automation_logs', 'idx_automation_logs_org_id_status')
      .catch(() => {});

    // Drop the table
    await queryRunner.dropTable('automation_logs').catch(() => {});
  }
}
