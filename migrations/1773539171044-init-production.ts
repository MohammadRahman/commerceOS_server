import { MigrationInterface, QueryRunner } from "typeorm";

export class InitProduction1773539171044 implements MigrationInterface {
    name = 'InitProduction1773539171044'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
    }

}
