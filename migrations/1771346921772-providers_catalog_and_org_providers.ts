import { MigrationInterface, QueryRunner } from "typeorm";

export class ProvidersCatalogAndOrgProviders1771346921772 implements MigrationInterface {
    name = 'ProvidersCatalogAndOrgProviders1771346921772'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "payment_provider_catalog" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(50) NOT NULL, "name" character varying(120) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "supported_countries" text array NOT NULL DEFAULT ARRAY['BD']::text[], "logo_url" text, "website" text, CONSTRAINT "uq_payment_provider_catalog_type" UNIQUE ("type"), CONSTRAINT "PK_6f7210665c45a2021517f31b72c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_715f9c9bb1c2e6265fbedb3a33" ON "payment_provider_catalog" ("type") `);
        await queryRunner.query(`CREATE TABLE "org_payment_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'INACTIVE', "config" jsonb, "webhook_key" character varying(64), CONSTRAINT "uq_org_payment_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_06c920f264caec0cb18b6e9694f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4a731b1e86a5b31b59fa6cb7a2" ON "org_payment_providers" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_508c29aa652cad608033b866d5" ON "org_payment_providers" ("type") `);
        await queryRunner.query(`CREATE INDEX "IDX_bd38e63a91fc686af92a5b9344" ON "org_payment_providers" ("webhook_key") `);
        await queryRunner.query(`CREATE TABLE "courier_provider_catalog" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(50) NOT NULL, "name" character varying(120) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "supported_countries" text array NOT NULL DEFAULT ARRAY['BD']::text[], "logo_url" text, "website" text, CONSTRAINT "uq_courier_provider_catalog_type" UNIQUE ("type"), CONSTRAINT "PK_f9ed89952f1f30f5d5e294c2d12" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_01397a4faff1ac73c3a91bffba" ON "courier_provider_catalog" ("type") `);
        await queryRunner.query(`CREATE TABLE "org_courier_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'INACTIVE', "config" jsonb, CONSTRAINT "uq_org_courier_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_9e0131a91c920f9ae9fcd20db2a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f6db5c0859565645ce901b65a9" ON "org_courier_providers" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_6a41c2655e3b0c4704e7a41c0a" ON "org_courier_providers" ("type") `);
        await queryRunner.query(`CREATE TABLE "payment_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'inactive', "config" jsonb, CONSTRAINT "uq_payment_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_1e51e9c9553171a6d1a3c46f3a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_776f9ffc6d9f266dedcae1694b" ON "payment_providers" ("org_id") `);
        await queryRunner.query(`ALTER TABLE "organizations" ADD "country_code" character(2) NOT NULL DEFAULT 'BD'`);
        await queryRunner.query(`CREATE INDEX "IDX_3aa670ebef576cab172c404e24" ON "organizations" ("country_code") `);
        await queryRunner.query(`ALTER TABLE "org_payment_providers" ADD CONSTRAINT "FK_4a731b1e86a5b31b59fa6cb7a2d" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "org_courier_providers" ADD CONSTRAINT "FK_f6db5c0859565645ce901b65a9d" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "org_courier_providers" DROP CONSTRAINT "FK_f6db5c0859565645ce901b65a9d"`);
        await queryRunner.query(`ALTER TABLE "org_payment_providers" DROP CONSTRAINT "FK_4a731b1e86a5b31b59fa6cb7a2d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3aa670ebef576cab172c404e24"`);
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "country_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_776f9ffc6d9f266dedcae1694b"`);
        await queryRunner.query(`DROP TABLE "payment_providers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6a41c2655e3b0c4704e7a41c0a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6db5c0859565645ce901b65a9"`);
        await queryRunner.query(`DROP TABLE "org_courier_providers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_01397a4faff1ac73c3a91bffba"`);
        await queryRunner.query(`DROP TABLE "courier_provider_catalog"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bd38e63a91fc686af92a5b9344"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_508c29aa652cad608033b866d5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4a731b1e86a5b31b59fa6cb7a2"`);
        await queryRunner.query(`DROP TABLE "org_payment_providers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_715f9c9bb1c2e6265fbedb3a33"`);
        await queryRunner.query(`DROP TABLE "payment_provider_catalog"`);
    }

}
