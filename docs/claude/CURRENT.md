# CURRENT — cross-session state

The single dynamic state file for Claude Code sessions. Keep it short: only what the **next**
session needs. Past detail lives in git history + `docs/decisions.md`, not here.
Legend: **[FACT]** = verified from repo/live this session · **[ASSUMPTION]** = inferred, unconfirmed ·
**[UNRESOLVED]** = open question needing an answer.

- **Last updated:** 2026-07-29 — **Stage 1B CORE implemented** (rule_identities + reviewer_overrides + deterministic legacy backfill) on the LOCAL DB. ⚠️ **UNCOMMITTED**, and NOT applied to Supabase. Prior work session: 2026-07-28 (P18 Stage 1A + Vercel deploy EXECUTED + admin auth/conflict-picker)
- **Branch:** `main` · **Working tree:** clean except untracked cross-session scaffolding
  (`.claude/`, `CLAUDE.md`, `docs/claude/`) — no uncommitted product code **[FACT]**
- **HEAD:** `c28125b docs(deploy): note Supabase pooler host (IPv4) vs IPv6-only direct host` **[FACT]**
- All product commits through `c28125b` are pushed to GitHub `LukeIsAGoodMan/-AM`. Pushed via the
  **SSH URL** (`git@github.com:…`) because `origin` is HTTPS and can't auth in-sandbox — so the
  local `origin/main` **tracking ref is stale**; GitHub `main` = `c28125b`. **[FACT]**

## Current phase

**Stage 1A is complete, committed, deployed live. Stage 1B CORE is implemented THIS session on the
LOCAL DB but NOT yet committed and NOT applied to Supabase.** Owner approved Stage 1B (2026-07-29);
approval covers **Stage 1B only** (Stage 2/3 stay gated — see Blockers/gates). Delivered: migration
`0015_rule_identities.sql` (+ tables `rule_identities`, `reviewer_overrides`), pure identity logic +
a gated backfill (see `docs/decisions.md` **D30**). `docs/roadmap.md` now carries a status banner +
a "Phase 2.5 — P13–P18" summary (added 2026-08) but is still historical intent, NOT live status —
this file is the source of truth; also see `docs/decisions.md` D24–D30 + `docs/stage-1a-spec.md §6`. **[FACT]**

## Stage 1B core — delivered this session (UNCOMMITTED · LOCAL only) **[FACT]**

- **Schema/migration** `drizzle/migrations/0015_rule_identities.sql` (hand-authored + journal idx 15,
  matching how `0012`–`0014` were done — the drizzle meta snapshot is stale since `0011`, so
  `pnpm db:generate` is unusable without reconciling that drift; do NOT run it). Two additive tables
  in `src/db/schema/extraction.ts`: `rule_identities` (immutable id + card_id, `origin_rule_id`,
  deterministic `stable_scope_key`, `status` default `legacy_unreconciled`, `audit_metadata`) and
  `reviewer_overrides` (bound to `rule_identity_id + field_path + version_scope`, per-override
  `comparison_policy` — no universal 5%, `baseline_value` for future stale detection). No
  `reward_rules` FK (D11 direction preserved — binding owned via `origin_rule_id`).
- **Pure logic** `src/lib/extraction/rule-identity.ts` (`computeStableScopeKey`, `planLegacyBackfill`)
  + 13 unit tests. **Gated script** `scripts/backfill-rule-identities.ts` (`pnpm backfill:identities`;
  dry-run default; write needs `--enable-write` + `--max-write-count N`).
- **Backfill APPLIED to LOCAL DB**: 213 reward_rules → 213 `legacy_unreconciled` identities, strict
  1:1 (0 orphans, 0 rules without identity), re-run is a no-op. 41 scope-key collisions surfaced for
  later reviewer reconciliation — expected (category is excluded from identity per §6A), **never
  auto-merged** (§6C). Reversible: `DELETE FROM rule_identities;`.
- **Deferred within Stage 1B (NOT built — do not assume done):** `rule_identity_events` reversible
  merge/split table (§6D), stale-override *detection* logic, the reconciliation matcher, the durable
  review workflow. `0015` + backfill are **NOT on Supabase** (separate owner-triggered deploy).

## Deployment — LIVE **[FACT]**

