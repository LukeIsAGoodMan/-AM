-- Stage 1B follow-up (P18 · D31): Supabase RLS + least-privilege lockdown.
--
-- WHY: Supabase auto-exposes the `public` schema through the PostgREST Data API
-- using the anon (publishable) key. With RLS OFF, anyone with the project URL +
-- anon key can read every public table directly, bypassing the Next.js app and
-- its edit-cookie gate. The app itself does NOT use the Data API — all access is
-- Drizzle over a server-only DATABASE_URL as the privileged owner role, which
-- BYPASSES RLS. So enabling RLS with NO policies + revoking anon/authenticated
-- closes the internet-facing hole with ZERO effect on the app.
--
-- SAFE ON LOCAL: local Postgres has no `anon`/`authenticated` roles, so every
-- role-scoped statement is guarded by a pg_roles check and becomes a no-op.
-- ENABLE RLS is harmless locally because the local app connects as the table
-- owner (`am`), which also bypasses RLS.
--
-- NOT auto-applied to production. Deploy order on Supabase: apply 0015 first
-- (creates rule_identities/reviewer_overrides), then this. See docs/DEPLOY.md.
-- Rollback: drizzle/migrations/rollback/0016_rollback.sql.

-- 1) Enable RLS on every public table. No policies are added: the owner-role
--    app connection bypasses RLS; anon/authenticated get nothing (step 3).
ALTER TABLE "issuers"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_currencies"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_documents"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_chunks"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cards"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_rules"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "welcome_offers"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_runs"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_claims"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cross_check_groups"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_tasks"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reward_rule_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_identities"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviewer_overrides"  ENABLE ROW LEVEL SECURITY;

-- 2) Remove the stray hand-run policy + authenticated grant on reward_rules.
--    The app never uses the `authenticated` role; this grant was a live write
--    exposure via the Data API, and the JWT policy never matched the app flow.
DROP POLICY IF EXISTS "admins manage reward rules" ON "reward_rules";

-- 3) Strip all Data-API access from anon + authenticated, and stop future tables
--    from auto-inheriting grants. Guarded so local (no such roles) is a no-op.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
      -- Future objects created by the current (migration/owner) role: no grants.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
