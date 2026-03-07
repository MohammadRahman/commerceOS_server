-- docker/postgres/init/01-init.sql
-- Runs once on first container creation (not on every restart).
-- Creates the prod shadow DB for testing migrations against prod schema.

-- Dev database (already created by POSTGRES_DB env var, this is a no-op)
SELECT 'dev db ready' AS status;

-- Optional: create a test database for running integration tests
-- CREATE DATABASE app_test;