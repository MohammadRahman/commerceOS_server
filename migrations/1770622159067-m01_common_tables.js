/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class M01CommonTables1770622159067 {
    name = 'M01CommonTables1770622159067'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(80) NOT NULL, "payload" jsonb NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'PENDING', "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d109f3ffaff55a608b4a302c01" ON "outbox_events" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_0b7668aa1aed034a544a7ad043" ON "outbox_events" ("type") `);
        await queryRunner.query(`CREATE INDEX "IDX_733fafe6b0ec20ec7c93fdbbca" ON "outbox_events" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_6386ea4d00463337e4d9e50305" ON "outbox_events" ("status", "available_at") `);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "scope" character varying(80) NOT NULL, "key" character varying(200) NOT NULL, "request_hash" character varying(100), "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_idem_org_scope_key" UNIQUE ("org_id", "scope", "key"), CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1eaac38e984e753ad348af8d3f" ON "idempotency_keys" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d90920d54414181afb00049806" ON "idempotency_keys" ("scope") `);
        await queryRunner.query(`CREATE INDEX "IDX_e5fc0731b6752a8e9194fa265e" ON "idempotency_keys" ("expires_at") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_e5fc0731b6752a8e9194fa265e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d90920d54414181afb00049806"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1eaac38e984e753ad348af8d3f"`);
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6386ea4d00463337e4d9e50305"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_733fafe6b0ec20ec7c93fdbbca"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0b7668aa1aed034a544a7ad043"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d109f3ffaff55a608b4a302c01"`);
        await queryRunner.query(`DROP TABLE "outbox_events"`);
    }
}
