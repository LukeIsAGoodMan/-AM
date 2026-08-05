-- ROLLBACK for 0016_rls_least_privilege.sql.
--
-- ⚠️ This RESTORES the insecure pre-0016 baseline: it disables RLS and re-opens
-- the Supabase Data API to anon/authenticated. Use only if the lockdown broke a
-- legitimate consumer. For an EXACT-state restore, use the grant snapshot you
-- captured pre-deploy (see docs/DEPLOY.md "manual verification checklist").
--
-- It deliberately does NOT recreate the stray "admins manage reward rules" policy
-- or the authenticated DML grant on reward_rules — those were incorrect.
--
-- Apply manually (NOT via drizzle): psql "<hosted-url>" -f this file. Guarded so
-- it is a no-op on local Postgres (no anon/authenticated roles).

-- 1) Re-grant Data-API access to anon + authenticated (undo the lockdown).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
      EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', r);
      EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', r);
      EXECUTE format('GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO %I', r);
    END IF;
  END LOOP;
END $$;

-- 2) Disable RLS on every public table.
ALTER TABLE "issuers"             DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_currencies"   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "categories"          DISABLE ROW LEVEL SECURITY;
ALTER TABLE "source_documents"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "source_chunks"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "cards"               DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_rules"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "welcome_offers"      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_runs"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "source_claims"       DISABLE ROW LEVEL SECURITY;
ALTER TABLE "cross_check_groups"  DISABLE ROW LEVEL SECURITY;
ALTER TABLE "review_tasks"        DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_rule_sources" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_identities"     DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reviewer_overrides"  DISABLE ROW LEVEL SECURITY;
