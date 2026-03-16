import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedProviderCatalogs1234567890123 implements MigrationInterface {
  name = 'SeedProviderCatalogs1234567890123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Payment providers
    await queryRunner.query(`
      INSERT INTO payment_provider_catalog
        (id, created_at, updated_at, type, name, "isEnabled", supported_countries)
      VALUES
        (gen_random_uuid(), now(), now(), 'bkash',      'bKash',      true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'nagad',      'Nagad',      true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'rocket',     'Rocket',     true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'sslcommerz', 'SSLCommerz', true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'stripe',     'Stripe',     true, ARRAY['BD','US','GB'])
      ON CONFLICT (type) DO NOTHING
    `);

    // Courier providers
    await queryRunner.query(`
      INSERT INTO courier_provider_catalog
        (id, created_at, updated_at, type, name, "isEnabled", supported_countries)
      VALUES
        (gen_random_uuid(), now(), now(), 'pathao',    'Pathao',    true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'steadfast', 'Steadfast', true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'redx',      'Redx',      true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'paperfly',  'Paperfly',  true, ARRAY['BD']),
        (gen_random_uuid(), now(), now(), 'sundarban', 'Sundarban', true, ARRAY['BD'])
      ON CONFLICT (type) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM payment_provider_catalog
      WHERE type IN ('bkash','nagad','rocket','sslcommerz','stripe')
    `);
    await queryRunner.query(`
      DELETE FROM courier_provider_catalog
      WHERE type IN ('pathao','steadfast','redx','paperfly','sundarban')
    `);
  }
}
