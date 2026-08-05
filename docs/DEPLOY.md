# Deploying the admin app to Vercel

The app is a standard Next.js 15 App Router app. Vercel hosts the Next.js
part; it needs a **hosted Postgres** (the local Docker DB won't work from
Vercel). Viewing is open; **editing requires a password** (see step 3).

Division of labour: the code is deploy-ready. You do the two account-gated
steps (create a DB, import the repo into Vercel). Paste me the DB connection
string and I'll run the schema migration + copy the real data.

---

## Step 1 — Create a hosted Postgres (you)

Recommended: **Neon** (neon.tech, free tier) or **Supabase**. After creating a
project, copy the **pooled** connection string:

- Neon: use the host ending in `-pooler` (e.g.
  `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`).
- Supabase: use the **Connection pooling** string (port `6543`,
  `?pgbouncer=true`).

Why pooled: Vercel runs each request in a serverless function; a pooled
endpoint keeps Postgres connection count bounded. The app's `pg` client works
as-is with a pooled URL — no code change.

## Step 2 — Migrate schema + copy the real data

**Option A (I do it):** paste me the pooled connection string and I run:

```bash
# schema (0000..0016) — drizzle migrate against the hosted DB
DATABASE_URL="<hosted-pooled-url>" pnpm db:migrate

# copy ALL current data (74 cards, rules, claims, cross-check groups,
# the P18 canary results) from the local Docker DB into the hosted one:
docker exec am-postgres pg_dump -U am -d am --no-owner --no-acl --clean --if-exists \
  | psql "<hosted-DIRECT-url>"      # use the NON-pooled url for the bulk restore
```

Notes:
- Use the **direct** (non-pooler) URL for the `pg_dump | psql` bulk load;
  poolers can choke on the transaction volume. Use the pooled URL for the app.
- `pg_dump` includes `CREATE TABLE` + data + the `drizzle.__drizzle_migrations`
  table, so `db:migrate` in the first line is optional if you restore a full
  dump — but running it first is harmless and gives a clean schema baseline.
- No extensions required (pgvector is reserved but not yet used).

**Option B (you do it):** run the two commands above yourself.

## Step 3 — Import the repo into Vercel (you)

1. Vercel → **Add New… → Project** → import GitHub repo
   `LukeIsAGoodMan/-AM`. Vercel auto-detects Next.js + pnpm (from
   `pnpm-lock.yaml`). Build command `next build`, output auto. No `vercel.json`
   needed.
2. **Environment variables** (Production + Preview):
   - `DATABASE_URL` = the **pooled** hosted connection string (step 1).
   - `ADMIN_EDIT_PASSWORD` = the shared password PMs type to edit.
   - `EDIT_COOKIE_SECRET` = any long random string (e.g. `openssl rand -hex 32`).
     **Required in prod** — the edit gate fails CLOSED (stays locked) if this and
     `ADMIN_EDIT_PASSWORD` are both unset, rather than using a guessable fallback.
3. **Deploy.** Every push to `main` redeploys automatically.

---

## After deploy

- **Viewing** (dashboard, /rules, /review, /cards, /calculator-test) is open —
  share the URL with PMs.
- **Editing** (approve/reject a review task, resolve a conflict, edit a rule
  or source) requires clicking **Unlock edit** (top-right) and entering
  `ADMIN_EDIT_PASSWORD`. The gate is enforced server-side: every mutating
  action refuses without it, so editing is impossible even by calling the
  action directly.
- **Conflict resolution**: on any review task detail (`/review/[taskId]`), the
  "Resolve conflict" card shows each source's version — pick one or type your
  own value, then *Set as canonical* or *Apply & materialize → rule*.

## Migrations on future deploys

`next build` does NOT run DB migrations. When you add a migration
(`drizzle/migrations/00NN_*.sql`), apply it to the hosted DB once:

```bash
DATABASE_URL="<hosted-pooled-url>" pnpm db:migrate
```

(or add it as a Vercel deploy hook / one-off command).

### PENDING — Stage 1B `0015` + rule-identity backfill (on local only, NOT yet on Supabase)

`0015_rule_identities.sql` and its one-time identity backfill are applied on the **local** DB
only, so local and Supabase currently diverge. To level the hosted DB (both steps are idempotent;
the backfill skips any rule that already has an identity, and is reversible via
`DELETE FROM rule_identities;`):

