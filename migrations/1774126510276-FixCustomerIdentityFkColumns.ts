import { MigrationInterface, QueryRunner } from "typeorm";

export class FixCustomerIdentityFkColumns1774126510276 implements MigrationInterface {
    name = 'FixCustomerIdentityFkColumns1774126510276'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_e4781390482956317ada1840bfa"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP COLUMN "customerId"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP COLUMN "channelId"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "customerId"`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`CREATE INDEX "IDX_ee6419219542371563e0592db5" ON "users" ("reset_password_token") `);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_f029c64f58346eb3bb3d760a97e" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_eca1deaa1424f6bc1ae886f4e06" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_eca1deaa1424f6bc1ae886f4e06"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_f029c64f58346eb3bb3d760a97e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee6419219542371563e0592db5"`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "customerId" uuid`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD "channelId" uuid`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD "customerId" uuid`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_e4781390482956317ada1840bfa" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
