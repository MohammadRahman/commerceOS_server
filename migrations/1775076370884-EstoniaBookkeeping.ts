import { MigrationInterface, QueryRunner } from 'typeorm';

export class EstoniaBookkeeping1775076370884 implements MigrationInterface {
  name = 'EstoniaBookkeeping1775076370884';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ──────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TYPE "public"."business_persona_enum" AS ENUM (
        'RESTAURANT', 'ECOMMERCE', 'FREELANCER_FIE', 'COMPANY_OU'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."vat_registration_status_enum" AS ENUM (
        'NOT_REGISTERED', 'REGISTERED', 'VOLUNTARY'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."entry_type_enum" AS ENUM (
        'INCOME', 'EXPENSE', 'SALARY', 'TRANSFER'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."entry_category_enum" AS ENUM (
        'SALES_CASH', 'SALES_CARD', 'SALES_ONLINE', 'INVOICE_PAYMENT', 'OTHER_INCOME',
        'SUPPLIER_FOOD', 'SUPPLIER_GOODS', 'RENT', 'UTILITIES', 'EQUIPMENT',
        'MARKETING', 'SOFTWARE', 'TRANSPORT', 'OTHER_EXPENSE',
        'STAFF_SALARY', 'OWNER_SALARY', 'BOARD_FEE', 'BANK_TRANSFER'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."entry_status_enum" AS ENUM (
        'DRAFT', 'CONFIRMED', 'EXCLUDED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."source_type_enum" AS ENUM (
        'MANUAL', 'RECEIPT_SCAN', 'ORDER_SYNC', 'INVOICE_SYNC', 'BANK_IMPORT'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."period_status_enum" AS ENUM (
        'OPEN', 'CALCULATING', 'REVIEW', 'FILED', 'LOCKED'
      )
    `);

    // ── bookkeeping_tax_profiles ───────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "bookkeeping_tax_profiles" (
        "id"                     uuid    NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"         uuid    NOT NULL UNIQUE,
        "persona"                "public"."business_persona_enum"         NOT NULL,
        "vatStatus"              "public"."vat_registration_status_enum"  NOT NULL DEFAULT 'NOT_REGISTERED',
        "vatNumber"              character varying,
        "registrationCode"       character varying,
        "emtaApiToken"           character varying,
        "autoFileEnabled"        boolean NOT NULL DEFAULT false,
        "defaultVatRate"         numeric(5,2) NOT NULL DEFAULT 24,
        "isSoleTraderFie"        boolean NOT NULL DEFAULT false,
        "paysAdvanceIncomeTax"   boolean NOT NULL DEFAULT false,
        "createdAt"              TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_tax_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tax_profiles_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    // ── bookkeeping_employees ──────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "bookkeeping_employees" (
        "id"              uuid    NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"  uuid    NOT NULL,
        "fullName"        character varying NOT NULL,
        "personalIdCode"  character varying,
        "paymentTypeCode" character varying NOT NULL DEFAULT '10',
        "isBoardMember"   boolean NOT NULL DEFAULT false,
        "isActive"        boolean NOT NULL DEFAULT true,
        "email"           character varying,
        "bankAccount"     character varying,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_employees" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employees_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_employees_org_active"
        ON "bookkeeping_employees" ("organizationId", "isActive")
    `);

    // ── bookkeeping_entries (the main table) ───────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "bookkeeping_entries" (
        "id"                     uuid    NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"         uuid    NOT NULL,
        "date"                   date    NOT NULL,
        "taxYear"                integer NOT NULL,
        "taxMonth"               integer NOT NULL,
        "entryType"              "public"."entry_type_enum"    NOT NULL,
        "category"               "public"."entry_category_enum" NOT NULL,
        "description"            character varying(255) NOT NULL,
        "grossAmount"            numeric(12,2) NOT NULL,
        "vatRate"                numeric(5,2)  NOT NULL DEFAULT 0,
        "vatAmount"              numeric(12,2) NOT NULL DEFAULT 0,
        "netAmount"              numeric(12,2) NOT NULL,
        "sourceType"             "public"."source_type_enum"   NOT NULL DEFAULT 'MANUAL',
        "sourceId"               character varying,
        "receiptImageUrl"        character varying,
        "receiptParsedData"      jsonb,
        "invoiceNumber"          character varying,
        "counterpartyName"       character varying,
        "counterpartyVatNumber"  character varying,
        "status"                 "public"."entry_status_enum"  NOT NULL DEFAULT 'CONFIRMED',
        "notes"                  character varying,
        "createdByUserId"        uuid,
        "createdAt"              TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_entries_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_entries_org_period"
        ON "bookkeeping_entries" ("organizationId", "taxYear", "taxMonth")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_entries_org_type_date"
        ON "bookkeeping_entries" ("organizationId", "entryType", "date")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_entries_source"
        ON "bookkeeping_entries" ("organizationId", "sourceType", "sourceId")
        WHERE "sourceId" IS NOT NULL
    `);

    // ── bookkeeping_monthly_periods ────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "bookkeeping_monthly_periods" (
        "id"                    uuid    NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"        uuid    NOT NULL,
        "year"                  integer NOT NULL,
        "month"                 integer NOT NULL,
        "status"                "public"."period_status_enum" NOT NULL DEFAULT 'OPEN',
        "totalIncomeGross"      numeric(14,2) NOT NULL DEFAULT 0,
        "totalIncomeNet"        numeric(14,2) NOT NULL DEFAULT 0,
        "totalExpenseGross"     numeric(14,2) NOT NULL DEFAULT 0,
        "totalExpenseNet"       numeric(14,2) NOT NULL DEFAULT 0,
        "totalGrossSalary"      numeric(14,2) NOT NULL DEFAULT 0,
        "totalIncomeTaxWithheld"numeric(14,2) NOT NULL DEFAULT 0,
        "totalSocialTax"        numeric(14,2) NOT NULL DEFAULT 0,
        "totalEmployerCost"     numeric(14,2) NOT NULL DEFAULT 0,
        "vatOutputTotal"        numeric(14,2) NOT NULL DEFAULT 0,
        "vatInputTotal"         numeric(14,2) NOT NULL DEFAULT 0,
        "vatPayable"            numeric(14,2) NOT NULL DEFAULT 0,
        "taxBreakdown"          jsonb,
        "kmdSubmissionId"       uuid,
        "tsdSubmissionId"       uuid,
        "filedAt"               TIMESTAMP,
        "filedByUserId"         uuid,
        "createdAt"             TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"             TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_monthly_periods" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_period_org_year_month" UNIQUE ("organizationId", "year", "month"),
        CONSTRAINT "FK_periods_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_periods_org_status"
        ON "bookkeeping_monthly_periods" ("organizationId", "status")
    `);

    // ── RBAC permissions ───────────────────────────────────────────────────

    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description") VALUES
        ('bookkeeping:read',  'View bookkeeping entries and period summaries'),
        ('bookkeeping:write', 'Add income, expenses, and salary entries'),
        ('bookkeeping:file',  'Calculate and file taxes to EMTA')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "bookkeeping_monthly_periods"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_employees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_tax_profiles"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."period_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."source_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."entry_status_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."entry_category_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."entry_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."vat_registration_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."business_persona_enum"`,
    );
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('bookkeeping:read', 'bookkeeping:write', 'bookkeeping:file')
    `);
  }
}