- **App:** https://am-wrxk.vercel.app (Vercel). Verified via WebFetch: dashboard renders real
  data (74 cards / 213 rules / 3696 claims / 395 groups / 408 backlog), no DB-error.
- **DB:** Supabase project `unvzzmxxoizdclrmpmlu`, region us-west-2. Vercel `DATABASE_URL` = the
  **transaction pooler** `aws-1-us-west-2.pooler.supabase.com:6543` (user `postgres.<ref>`, IPv4).
  The direct `db.<ref>.supabase.co` host is **IPv6-only** → unreachable from Docker/many clients;
  always use the pooler host (see `docs/DEPLOY.md`). Password is in Vercel env only (not here).
- **Data copied** local→Supabase via `pg_dump | psql` over the session pooler `:5432`. `pnpm tsx
  scripts/diagnose.ts` passed against the `:6543` pooler this session (app works end-to-end there).
- **Vercel env:** `DATABASE_URL` (6543 pooler) · `ADMIN_EDIT_PASSWORD` (owner-chosen) ·
  `EDIT_COOKIE_SECRET`.
- ⚠️ **Two DBs now DIVERGE:** local Docker (P18 canary state + verify:ui test artifacts) vs
  Supabase (what the PM sees). PM edits on the live site write to Supabase only; local dev/CLI
  write to local Docker only. Re-sync = re-run `pg_dump | psql`, or point local `.env.local` at
  the pooler. **[FACT]**

## Recently completed — prior session 2026-07-28 (git log)

- **P18 Stage 1A** (`4787581`→`4d111b4`, decisions **D24–D29**): migration `0014` publication
  states (legacy rows → `legacy_unverified`, not `auto`); formula-split aggregator + structured
  compare; inferred-category + alt-mode gates; prompt `p2-v4`; annual-fee classify + 3-tier
  authority; materializer split-in-place + gates + `is_active_for_calculator` calc filter;
  reward-currency display; `reject_claim`; canary CLI. **Canary write applied to Amex Explorer +
  Blue Cash ONLY** (reversible): Blue Cash 1.2% base active + insurance rejected/deactivated +
  HK$6=1mile inactive candidate; Explorer fee 1800→2200 provisional. **[FACT]**
- **Admin deploy-hardening** (`f04f18b`): edit-password gate (view open, edit gated — 4 mutating
  server actions refuse without the cookie) + conflict version picker on `/review/[taskId]`
  (radio-pick a source version or manual JSON input → edit_canonical / approve). **[FACT]**
- **Deploy docs** (`84a2b7a`, `c28125b`): `docs/DEPLOY.md` runbook + Supabase pooler note. **[FACT]**
- **Local Docker shut down** at that 2026-07-28 handoff: `docker compose down` (container removed,
  **volume `am_am-postgres-data` preserved**). ⚠️ Superseded: it was **restored on 2026-07-29** and
  is UP now — see Blockers/gates. **[FACT]**

## Verification status

**This session (2026-07-29), local Docker up [FACT — observed this session]:**
- `pnpm typecheck` → **clean (exit 0)**. · `pnpm test` → **231 passed (23 files)** (was 218/22;
  +13 new `rule-identity.test.ts`). · `pnpm diagnose` → ✓ All expectations met, **both before and
  after** the Stage 1B backfill (calculator unaffected).
- Backfill verified in Postgres: `reward_rules`=213, `rule_identities`=213, all `legacy_unreconciled`,
  213 distinct origins, 0 orphans, 0 rules without an identity; dry-run re-run = 0 to create.
- ⚠️ `pnpm verify:ui` NOT run this session (no UI change; needs `pnpm dev` up). Supabase NOT touched.

**Prior session (2026-07-28) [historical]:** `pnpm test` 218/22 · `verify:ui` EXIT 0 (13 tests) ·
`diagnose` green on local **and** the Supabase `:6543` pooler.

## WIP / unfinished

- **Stage 1B CORE is complete but UNCOMMITTED** (see the Stage 1B core section above). No
  half-finished code — the three named deliverables (rule_identities, reviewer_overrides, legacy
  backfill) are done + tested + applied to local. **[FACT]**
