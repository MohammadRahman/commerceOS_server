import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoreFront1774301577661 implements MigrationInterface {
    name = 'AddStoreFront1774301577661'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_e4781390482956317ada1840bfa"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1"`);
        await queryRunner.query(`ALTER TABLE "orders" RENAME COLUMN "customerId" TO "source"`);
        await queryRunner.query(`CREATE TABLE "store_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "slug" character varying(100) NOT NULL, "custom_domain" character varying(200), "name" character varying(200) NOT NULL, "description" text, "logo_url" text, "banner_url" text, "theme_color" character varying(20) NOT NULL DEFAULT '#6366f1', "currency" character varying(5) NOT NULL DEFAULT 'BDT', "is_active" boolean NOT NULL DEFAULT true, "delivery_fee" integer NOT NULL DEFAULT '0', "min_order" integer NOT NULL DEFAULT '0', "contact_phone" character varying(30), "contact_email" character varying(320), "address" text, "facebook_url" text, "instagram_url" text, "whatsapp_number" character varying(30), CONSTRAINT "UQ_f8af419b2738e8311389979dde3" UNIQUE ("org_id"), CONSTRAINT "UQ_cd402eae9ffc5bf870b9e9f43ee" UNIQUE ("slug"), CONSTRAINT "PK_4da44f346b360f378f1489b6199" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f8af419b2738e8311389979dde" ON "store_settings" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_cd402eae9ffc5bf870b9e9f43e" ON "store_settings" ("slug") `);
        await queryRunner.query(`CREATE INDEX "IDX_581512021c59728e43b77d24e5" ON "store_settings" ("custom_domain") `);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "name" character varying(200) NOT NULL, "slug" character varying(220) NOT NULL, "description" text, "price" integer NOT NULL DEFAULT '0', "compare_price" integer, "stock" integer NOT NULL DEFAULT '0', "images" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "sort_order" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e709b3421913dcef3ab9b4794e" ON "products" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_464f927ae360106b783ed0b410" ON "products" ("slug") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "order_id" uuid NOT NULL, "product_id" uuid, "name" character varying(200) NOT NULL, "price" integer NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "total" integer NOT NULL, "image_url" text, CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4a4ee75fbe42af01d03d1eccb7" ON "order_items" ("org_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_145532db85752b29c57d2b7b1f" ON "order_items" ("order_id") `);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP COLUMN "customerId"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP COLUMN "channelId"`);
        await queryRunner.query(`ALTER TABLE "channels" ADD "name" character varying(200)`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "source" character varying(20) NOT NULL DEFAULT 'MANUAL'`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD']::text[]`);
        await queryRunner.query(`CREATE INDEX "IDX_ee6419219542371563e0592db5" ON "users" ("reset_password_token") `);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_f029c64f58346eb3bb3d760a97e" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_eca1deaa1424f6bc1ae886f4e06" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_772d0ce0473ac2ccfa26060dbe9"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_eca1deaa1424f6bc1ae886f4e06"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_f029c64f58346eb3bb3d760a97e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee6419219542371563e0592db5"`);
        await queryRunner.query(`ALTER TABLE "courier_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "payment_provider_catalog" ALTER COLUMN "supported_countries" SET DEFAULT ARRAY['BD'`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "source" uuid`);
        await queryRunner.query(`ALTER TABLE "channels" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD "channelId" uuid`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD "customerId" uuid`);
        await queryRunner.query(`DROP INDEX "public"."IDX_145532db85752b29c57d2b7b1f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4a4ee75fbe42af01d03d1eccb7"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_464f927ae360106b783ed0b410"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e709b3421913dcef3ab9b4794e"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_581512021c59728e43b77d24e5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cd402eae9ffc5bf870b9e9f43e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f8af419b2738e8311389979dde"`);
        await queryRunner.query(`DROP TABLE "store_settings"`);
        await queryRunner.query(`ALTER TABLE "orders" RENAME COLUMN "source" TO "customerId"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_e4781390482956317ada1840bfa" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
