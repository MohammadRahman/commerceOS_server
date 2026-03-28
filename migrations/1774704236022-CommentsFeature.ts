import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommentsFeature1774704236022 implements MigrationInterface {
  name = 'CommentsFeature1774704236022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── social_posts ───────────────────────────────────────────────────────
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "social_posts" (
                "id"               uuid         NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "org_id"           uuid         NOT NULL,
                "platform_post_id" character varying(100) NOT NULL,
                "platform"         character varying(20)  NOT NULL,
                "type"             character varying(20)  NOT NULL,
                "title"            text,
                "message"          text,
                "permalink"        text,
                "thumbnail_url"    text,
                "is_live"          boolean      NOT NULL DEFAULT false,
                "live_started_at"  TIMESTAMP WITH TIME ZONE,
                "live_ended_at"    TIMESTAMP WITH TIME ZONE,
                "comment_count"    integer      NOT NULL DEFAULT '0',
                "processed_count"  integer      NOT NULL DEFAULT '0',
                "synced_at"        TIMESTAMP WITH TIME ZONE,
                "posted_at"        TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_2161864ea79f14525b8804bd7ff" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_3a395cbac784163de98f0bf76e" ON "social_posts" ("org_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_5a60b3d9a1550718c7e5b362d0" ON "social_posts" ("platform_post_id")`,
    );

    // ── post_comments ──────────────────────────────────────────────────────
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "post_comments" (
                "id"                    uuid         NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "org_id"                uuid         NOT NULL,
                "post_id"               uuid         NOT NULL,
                "platform_comment_id"   character varying(100) NOT NULL,
                "parent_comment_id"     character varying(100),
                "platform"              character varying(20)  NOT NULL,
                "sender_id"             character varying(100) NOT NULL,
                "sender_name"           character varying(200) NOT NULL,
                "sender_profile_url"    text,
                "text"                  text         NOT NULL,
                "commented_at"          TIMESTAMP WITH TIME ZONE NOT NULL,
                "intent"                character varying(30)  NOT NULL DEFAULT 'other',
                "intent_confidence"     double precision NOT NULL DEFAULT '0',
                "is_classified"         boolean      NOT NULL DEFAULT false,
                "status"                character varying(30)  NOT NULL DEFAULT 'new',
                "reply_text"            text,
                "replied_at"            TIMESTAMP WITH TIME ZONE,
                "replied_by"            uuid,
                "conversation_id"       uuid,
                "moved_to_inbox_at"     TIMESTAMP WITH TIME ZONE,
                "payment_link_id"       uuid,
                "payment_sent_at"       TIMESTAMP WITH TIME ZONE,
                "is_returning_customer" boolean      NOT NULL DEFAULT false,
                "customer_id"           uuid,
                CONSTRAINT "UQ_2d36fafdb6b7e418dc8919bc45d" UNIQUE ("platform_comment_id"),
                CONSTRAINT "PK_2e99e04b4a1b31de6f833c18ced" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_135d1afd6a9d6b4bfe44fcf568" ON "post_comments" ("org_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_e8ffd07822f03f90f637b13cd5" ON "post_comments" ("post_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_2d36fafdb6b7e418dc8919bc45" ON "post_comments" ("platform_comment_id")`,
    );

    // ── auto_reply_rules ───────────────────────────────────────────────────
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "auto_reply_rules" (
                "id"             uuid         NOT NULL DEFAULT uuid_generate_v4(),
                "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "org_id"         uuid         NOT NULL,
                "name"           character varying(200) NOT NULL,
                "is_active"      boolean      NOT NULL DEFAULT true,
                "trigger"        character varying(20)  NOT NULL,
                "keywords"       text array   NOT NULL DEFAULT '{}',
                "intents"        text array   NOT NULL DEFAULT '{}',
                "platforms"      text array   NOT NULL DEFAULT '{}',
                "action"         character varying(30)  NOT NULL,
                "reply_template" text,
                "dm_template"    text,
                "product_id"     uuid,
                "priority"       integer      NOT NULL DEFAULT '100',
                "fire_count"     integer      NOT NULL DEFAULT '0',
                "last_fired_at"  TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_6fa38b7c6700536999726f41b81" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_beea0649b17c6b7454e5183b52" ON "auto_reply_rules" ("org_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_beea0649b17c6b7454e5183b52"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auto_reply_rules"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_2d36fafdb6b7e418dc8919bc45"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_e8ffd07822f03f90f637b13cd5"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_135d1afd6a9d6b4bfe44fcf568"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "post_comments"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_5a60b3d9a1550718c7e5b362d0"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_3a395cbac784163de98f0bf76e"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_posts"`);
  }
}