- **Deferred within Stage 1B (not started):** `rule_identity_events` merge/split table (§6D),
  stale-override detection, reconciliation matcher, durable review workflow. **[FACT]**
- Open follow-ups from Stage 1A (not blockers): the **6 canary review tasks** await human triage
  (PM can do on the live site now — confirm Explorer 2200, triage the HK$9,500 outlier, accept/reject
  the 3 miles candidates); off-taxonomy currency slugs `amex_mr` / `membership_rewards_point` skipped
  (need YAML currency add or reclassify); bounded stale old-format earn_rate groups on canary +
  hsbc-red (review-queue triage, D24/D29). **[FACT]**

## Blockers / gates

- **Stage 1B gate — CLEARED 2026-07-29.** Owner (peiyaohe2@gmail.com) explicitly approved
  *beginning extraction Stage 1B* in-session on 2026-07-29, resolving the `stage-1a-spec.md §12`
  hold ("Stop after Stage 1A and wait for approval before Stage 1B"). **Scope = Stage 1B ONLY**
  (persistent `rule_identities` + `reviewer_overrides` + deterministic legacy backfill; spec §6).
  This is **NOT** approval for **Stage 2** (welcome-offer / reward-programs) or **Stage 3**
  (authority engine / coverage discovery) — both remain approval-gated per §12 and are untouched.
  **Stage 1B CORE was implemented this session** (D30) on LOCAL only — see the Stage 1B core
  section above. **[FACT — owner stated in-session 2026-07-29]**
- **Local Docker is UP** (Docker Desktop + `docker compose up -d` restored this session; data volume
  intact). Baseline `pnpm diagnose` was green before and after the Stage 1B backfill. **[FACT]**

## Constraints to preserve (see CLAUDE.md + .claude/rules/)

`data/` YAML is source of truth (economic change on approved rule ⇒ new slug + `supersedesSlug`);
migrations append-only; LLM extracts, humans approve; canary materialization stays dry-run +
allowlisted (Amex Explorer / Blue Cash only) + `--max-write-count`; never auto-reject conflicts /
preserve outliers; provisional-publication policy (never silently `auto`); calculator pure + sync.

## Explicit non-goals (right now)

Not building the chatbot; not running full-DB materialization or the pipeline on non-canary cards;
not editing `docs/decisions.md` history; not committing the untracked `.claude/`+`CLAUDE.md`
scaffolding unless asked.

## Next step

Stage 1B **core** is implemented + verified on local, but uncommitted. Owner's pick for what's next:

1. **Commit the Stage 1B core work** (product files below + `docs/decisions.md` D30). Owner asked to
   commit only when told — this is uncommitted on purpose. Suggested message scope:
   `feat(p18-stage-1b): rule_identities + reviewer_overrides + deterministic legacy backfill (D30)`.
2. **Deploy `0015` + backfill to Supabase** *(owner-triggered — BLOCKED in-session: the Supabase
   URL/password is NOT in this env, only in Vercel)*: turnkey runbook in `docs/DEPLOY.md` → "PENDING —
   Stage 1B `0015` + rule-identity backfill". Provide the pooler URL (or drop it in git-ignored
   `.env.production.local`), then `pnpm db:migrate` (session pooler) + `pnpm backfill:identities:prod
   --enable-write --max-write-count 250`. Local and Supabase DIVERGE until then.
3. **Continue Stage 1B (deferred pieces)** — still under the 2026-07-29 approval (Stage 1B only):
   `rule_identity_events` (§6D), stale-override detection, reconciliation matcher, durable review
   workflow. Would be a fresh `/bootstrap` per piece.
4. **Track C — Review-queue triage on the live site** (no new code): PM works the 6 canary tasks.

Stage 2/3 remain approval-gated — do NOT start without a new owner go-ahead (§12).

## Minimal file set for the next session

1. `CLAUDE.md` (root) · 2. this file. Then task-scoped only:
- Stage 1B → `docs/stage-1a-spec.md` (§6, §10, §12) + `docs/decisions.md` D24–**D30** +
  `src/lib/extraction/rule-identity.ts` + `src/db/schema/extraction.ts` +
  `scripts/backfill-rule-identities.ts`.
- Deploy/DB ops → `docs/DEPLOY.md` (+ apply `0015` to Supabase).
