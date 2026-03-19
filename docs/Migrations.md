# Migration naming convention and workflow

# Save this as MIGRATIONS.md in repo root

## The rule: NEVER hand-write migration timestamps

Always use the CLI to create migrations:

npm run migration:generate -- migrations/AddChannelName

# → generates: migrations/1773960123456-AddChannelName.ts

# Timestamp is auto-set by TypeORM, class name matches filename ✓

npm run migration:create -- migrations/AddChannelName

# → generates empty migration with correct timestamp

## Why the old migrations broke

The doubled-timestamp bug happened because:

1. File was named: 1773773836937-1773600000000-AddUserPasswordResetFields.ts
2. TypeORM extracts timestamp from FILENAME prefix: 1773773836937
3. But class name inside was: AddUserPasswordResetFields1773600000000
4. Mismatch → TypeORM couldn't track it → "No migrations are pending"

## The correct format

File: migrations/1773960000000-AddChannelName.ts
Class: export class AddChannelName1773960000000 implements MigrationInterface

Both the filename prefix AND the class name suffix must be the SAME timestamp.
The CLI handles this automatically — never write it by hand.

## Adding a new migration for production

1. Generate it:
   npm run migration:generate -- migrations/DescriptiveName

2. Review the generated file — make sure it looks right

3. Commit and push → Docker builds → entrypoint runs migrations automatically

## Manual run on production DB (emergency only)

If you need to run a specific migration manually:
npm run migration:run:prod

Or directly via Railway CLI:
railway run npm run migration:run:prod

## Current migration order (must run in this order)

1. 1773540526729-000-full-schema → base schema
2. 1773600000000-AddUserPasswordResetFields → password reset columns
3. 1773699871306-001-seed-provider-catalogs → provider catalog data
4. 1773700000000-AddUserOtpFields → OTP columns
5. 1773960000000-AddChannelName → channel name column (NEW)
