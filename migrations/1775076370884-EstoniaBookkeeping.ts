import { MigrationInterface, QueryRunner } from 'typeorm';

export class EstoniaBookkeeping1775076370884 implements MigrationInterface {
  name = 'EstoniaBookkeeping1775076370884';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── ENUMS (SAFE) ─────────────────────────────────────

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_persona_enum') THEN
          CREATE TYPE "business_persona_enum" AS ENUM (
            'RESTAURANT', 'ECOMMERCE', 'FREELANCER_FIE', 'COMPANY_OU'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vat_registration_status_enum') THEN
          CREATE TYPE "vat_registration_status_enum" AS ENUM (
            'NOT_REGISTERED', 'REGISTERED', 'VOLUNTARY'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entry_type_enum') THEN
          CREATE TYPE "entry_type_enum" AS ENUM (
            'INCOME', 'EXPENSE', 'SALARY', 'TRANSFER'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entry_category_enum') THEN
          CREATE TYPE "entry_category_enum" AS ENUM (
            'SALES_CASH', 'SALES_CARD', 'SALES_ONLINE', 'INVOICE_PAYMENT', 'OTHER_INCOME',
            'SUPPLIER_FOOD', 'SUPPLIER_GOODS', 'RENT', 'UTILITIES', 'EQUIPMENT',
            'MARKETING', 'SOFTWARE', 'TRANSPORT', 'OTHER_EXPENSE',
            'STAFF_SALARY', 'OWNER_SALARY', 'BOARD_FEE', 'BANK_TRANSFER'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entry_status_enum') THEN
          CREATE TYPE "entry_status_enum" AS ENUM (
            'DRAFT', 'CONFIRMED', 'EXCLUDED'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_type_enum') THEN
          CREATE TYPE "source_type_enum" AS ENUM (
            'MANUAL', 'RECEIPT_SCAN', 'ORDER_SYNC', 'INVOICE_SYNC', 'BANK_IMPORT'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'period_status_enum') THEN
          CREATE TYPE "period_status_enum" AS ENUM (
            'OPEN', 'CALCULATING', 'REVIEW', 'FILED', 'LOCKED'
          );
        END IF;
      END $$;
    `);

    // ── bookkeeping_tax_profiles ─────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bookkeeping_tax_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL UNIQUE,
        "persona" "business_persona_enum" NOT NULL,
        "vatStatus" "vat_registration_status_enum" NOT NULL DEFAULT 'NOT_REGISTERED',
        "vatNumber" varchar,
        "registrationCode" varchar,
        "emtaApiToken" varchar,
        "autoFileEnabled" boolean NOT NULL DEFAULT false,
        "defaultVatRate" numeric(5,2) NOT NULL DEFAULT 24,
        "isSoleTraderFie" boolean NOT NULL DEFAULT false,
        "paysAdvanceIncomeTax" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_tax_profiles" PRIMARY KEY ("id")
      )
    `);

    // ── bookkeeping_employees ─────────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bookkeeping_employees" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "fullName" varchar NOT NULL,
        "personalIdCode" varchar,
        "paymentTypeCode" varchar NOT NULL DEFAULT '10',
        "isBoardMember" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true,
        "email" varchar,
        "bankAccount" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bookkeeping_employees" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_employees_org_active"
      ON "bookkeeping_employees" ("organizationId", "isActive")
    `);

    // ── bookkeeping_entries ──────────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bookkeeping_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "date" date NOT NULL,
        "taxYear" integer NOT NULL,
        "taxMonth" integer NOT NULL,

        "entryType" "entry_type_enum" NOT NULL,
        "category" "entry_category_enum" NOT NULL,
        "description" varchar(255) NOT NULL,

        "grossAmount" numeric(12,2) NOT NULL,
        "vatRate" numeric(5,2) NOT NULL DEFAULT 0,
        "vatAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "netAmount" numeric(12,2) NOT NULL,

        "sourceType" "source_type_enum" NOT NULL DEFAULT 'MANUAL',
        "sourceId" varchar,
        "receiptImageUrl" varchar,
        "receiptParsedData" jsonb,

        "invoiceNumber" varchar,
        "counterpartyName" varchar,
        "counterpartyVatNumber" varchar,

        "status" "entry_status_enum" NOT NULL DEFAULT 'CONFIRMED',
        "notes" varchar,
        "createdByUserId" uuid,

        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_bookkeeping_entries" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_entries_org_period"
      ON "bookkeeping_entries" ("organizationId", "taxYear", "taxMonth")
    `);

    // ── bookkeeping_monthly_periods ──────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bookkeeping_monthly_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId" uuid NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,

        "status" "period_status_enum" NOT NULL DEFAULT 'OPEN',

        "totalIncomeGross" numeric(14,2) NOT NULL DEFAULT 0,
        "totalIncomeNet" numeric(14,2) NOT NULL DEFAULT 0,
        "totalExpenseGross" numeric(14,2) NOT NULL DEFAULT 0,
        "totalExpenseNet" numeric(14,2) NOT NULL DEFAULT 0,
        "totalGrossSalary" numeric(14,2) NOT NULL DEFAULT 0,

        "totalIncomeTaxWithheld" numeric(14,2) NOT NULL DEFAULT 0,
        "totalSocialTax" numeric(14,2) NOT NULL DEFAULT 0,
        "totalEmployerCost" numeric(14,2) NOT NULL DEFAULT 0,

        "vatOutputTotal" numeric(14,2) NOT NULL DEFAULT 0,
        "vatInputTotal" numeric(14,2) NOT NULL DEFAULT 0,
        "vatPayable" numeric(14,2) NOT NULL DEFAULT 0,

        "taxBreakdown" jsonb,
        "kmdSubmissionId" uuid,
        "tsdSubmissionId" uuid,

        "filedAt" TIMESTAMP,
        "filedByUserId" uuid,

        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_bookkeeping_monthly_periods" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_period_org_year_month"
          UNIQUE ("organizationId", "year", "month")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "bookkeeping_monthly_periods"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_employees"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookkeeping_tax_profiles"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "period_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "source_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "entry_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "entry_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "entry_type_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "vat_registration_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "business_persona_enum"`);
  }
}
