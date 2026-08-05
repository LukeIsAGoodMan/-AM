// scripts/db-preflight.ts — READ-ONLY preflight before applying prod migrations.
// Confirms: we can reach the DB, it is the RIGHT DB (not local), which role we
// are, and the current RLS / policy / grant state (also serves as the pre-0016
// grant snapshot). Writes NOTHING. Run:
//   pnpm exec tsx --env-file=.env.production.local scripts/db-preflight.ts
import { Pool } from "pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("✗ DATABASE_URL not set (need --env-file=.env.production.local)")
  process.exit(1)
}
// Safety: refuse to run the 'prod preflight' against a local DB by accident.
if (/localhost|127\.0\.0\.1/.test(url)) {
  console.error("✗ DATABASE_URL points at localhost — this preflight is for the hosted DB. Aborting.")
  process.exit(1)
}

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000 })

async function q(label: string, text: string) {
  const r = await pool.query(text)
  console.log(`\n── ${label} ──`)
  console.table(r.rows)
}

async function main() {
  await q(
    "target (confirm it's Supabase, and which role)",
    `select current_database() as db, current_user as usr,
            split_part(version(),' on ',1) as pg`,
  )
  await q(
    "public tables + RLS state (expect total=16, rls_on=16)",
    `select count(*) as total, count(*) filter (where rowsecurity) as rls_on
       from pg_tables where schemaname='public'`,
  )
  await q(
    "0015 applied? (both should be non-null)",
    `select to_regclass('public.rule_identities') as rule_identities,
            to_regclass('public.reviewer_overrides') as reviewer_overrides`,
  )
  await q(
    "backfill: rule_identities count should EQUAL reward_rules count",
    `select (select count(*) from reward_rules) as reward_rules,
            (select count(*) from rule_identities) as rule_identities,
            (select count(*) from rule_identities where status='legacy_unreconciled') as legacy_unrec`,
  )
  await q(
    "migrations recorded (expect 17: 0000..0016)",
    `select count(*) as applied from drizzle.__drizzle_migrations`,
  )
  await q(
    "stray policy on reward_rules (expect 0 rows)",
    `select policyname from pg_policies where tablename='reward_rules'`,
  )
  await q(
    "anon/authenticated grants on public (expect EMPTY = revoke worked)",
    `select grantee, count(*) as grants
       from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated')
       group by grantee`,
  )
  console.log("\n✓ verification complete — nothing was written.")
}

main()
  .catch((e) => {
    console.error("\n✗ preflight failed:", e.message)
    process.exit(1)
  })
  .finally(() => pool.end())
