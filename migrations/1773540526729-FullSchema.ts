import { MigrationInterface, QueryRunner } from 'typeorm';

export class FullSchema1773540526729 implements MigrationInterface {
  name = 'FullSchema1773540526729';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(80) NOT NULL, "payload" jsonb NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'PENDING', "attempts" integer NOT NULL DEFAULT '0', "last_error" text, "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6689a16c00d09b8089f6237f1d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d109f3ffaff55a608b4a302c01" ON "outbox_events" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b7668aa1aed034a544a7ad043" ON "outbox_events" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_733fafe6b0ec20ec7c93fdbbca" ON "outbox_events" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6386ea4d00463337e4d9e50305" ON "outbox_events" ("status", "available_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "scope" character varying(80) NOT NULL, "key" character varying(200) NOT NULL, "request_hash" character varying(100), "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_idem_org_scope_key" UNIQUE ("org_id", "scope", "key"), CONSTRAINT "PK_8ad20779ad0411107a56e53d0f6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1eaac38e984e753ad348af8d3f" ON "idempotency_keys" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d90920d54414181afb00049806" ON "idempotency_keys" ("scope") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5fc0731b6752a8e9194fa265e" ON "idempotency_keys" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(200) NOT NULL, "plan" character varying(50) NOT NULL DEFAULT 'FREE', "timezone" character varying(50) NOT NULL DEFAULT 'Asia/Dhaka', "currency" character varying(10) NOT NULL DEFAULT 'BDT', "pickupAddress" character varying(300) NOT NULL DEFAULT '', "isOnboarded" boolean NOT NULL DEFAULT false, "country_code" character(2) NOT NULL DEFAULT 'BD', CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b7ca6d30b94fef571cff87688" ON "organizations" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3aa670ebef576cab172c404e24" ON "organizations" ("country_code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "email" character varying(320) NOT NULL, "name" character varying(200), "password_hash" character varying(200) NOT NULL, "role" character varying(20) NOT NULL DEFAULT 'AGENT', "status" character varying(20) NOT NULL DEFAULT 'active', "is_active" boolean NOT NULL DEFAULT true, "temp_password" character varying(100), "orgId" uuid, CONSTRAINT "uq_users_org_email" UNIQUE ("org_id", "email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a13270cd3101fd16b8000e00d" ON "users" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "user_id" uuid NOT NULL, "refresh_token_hash" character varying(200) NOT NULL, "user_agent" character varying(500), "ip" character varying(100), "revoked_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "userId" uuid, CONSTRAINT "PK_e93e031a5fed190d4789b6bfd83" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa71b4819662157798bd0cb999" ON "user_sessions" ("org_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "direction" character varying(10) NOT NULL, "external_message_id" character varying(120), "message_type" character varying(30) NOT NULL DEFAULT 'TEXT', "text" text, "raw_payload" jsonb, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "conversationId" uuid, CONSTRAINT "uq_messages_conversation_external" UNIQUE ("conversation_id", "external_message_id"), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52f72a2dc840864bb905c4cbe1" ON "messages" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3bc55a7c3f9ed54b520bb5cfe2" ON "messages" ("conversation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_919fea85fd79383e9b490e3835" ON "messages" ("occurred_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "channel_id" uuid NOT NULL, "external_thread_id" character varying(120) NOT NULL, "external_user_id" character varying(120), "last_message_at" TIMESTAMP WITH TIME ZONE, "assigned_user_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'open', CONSTRAINT "uq_conversations_channel_thread" UNIQUE ("channel_id", "external_thread_id"), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a33a65fd25c48fd0de13be21b6" ON "conversations" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a99838ee2e2e940ad98ed2e9d" ON "conversations" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9185e4a10f53167d15f23e1720" ON "conversations" ("last_message_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_913b133c5fd52744e5a5196315" ON "conversations" ("assigned_user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "channels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(20) NOT NULL, "external_account_id" character varying(100), "page_id" character varying(100), "ig_business_id" character varying(100), "access_token_enc" text, "token_expiry_at" TIMESTAMP WITH TIME ZONE, "status" character varying(30) NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "uq_channels_org_type_external" UNIQUE ("org_id", "type", "external_account_id"), CONSTRAINT "PK_bc603823f3f741359c2339389f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_930a61f31752c4f2b9f133e655" ON "channels" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_770bc30bc837ed6fe788bbe118" ON "channels" ("type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "customer_identities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "customer_id" uuid NOT NULL, "channel_id" uuid NOT NULL, "external_user_id" character varying(120) NOT NULL, "metadata" jsonb, "customerId" uuid, "channelId" uuid, CONSTRAINT "uq_customer_identity_channel_external" UNIQUE ("channel_id", "external_user_id"), CONSTRAINT "PK_22a6dcd2cf7f2587b5a27cfa9c8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_108d5ed97bfa469869e74905ee" ON "customer_identities" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f029c64f58346eb3bb3d760a97" ON "customer_identities" ("customer_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eca1deaa1424f6bc1ae886f4e0" ON "customer_identities" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "name" character varying(200), "phone" character varying(30), "email" character varying(320), "address_text" text, "last_seen_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1ea572bed0889441c72e572a7" ON "customers" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_88acd889fbe17d0e16cc4bc917" ON "customers" ("phone") `,
    );
    await queryRunner.query(
      `CREATE TABLE "order_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "order_id" uuid NOT NULL, "type" character varying(60) NOT NULL, "data" jsonb, CONSTRAINT "PK_cc1b82b0fcf1be577d9d7ecbf8b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a8c6433a2cc0303e5da54f833" ON "order_events" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b33cbf9a59cbee112d94bcb59d" ON "order_events" ("order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "customer_id" uuid NOT NULL, "conversation_id" uuid, "status" character varying(20) NOT NULL DEFAULT 'NEW', "subtotal" integer NOT NULL DEFAULT '0', "delivery_fee" integer NOT NULL DEFAULT '0', "total" integer NOT NULL DEFAULT '0', "currency" character varying(5) NOT NULL DEFAULT 'BDT', "campaign_tag" character varying(100), "notes" text, "paid_amount" integer NOT NULL DEFAULT '0', "payment_status" character varying(20) NOT NULL DEFAULT 'UNPAID', "balance_due" integer NOT NULL DEFAULT '0', "customerId" uuid, "conversationId" uuid, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a313d7b77cb470ec635e640394" ON "orders" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_772d0ce0473ac2ccfa26060dbe" ON "orders" ("customer_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d58acb99141f77ad3b1bddfe9e" ON "orders" ("conversation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22459225158a601db73f83c099" ON "orders" ("campaign_tag") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shipment_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "shipment_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "payload" jsonb, "shipmentId" uuid, CONSTRAINT "PK_80a42a8d00d59cbfab38e1d0872" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d562336a05399099b8e4391a40" ON "shipment_events" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7550a4aa8c7fe2d64f6c71d7da" ON "shipment_events" ("shipment_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shipments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "order_id" uuid NOT NULL, "courier_provider" character varying(40) NOT NULL, "consignment_id" character varying(120), "tracking_url" text, "status" character varying(30) NOT NULL DEFAULT 'CREATED', "last_update_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_shipment_provider_consignment" UNIQUE ("courier_provider", "consignment_id"), CONSTRAINT "PK_6deda4532ac542a93eab214b564" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d870d53e7d9584dc8b14c5338" ON "shipments" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e86fac2a18a75dcb82bfbb23f4" ON "shipments" ("order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eaa99dfdfce43f7dff61912bdb" ON "shipments" ("consignment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a19baf6dd62cac42fbb40a518" ON "shipments" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_provider_catalog" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(50) NOT NULL, "name" character varying(120) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "supported_countries" text array NOT NULL DEFAULT ARRAY['BD']::text[], "logo_url" text, "website" text, CONSTRAINT "uq_payment_provider_catalog_type" UNIQUE ("type"), CONSTRAINT "PK_6f7210665c45a2021517f31b72c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_715f9c9bb1c2e6265fbedb3a33" ON "payment_provider_catalog" ("type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "org_payment_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'INACTIVE', "config" jsonb, "webhook_key" character varying(64), CONSTRAINT "uq_org_payment_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_06c920f264caec0cb18b6e9694f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4a731b1e86a5b31b59fa6cb7a2" ON "org_payment_providers" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_508c29aa652cad608033b866d5" ON "org_payment_providers" ("type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd38e63a91fc686af92a5b9344" ON "org_payment_providers" ("webhook_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "courier_provider_catalog" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "type" character varying(50) NOT NULL, "name" character varying(120) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "supported_countries" text array NOT NULL DEFAULT ARRAY['BD']::text[], "logo_url" text, "website" text, CONSTRAINT "uq_courier_provider_catalog_type" UNIQUE ("type"), CONSTRAINT "PK_f9ed89952f1f30f5d5e294c2d12" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01397a4faff1ac73c3a91bffba" ON "courier_provider_catalog" ("type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "order_id" uuid NOT NULL, "provider" character varying(40) NOT NULL, "amount" integer NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'CREATED', "url" text, "provider_ref" character varying(120), "codAmount" integer DEFAULT '0', "trxId" character varying(100), CONSTRAINT "uq_payment_provider_ref" UNIQUE ("provider", "provider_ref"), CONSTRAINT "PK_5b176ff8200166713c53d6c3ada" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5234563a8c41b7a622d555275d" ON "payment_links" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a74cc6e6536211fd7e9869bb7" ON "payment_links" ("order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6017bc6a86a04f35e63c6895e8" ON "payment_links" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "payment_link_id" uuid NOT NULL, "type" character varying(60) NOT NULL, "payload" jsonb, CONSTRAINT "PK_9f1d16fc78b33e676940a32e8b5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ecb36acb21cc32cad1e8ada748" ON "payment_events" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cb20d9e7df9d4e6f11c5a891c4" ON "payment_events" ("payment_link_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "org_courier_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'INACTIVE', "config" jsonb, "webhook_key" character varying(100), CONSTRAINT "uq_org_courier_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_9e0131a91c920f9ae9fcd20db2a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f6db5c0859565645ce901b65a9" ON "org_courier_providers" ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a41c2655e3b0c4704e7a41c0a" ON "org_courier_providers" ("type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "type" character varying(40) NOT NULL, "name" character varying(100) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'inactive', "config" jsonb, CONSTRAINT "uq_payment_provider_org_type" UNIQUE ("org_id", "type"), CONSTRAINT "PK_1e51e9c9553171a6d1a3c46f3a3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_776f9ffc6d9f266dedcae1694b" ON "payment_providers" ("org_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_1890588e47e133fd85670f187d6" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_55fa4db8406ed66bc7044328427" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_e5663ce0c730b2de83445e2fd19" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "FK_1a99838ee2e2e940ad98ed2e9d8" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_identities" ADD CONSTRAINT "FK_e4781390482956317ada1840bfa" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_events" ADD CONSTRAINT "FK_b33cbf9a59cbee112d94bcb59de" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_c9d5182fe928b59205b5b6ad873" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipment_events" ADD CONSTRAINT "FK_e0d86c92942127971af5a1d9829" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD CONSTRAINT "FK_e86fac2a18a75dcb82bfbb23f43" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_payment_providers" ADD CONSTRAINT "FK_4a731b1e86a5b31b59fa6cb7a2d" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_links" ADD CONSTRAINT "FK_9a74cc6e6536211fd7e9869bb77" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_events" ADD CONSTRAINT "FK_cb20d9e7df9d4e6f11c5a891c4e" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_courier_providers" ADD CONSTRAINT "FK_f6db5c0859565645ce901b65a9d" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "org_courier_providers" DROP CONSTRAINT "FK_f6db5c0859565645ce901b65a9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_events" DROP CONSTRAINT "FK_cb20d9e7df9d4e6f11c5a891c4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_links" DROP CONSTRAINT "FK_9a74cc6e6536211fd7e9869bb77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_payment_providers" DROP CONSTRAINT "FK_4a731b1e86a5b31b59fa6cb7a2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipments" DROP CONSTRAINT "FK_e86fac2a18a75dcb82bfbb23f43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipment_events" DROP CONSTRAINT "FK_e0d86c92942127971af5a1d9829"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_c9d5182fe928b59205b5b6ad873"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_e5de51ca888d8b1f5ac25799dd1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_events" DROP CONSTRAINT "FK_b33cbf9a59cbee112d94bcb59de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_e4781390482956317ada1840bfa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_identities" DROP CONSTRAINT "FK_8ff902b9e8b2f556f37921a3bfd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "FK_1a99838ee2e2e940ad98ed2e9d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_e5663ce0c730b2de83445e2fd19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_sessions" DROP CONSTRAINT "FK_55fa4db8406ed66bc7044328427"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_1890588e47e133fd85670f187d6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_776f9ffc6d9f266dedcae1694b"`,
    );
    await queryRunner.query(`DROP TABLE "payment_providers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a41c2655e3b0c4704e7a41c0a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f6db5c0859565645ce901b65a9"`,
    );
    await queryRunner.query(`DROP TABLE "org_courier_providers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cb20d9e7df9d4e6f11c5a891c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ecb36acb21cc32cad1e8ada748"`,
    );
    await queryRunner.query(`DROP TABLE "payment_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6017bc6a86a04f35e63c6895e8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a74cc6e6536211fd7e9869bb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5234563a8c41b7a622d555275d"`,
    );
    await queryRunner.query(`DROP TABLE "payment_links"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01397a4faff1ac73c3a91bffba"`,
    );
    await queryRunner.query(`DROP TABLE "courier_provider_catalog"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd38e63a91fc686af92a5b9344"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_508c29aa652cad608033b866d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4a731b1e86a5b31b59fa6cb7a2"`,
    );
    await queryRunner.query(`DROP TABLE "org_payment_providers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_715f9c9bb1c2e6265fbedb3a33"`,
    );
    await queryRunner.query(`DROP TABLE "payment_provider_catalog"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a19baf6dd62cac42fbb40a518"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eaa99dfdfce43f7dff61912bdb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e86fac2a18a75dcb82bfbb23f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d870d53e7d9584dc8b14c5338"`,
    );
    await queryRunner.query(`DROP TABLE "shipments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7550a4aa8c7fe2d64f6c71d7da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d562336a05399099b8e4391a40"`,
    );
    await queryRunner.query(`DROP TABLE "shipment_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22459225158a601db73f83c099"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d58acb99141f77ad3b1bddfe9e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_772d0ce0473ac2ccfa26060dbe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a313d7b77cb470ec635e640394"`,
    );
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b33cbf9a59cbee112d94bcb59d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a8c6433a2cc0303e5da54f833"`,
    );
    await queryRunner.query(`DROP TABLE "order_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_88acd889fbe17d0e16cc4bc917"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1ea572bed0889441c72e572a7"`,
    );
    await queryRunner.query(`DROP TABLE "customers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eca1deaa1424f6bc1ae886f4e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f029c64f58346eb3bb3d760a97"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_108d5ed97bfa469869e74905ee"`,
    );
    await queryRunner.query(`DROP TABLE "customer_identities"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_770bc30bc837ed6fe788bbe118"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_930a61f31752c4f2b9f133e655"`,
    );
    await queryRunner.query(`DROP TABLE "channels"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_913b133c5fd52744e5a5196315"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9185e4a10f53167d15f23e1720"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a99838ee2e2e940ad98ed2e9d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a33a65fd25c48fd0de13be21b6"`,
    );
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_919fea85fd79383e9b490e3835"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3bc55a7c3f9ed54b520bb5cfe2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52f72a2dc840864bb905c4cbe1"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa71b4819662157798bd0cb999"`,
    );
    await queryRunner.query(`DROP TABLE "user_sessions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a13270cd3101fd16b8000e00d"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3aa670ebef576cab172c404e24"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b7ca6d30b94fef571cff87688"`,
    );
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5fc0731b6752a8e9194fa265e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d90920d54414181afb00049806"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1eaac38e984e753ad348af8d3f"`,
    );
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6386ea4d00463337e4d9e50305"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_733fafe6b0ec20ec7c93fdbbca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b7668aa1aed034a544a7ad043"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d109f3ffaff55a608b4a302c01"`,
    );
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
