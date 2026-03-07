import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCodAmountAndTrxIdToPaymentLinks1772667941486 implements MigrationInterface {
    name = 'AddCodAmountAndTrxIdToPaymentLinks1772667941486'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_links" ADD "codAmount" integer DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payment_links" ADD "trxId" character varying(100)`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "payment_links" DROP COLUMN "trxId"`);
        await queryRunner.query(`ALTER TABLE "payment_links" DROP COLUMN "codAmount"`);
    }

}
