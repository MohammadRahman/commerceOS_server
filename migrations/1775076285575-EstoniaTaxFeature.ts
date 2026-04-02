import { MigrationInterface, QueryRunner } from 'typeorm';

export class EstoniaTaxFeature1775076285575 implements MigrationInterface {
  name = 'EstoniaTaxFeature1775076285575';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── ENUMS (SAFE CREATION) ─────────────────────────────

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_period_status_enum') THEN
          CREATE TYPE "tax_period_status_enum" AS ENUM (
            'PENDING', 'READY', 'SUBMITTED', 'ACCEPTED', 'REJECTED'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vat_transaction_type_enum') THEN
          CREATE TYPE "vat_transaction_type_enum" AS ENUM (
            'SALE', 'PURCHASE', 'INTRA_EU_SUPPLY', 'INTRA_EU_ACQUISITION',
            'EXPORT', 'IMPORT', 'REVERSE_CHARGE'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_status_enum') THEN
          CREATE TYPE "submission_status_enum" AS ENUM (
            'DRAFT', 'QUEUED', 'SENT', 'ACCEPTED', 'REJECTED', 'AMENDED'
          );
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_form_type_enum') THEN
          CREATE TYPE "tax_form_type_enum" AS ENUM ('KMD', 'TSD');
        END IF;
      END
      $$;
    `);

    // ─── estonia_tax_periods ─────────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "estonia_tax_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "org_id" uuid NOT NULL,
        "year" integer NOT NULL,
        "month" integer NOT NULL,

        "kmdStatus" "tax_period_status_enum" NOT NULL DEFAULT 'PENDING',
        "kmdTaxableSales" numeric(12,2) NOT NULL DEFAULT 0,
        "kmdOutputVat" numeric(12,2) NOT NULL DEFAULT 0,
        "kmdInputVat" numeric(12,2) NOT NULL DEFAULT 0,
        "kmdVatPayable" numeric(12,2) NOT NULL DEFAULT 0,

        "tsdStatus" "tax_period_status_enum" NOT NULL DEFAULT 'PENDING',
        "tsdGrossSalary" numeric(12,2) NOT NULL DEFAULT 0,
        "tsdIncomeTaxWithheld" numeric(12,2) NOT NULL DEFAULT 0,
        "tsdSocialTax" numeric(12,2) NOT NULL DEFAULT 0,
        "tsdUnemploymentEmployer" numeric(12,2) NOT NULL DEFAULT 0,
        "tsdUnemploymentEmployee" numeric(12,2) NOT NULL DEFAULT 0,
        "tsdFundedPensionII" numeric(12,2) NOT NULL DEFAULT 0,

        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_estonia_tax_periods" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tax_period_org_year_month"
          UNIQUE (""org_id"", "year", "month")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tax_periods_org_period"
      ON "estonia_tax_periods" (""org_id"", "year", "month")
    `);

    // ─── estonia_vat_transactions ─────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "estonia_vat_transactions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "org_id" uuid NOT NULL,
        "taxYear" integer NOT NULL,
        "taxMonth" integer NOT NULL,

        "sourceOrderId" varchar,
        "sourcePaymentId" varchar,
        "invoiceNumber" varchar,
        "counterpartyVatNumber" varchar,
        "counterpartyName" varchar,

        "transactionType" "vat_transaction_type_enum" NOT NULL,
        "vatRate" numeric(5,2) NOT NULL,
        "netAmount" numeric(12,2) NOT NULL,
        "vatAmount" numeric(12,2) NOT NULL,
        "grossAmount" numeric(12,2) NOT NULL,

        "transactionDate" date NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_estonia_vat_transactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vat_tx_org_period"
      ON "estonia_vat_transactions" (""org_id"", "taxYear", "taxMonth")
    `);

    // ─── estonia_employee_tax_records ─────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "estonia_employee_tax_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "org_id" uuid NOT NULL,
        "taxYear" integer NOT NULL,
        "taxMonth" integer NOT NULL,

        "employeeIdCode" varchar NOT NULL,
        "employeeName" varchar NOT NULL,
        "paymentTypeCode" varchar NOT NULL DEFAULT '10',
        "isBoardMember" boolean NOT NULL DEFAULT false,

        "grossSalary" numeric(12,2) NOT NULL,
        "basicExemption" numeric(12,2) NOT NULL,
        "incomeTaxBase" numeric(12,2) NOT NULL,
        "incomeTaxWithheld" numeric(12,2) NOT NULL,
        "socialTaxEmployer" numeric(12,2) NOT NULL,
        "unemploymentEmployer" numeric(12,2) NOT NULL,
        "unemploymentEmployee" numeric(12,2) NOT NULL,
        "fundedPensionII" numeric(12,2) NOT NULL,

        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_estonia_employee_tax_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_employee_tax_per_period"
          UNIQUE (""org_id"", "taxYear", "taxMonth", "employeeIdCode")
      )
    `);

    // ─── estonia_tax_submissions ─────────────────────────

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "estonia_tax_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "org_id" uuid NOT NULL,

        "formType" "tax_form_type_enum" NOT NULL,
        "taxYear" integer NOT NULL,
        "taxMonth" integer NOT NULL,

        "status" "submission_status_enum" NOT NULL DEFAULT 'DRAFT',
        "xmlPayload" text NOT NULL,

        "emtaReferenceNumber" varchar,
        "emtaResponse" text,
        "submittedByUserId" uuid,
        "submittedAt" TIMESTAMP,
        "rejectionReason" text,
        "amendsSubmissionId" uuid,

        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),

        CONSTRAINT "PK_estonia_tax_submissions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tax_submissions_org_period"
      ON "estonia_tax_submissions" (""org_id"", "formType", "taxYear", "taxMonth")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_tax_submissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "estonia_employee_tax_records"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_vat_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_tax_periods"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "tax_form_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "submission_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vat_transaction_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tax_period_status_enum"`);
  }
}
