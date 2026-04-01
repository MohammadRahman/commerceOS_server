import { MigrationInterface, QueryRunner } from 'typeorm';

export class EstoniaTaxFeature1775076285575 implements MigrationInterface {
  name = 'EstoniaTaxFeature1775076285575';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── estonia_tax_periods ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."tax_period_status_enum" AS ENUM (
        'PENDING', 'READY', 'SUBMITTED', 'ACCEPTED', 'REJECTED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "estonia_tax_periods" (
        "id"                        uuid                NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"            uuid                NOT NULL,
        "year"                      integer             NOT NULL,
        "month"                     integer             NOT NULL,
        "kmdStatus"                 "public"."tax_period_status_enum" NOT NULL DEFAULT 'PENDING',
        "kmdTaxableSales"           numeric(12,2)       NOT NULL DEFAULT 0,
        "kmdOutputVat"              numeric(12,2)       NOT NULL DEFAULT 0,
        "kmdInputVat"               numeric(12,2)       NOT NULL DEFAULT 0,
        "kmdVatPayable"             numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdStatus"                 "public"."tax_period_status_enum" NOT NULL DEFAULT 'PENDING',
        "tsdGrossSalary"            numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdIncomeTaxWithheld"      numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdSocialTax"              numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdUnemploymentEmployer"   numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdUnemploymentEmployee"   numeric(12,2)       NOT NULL DEFAULT 0,
        "tsdFundedPensionII"        numeric(12,2)       NOT NULL DEFAULT 0,
        "createdAt"                 TIMESTAMP           NOT NULL DEFAULT now(),
        "updatedAt"                 TIMESTAMP           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_estonia_tax_periods" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tax_period_org_year_month" UNIQUE ("organizationId", "year", "month"),
        CONSTRAINT "FK_tax_periods_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tax_periods_org_status" ON "estonia_tax_periods" ("organizationId", "year", "month")
    `);

    // ─── estonia_vat_transactions ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "public"."vat_transaction_type_enum" AS ENUM (
        'SALE', 'PURCHASE', 'INTRA_EU_SUPPLY', 'INTRA_EU_ACQUISITION',
        'EXPORT', 'IMPORT', 'REVERSE_CHARGE'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "estonia_vat_transactions" (
        "id"                    uuid                      NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"        uuid                      NOT NULL,
        "taxYear"               integer                   NOT NULL,
        "taxMonth"              integer                   NOT NULL,
        "sourceOrderId"         character varying,
        "sourcePaymentId"       character varying,
        "invoiceNumber"         character varying,
        "counterpartyVatNumber" character varying,
        "counterpartyName"      character varying,
        "transactionType"       "public"."vat_transaction_type_enum" NOT NULL,
        "vatRate"               numeric(5,2)              NOT NULL,
        "netAmount"             numeric(12,2)             NOT NULL,
        "vatAmount"             numeric(12,2)             NOT NULL,
        "grossAmount"           numeric(12,2)             NOT NULL,
        "transactionDate"       date                      NOT NULL,
        "createdAt"             TIMESTAMP                 NOT NULL DEFAULT now(),
        CONSTRAINT "PK_estonia_vat_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vat_tx_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_vat_tx_org_period" ON "estonia_vat_transactions" ("organizationId", "taxYear", "taxMonth")
    `);

    // ─── estonia_employee_tax_records ────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "estonia_employee_tax_records" (
        "id"                      uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"          uuid          NOT NULL,
        "taxYear"                 integer       NOT NULL,
        "taxMonth"                integer       NOT NULL,
        "employeeIdCode"          character varying NOT NULL,
        "employeeName"            character varying NOT NULL,
        "paymentTypeCode"         character varying NOT NULL DEFAULT '10',
        "isBoardMember"           boolean       NOT NULL DEFAULT false,
        "grossSalary"             numeric(12,2) NOT NULL,
        "basicExemption"          numeric(12,2) NOT NULL,
        "incomeTaxBase"           numeric(12,2) NOT NULL,
        "incomeTaxWithheld"       numeric(12,2) NOT NULL,
        "socialTaxEmployer"       numeric(12,2) NOT NULL,
        "unemploymentEmployer"    numeric(12,2) NOT NULL,
        "unemploymentEmployee"    numeric(12,2) NOT NULL,
        "fundedPensionII"         numeric(12,2) NOT NULL,
        "createdAt"               TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"               TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_estonia_employee_tax_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_employee_tax_per_period"
          UNIQUE ("organizationId", "taxYear", "taxMonth", "employeeIdCode"),
        CONSTRAINT "FK_employee_tax_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    // ─── estonia_tax_submissions (audit trail — never delete rows) ───────────
    await queryRunner.query(`
      CREATE TYPE "public"."submission_status_enum" AS ENUM (
        'DRAFT', 'QUEUED', 'SENT', 'ACCEPTED', 'REJECTED', 'AMENDED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."tax_form_type_enum" AS ENUM ('KMD', 'TSD')
    `);

    await queryRunner.query(`
      CREATE TABLE "estonia_tax_submissions" (
        "id"                    uuid                              NOT NULL DEFAULT uuid_generate_v4(),
        "organizationId"        uuid                              NOT NULL,
        "formType"              "public"."tax_form_type_enum"     NOT NULL,
        "taxYear"               integer                           NOT NULL,
        "taxMonth"              integer                           NOT NULL,
        "status"                "public"."submission_status_enum" NOT NULL DEFAULT 'DRAFT',
        "xmlPayload"            text                              NOT NULL,
        "emtaReferenceNumber"   character varying,
        "emtaResponse"          text,
        "submittedByUserId"     uuid,
        "submittedAt"           TIMESTAMP,
        "rejectionReason"       text,
        "amendsSubmissionId"    uuid,
        "createdAt"             TIMESTAMP                         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_estonia_tax_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tax_submissions_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tax_submissions_org_period"
        ON "estonia_tax_submissions" ("organizationId", "formType", "taxYear", "taxMonth")
    `);

    // Add RBAC permissions for the tax module
    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description") VALUES
        ('tax:read',   'View tax summaries, transactions, and submission history'),
        ('tax:write',  'Record VAT transactions and employee payroll data'),
        ('tax:submit', 'Trigger KMD and TSD filing to EMTA')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_tax_submissions"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "estonia_employee_tax_records"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_vat_transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "estonia_tax_periods"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."submission_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tax_form_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."vat_transaction_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."tax_period_status_enum"`,
    );
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "name" IN ('tax:read', 'tax:write', 'tax:submit')
    `);
  }
}
