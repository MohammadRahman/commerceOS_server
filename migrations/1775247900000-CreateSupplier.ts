import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateSupplier1775247900000 implements MigrationInterface {
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

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "suppliers_source_enum" AS ENUM (
          'manual',
          'email_parser',
          'bank_statement',
          'open_banking'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: 'suppliers',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'org_id', type: 'uuid', isNullable: false },
          { name: 'name', type: 'varchar', length: '255', isNullable: false },
          {
            name: 'registration_number',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'vat_number',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          { name: 'email', type: 'varchar', length: '255', isNullable: true },
          { name: 'website', type: 'varchar', length: '255', isNullable: true },
          { name: 'iban', type: 'varchar', length: '34', isNullable: true },
          {
            name: 'aliases',
            type: 'jsonb',
            isNullable: true,
            default: "'[]'",
            comment: 'JSON array of alias keywords for fuzzy supplier matching',
          },
          {
            name: 'default_category',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'source',
            type: 'suppliers_source_enum',
            default: "'manual'",
            isNullable: false,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
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
      DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
      CREATE TRIGGER trg_suppliers_updated_at
      BEFORE UPDATE ON suppliers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_org_id_email" ON "suppliers" ("org_id", "email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_suppliers_org_id_registration_number" ON "suppliers" ("org_id", "registration_number") WHERE "registration_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_org_id_vat_number" ON "suppliers" ("org_id", "vat_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_org_id_iban" ON "suppliers" ("org_id", "iban")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_name" ON "suppliers" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_org_id_is_active" ON "suppliers" ("org_id", "is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_suppliers_aliases_gin" ON suppliers USING gin (aliases)`,
    );

    await queryRunner
      .query(
        `
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX IF NOT EXISTS "idx_suppliers_name_trgm" ON suppliers USING gin (name gin_trgm_ops);
      `,
      )
      .catch(() => {
        console.warn(
          'pg_trgm not available — skipping trigram index on suppliers.name',
        );
      });

    await queryRunner.createForeignKey(
      'suppliers',
      new TableForeignKey({
        name: 'fk_suppliers_org_id',
        columnNames: ['org_id'],
        referencedTableName: 'organizations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers`,
    );

    const table = await queryRunner.getTable('suppliers');
    if (table) {
      for (const fk of table.foreignKeys) {
        if (fk.name) await queryRunner.dropForeignKey('suppliers', fk.name);
      }
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_suppliers_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_suppliers_aliases_gin"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suppliers_org_id_is_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_suppliers_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_suppliers_org_id_iban"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suppliers_org_id_vat_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suppliers_org_id_registration_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_suppliers_org_id_email"`,
    );

    await queryRunner.dropTable('suppliers');
    await queryRunner.query(`DROP TYPE IF EXISTS "suppliers_source_enum"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS set_updated_at()`);
  }
}
