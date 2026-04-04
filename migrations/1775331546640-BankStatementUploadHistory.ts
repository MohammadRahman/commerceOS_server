import { MigrationInterface, QueryRunner } from 'typeorm';

// Standalone migration for the bank_statement_uploads table.
//
// If you ran BankStatementUploadHistory1775331546640 already (the large combined
// migration), this table already exists — TypeORM will skip this cleanly because
// it only tracks which migration names have been run, not individual statements.
// If you are on a fresh DB or rolled back past that migration, this creates the
// table in isolation without touching anything else.

export class CreateBankStatementUploads1775400000000 implements MigrationInterface {
  name = 'CreateBankStatementUploads1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bank_statement_uploads" (
        "id"                    uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

        -- owner
        "org_id"                character varying NOT NULL,

        -- file identity
        "file_hash"             character varying(64)  NOT NULL,
        "filename"              character varying      NOT NULL,
        "file_size_bytes"       bigint,
        "estimated_pages"       integer,

        -- bank / statement metadata (populated after parse)
        "bank_name"             character varying,
        "account_iban"          character varying,
        "account_holder"        character varying,
        "period_from"           date,
        "period_to"             date,

        -- parse result
        "status"                character varying NOT NULL DEFAULT 'processing',
        "parse_method"          character varying,
        "tx_total"              integer NOT NULL DEFAULT 0,
        "tx_created"            integer NOT NULL DEFAULT 0,
        "tx_duplicate"          integer NOT NULL DEFAULT 0,
        "tx_errors"             integer NOT NULL DEFAULT 0,
        "tx_income"             integer NOT NULL DEFAULT 0,
        "tx_expense"            integer NOT NULL DEFAULT 0,
        "total_income_amount"   numeric(12,2) NOT NULL DEFAULT 0,
        "total_expense_amount"  numeric(12,2) NOT NULL DEFAULT 0,
        "confidence"            numeric(5,3),

        -- chunking
        "chunk_count"           integer NOT NULL DEFAULT 1,

        -- error / duplicate tracking
        "error_message"         text,
        "duplicate_of_id"       character varying,

        CONSTRAINT "PK_bank_statement_uploads" PRIMARY KEY ("id")
      )
    `);

    // org_id lookup (single column — for listing all uploads of an org)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bsu_org_id"
        ON "bank_statement_uploads" ("org_id")
    `);

    // org_id + created_at — primary listing query, newest first
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_bsu_org_created_at"
        ON "bank_statement_uploads" ("org_id", "created_at" DESC)
    `);

    // org_id + file_hash — file-level dedup check (unique)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bsu_org_file_hash"
        ON "bank_statement_uploads" ("org_id", "file_hash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bsu_org_file_hash"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bsu_org_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bsu_org_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bank_statement_uploads"`);
  }
}
