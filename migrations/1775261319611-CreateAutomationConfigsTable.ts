import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from 'typeorm';

export class CreateAutomationConfigsTable1775261319611 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // set_updated_at() already exists from CreateSu dsapplier — CREATE OR REPLACE is safe
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
        name: 'automation_configs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'org_id', type: 'uuid', isNullable: false },
          { name: 'email_enabled', type: 'boolean', default: false },
          { name: 'email_access_token', type: 'text', isNullable: true },
          { name: 'email_refresh_token', type: 'text', isNullable: true },
          {
            name: 'email_provider',
            type: 'enum',
            enum: ['gmail', 'outlook'],
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
          { name: 'daily_report_subjects', type: 'text', isNullable: true },
          { name: 'bank_statement_enabled', type: 'boolean', default: true },
          {
            name: 'bank_name',
            type: 'enum',
            enum: ['lhv', 'seb', 'swedbank', 'coop', 'luminor'],
            isNullable: true,
          },
          { name: 'open_banking_enabled', type: 'boolean', default: false },
          {
            name: 'open_banking_provider',
            type: 'enum',
            enum: ['lhv_connect', 'saltedge', 'nordigen'],
            isNullable: true,
          },
          { name: 'open_banking_access_token', type: 'text', isNullable: true },
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
          { name: 'notify_on_queue', type: 'boolean', default: true },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.query(`
        DROP TRIGGER IF EXISTS trg_automation_configs_updated_at ON automation_configs;
      CREATE TRIGGER trg_automation_configs_updated_at
      BEFORE UPDATE ON automation_configs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await queryRunner.createIndex(
      'automation_configs',
      new TableIndex({
        name: 'idx_automation_configs_org_id',
        columnNames: ['org_id'],
        isUnique: true,
      }),
    );

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
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_automation_configs_updated_at ON automation_configs`,
    );

    const table = await queryRunner.getTable('automation_configs');
    if (table) {
      for (const fk of table.foreignKeys) {
        await queryRunner.dropForeignKey('automation_configs', fk.name!);
      }
    }

    await queryRunner
      .dropIndex('automation_configs', 'idx_automation_configs_org_id')
      .catch(() => {});
    await queryRunner.dropTable('automation_configs');

    await queryRunner.query(
      `DROP TYPE IF EXISTS "automation_configs_email_provider_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "automation_configs_bank_name_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "automation_configs_open_banking_provider_enum"`,
    );
  }
}