```bash
# 1) schema — prefer the SESSION pooler :5432 (or the direct host) for DDL
DATABASE_URL="<hosted-session-pooler-url>" pnpm db:migrate

# 2) DRY-RUN the backfill (writes nothing — prints the 1:1 plan + any scope-key collisions)
DATABASE_URL="<hosted-pooled-url>" pnpm exec tsx scripts/backfill-rule-identities.ts

# 3) WRITE (needs both gates; ~213 rules today, so 250 is head-room)
DATABASE_URL="<hosted-pooled-url>" pnpm exec tsx scripts/backfill-rule-identities.ts \
  --enable-write --max-write-count 250
```

**Option A (I do it):** paste me the hosted connection string (or drop it into
`.env.production.local`, git-ignored) and I run the three commands.
**Option B (you do it):** run them yourself, or via `.env.production.local` +
`pnpm backfill:identities:prod` (dry-run) then `pnpm backfill:identities:prod --enable-write --max-write-count 250`.

Verify after: `SELECT count(*) FROM rule_identities;` should equal `SELECT count(*) FROM reward_rules;`.

### PENDING — `0016` RLS + least-privilege lockdown (fixes Supabase "RLS Disabled in Public")

Enables RLS on all 16 public tables and revokes the Data-API roles (`anon`,
`authenticated`), so the anon/publishable key can no longer read/write these
tables directly. **Zero app impact**: the app connects as the privileged owner
role, which bypasses RLS (verified locally — `pnpm diagnose` green with RLS on).
`0016` runs automatically after `0015` in the same `pnpm db:migrate`.

**Before applying — snapshot current grants (so rollback can be exact):**

```bash
psql "<hosted-url>" -Atc "SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee IN ('anon','authenticated')
  ORDER BY 1,2,3" > grants-before-0016.txt
```

**Apply** (bundled with `0015` — use the SESSION pooler `:5432` for DDL):

```bash
DATABASE_URL="<hosted-session-pooler-url>" pnpm db:migrate
```

**Verify** (all should be true):

```sql
-- every public table has RLS on:
SELECT count(*) FILTER (WHERE rowsecurity) AS rls_on, count(*) FROM pg_tables WHERE schemaname='public';
-- the stray policy is gone:
SELECT * FROM pg_policies WHERE tablename='reward_rules';           -- expect 0 rows
-- anon/authenticated have no table privileges:
SELECT count(*) FROM information_schema.role_table_grants
  WHERE table_schema='public' AND grantee IN ('anon','authenticated');  -- expect 0
```

Then re-check the app (`https://am-wrxk.vercel.app`) still renders + edits, and
re-run the Supabase Security Advisor — the "RLS Disabled in Public" findings
should clear.

**Rollback** (only if a legitimate Data-API consumer breaks — restores the
insecure baseline): `psql "<hosted-url>" -f drizzle/migrations/rollback/0016_rollback.sql`.

⚠️ Confirm there is **no external Data-API consumer** (a separate tool, Edge
Function, or webhook reading via the anon key) before applying — the app itself
has none, but the lockdown blocks any that exist.

## Gotchas

- **Use the POOLER host, not the direct `db.<ref>.supabase.co` host.** New
  Supabase projects make the direct host **IPv6-only**, so IPv4-only clients
  (Docker, many CI/serverless) get "Network is unreachable". The Supavisor
  pooler host (`aws-<n>-<region>.pooler.supabase.com`, username
  `postgres.<project-ref>`) is IPv4. Confirmed working for this project:
  `aws-1-us-west-2.pooler.supabase.com` — transaction pooler `:6543`
  (Vercel `DATABASE_URL`), session pooler `:5432` (used for the bulk data
  copy). Verified: `pnpm tsx scripts/diagnose.ts` passes against the 6543
  pooler.
- The repo name has a leading dash (`-AM`). This is cosmetic — Vercel builds
  the repo contents, not by package name.
- If a page errors with "DATABASE_URL is not set", the env var wasn't set on
  Vercel for that environment (Production vs Preview are separate).
- Serverless connection limits: if you see "too many connections", confirm
  `DATABASE_URL` is the **pooled** endpoint.
