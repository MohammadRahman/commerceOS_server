import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelName1773962153447 implements MigrationInterface {
  name = 'AddChannelName1773962153447';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1"`,
    );
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "customerId"`);
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "name" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee6419219542371563e0592db5" ON "users" ("reset_password_token") `,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee6419219542371563e0592db5"`,
    );
    // ✅ Fixed: restored missing closing bracket
    await queryRunner.query(
      `ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`,
    );
    await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "name"`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "customerId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
