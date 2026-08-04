<!-- Long-lived working agreement for Claude Code. Static rules only.
     Dynamic per-session state lives in docs/claude/CURRENT.md — do NOT put it here.
     This file is re-injected automatically after /compact; keep it under ~200 lines. -->

# Ask Mike (`-AM`) — Working Agreement for Claude Code

Internal admin + foundation layer for a future HK credit-card rewards Q&A product.
Scope today = **data model + deterministic calculator + admin UI + a multi-source
extraction/cross-check pipeline**. The chatbot is Phase 4+ and does not exist yet.

Stack: Next.js 15 (App Router) · TypeScript strict + `noUncheckedIndexedAccess` ·
Drizzle ORM + Postgres 16 · Vitest + Playwright · Zod · **pnpm**. Folder name has a
leading dash — always quote paths in shell (`cd "/Users/hq/dev/claudecode/-AM"`).

## Information credibility — trust in this order

1. **`docs/claude/CURRENT.md`** — where the project is *right now* (the only dynamic state file).
2. **Live code + DB** via `pnpm diagnose` — ground truth for calculator behaviour.
3. **`docs/decisions.md`** (D1–D29) — *why* each schema/architecture choice was made. Do
   not reverse a decision without appending a new D-entry that cites the old one.
4. **`docs/calculator-semantics.md`** — operational spec `calculate()` must match.
5. **`docs/stage-1a-spec.md`** — current extraction Stage 1A/1B scope + blocking rules (§12).
6. **`docs/prd.md`** — product scope (large; read targeted sections, never in full).
7. **`git log --oneline`** — one well-described commit per milestone.
8. ⚠️ **`docs/roadmap.md` is a HISTORICAL PLAN, not live status** — the milestone body covers MVP
   `M0–M17` + Phase-2 `P1–P12`. It now carries a status banner + a "Phase 2.5 — P13–P18" summary
   (Stage 1A/1B), but it is still original intent, never the current-status source — use `CURRENT.md`.

## Before you start any task

Run **`/bootstrap <bounded work package>`**. It reads this file + `CURRENT.md`, pulls only
the task-relevant spec + decisions, checks `git status`/branch/recent commits, verifies the
handoff against the repo, and prints a short session contract before editing. Do **not**
re-audit the whole repo each session — `CURRENT.md` + `/bootstrap` are the recovery path.

## Session scope

One bounded deliverable per session (one module, one related bug cluster, one module's
tests, one investigation, one review). Do **not** mix broad repo investigation, product
implementation, long log analysis, and architecture research in the same main session —
split them across sessions and hand off between.

## Context budget (guidance, not enforcement)

- **< ~55%** — work normally.
- **~55–70%** — stop unbounded exploration; finish the current small goal.
- **~70–80%** — run **`/handoff`** and prepare to switch sessions.
- **> ~80%** — do not start a new implementation task.

Don't rely on last-moment auto-compact to save detail, and don't summarize-the-summary
repeatedly. `CLAUDE.md` is re-injected after `/compact`; `CURRENT.md` is re-injected by the
`SessionStart` hook — conversation-only detail is what gets lost, so write it down first.

## Search & subagents

Prefer targeted search (symbol, path, exact keyword) over broad reads. For wide sweeps use
the **Explore** subagent and bring back only the **summary**. Analyse large test/log output
in a subagent or with a targeted tool. Keep only conclusions, relevant files, root cause,
decisions, and next steps in the main context — never paste full search dumps or repeated
logs into `CURRENT.md`.

## Commands (real — from `package.json` / `README.md`)

Prereqs: Node 22+, pnpm, and Postgres on `:5432` (`docker compose up -d`) or a `DATABASE_URL`
in `.env.local`.

| Purpose | Command |
|---|---|
| Install | `pnpm install` |
| Dev server (`:3000`) | `pnpm dev` |
| Prod build / serve | `pnpm build` / `pnpm start` |
| Unit tests (Vitest) | `pnpm test` (README baseline was 87/87; counts drift — never assert a number you didn't run) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Lint | `pnpm lint` (`next lint`) |
| Validate YAML | `pnpm validate:data` |
| Seed / full-sync DB from `data/` | `pnpm import:data` (alias `pnpm db:seed`) |
| Migrations | `pnpm db:migrate` · generate `pnpm db:generate` · browse `pnpm db:studio` |
| **Canonical E2E health check** | `pnpm diagnose` (live DB → calculator → 7 scenarios, pass/fail) |
| Admin UI probe | `pnpm verify:ui` (Playwright — needs `pnpm dev` already running) |

There is **no formatter configured** (no Prettier) — do not invent a `format` command.
Extraction-pipeline scripts (`p2`/`p3`/`p4`/`p7`, `materialize-canary`) are **gated and
expensive** — see `.claude/rules/extraction-pipeline.md` before touching them.

## Implementation constraints

- **`data/` YAML is the source of truth.** Changing an economic field on an `approved` rule
  requires a new slug + `supersedesSlug`; `pnpm import:data` refuses otherwise. See
  `.claude/rules/data-yaml.md`.
- **Migrations are append-only.** Never edit an applied `drizzle/migrations/00NN_*.sql`;
  add a new one. See `.claude/rules/database.md`.
- **LLM extracts; humans approve.** An LLM never writes to `reward_rules` directly — claims
  flow through cross-check → review → materialize. See `.claude/rules/extraction-pipeline.md`.
- **Do not modify product code, tests, schema, or business config unless the work package
  says so.** No new dependencies without being asked.
- **Git:** don't `commit`/`push`/`reset`/`checkout`/`clean` unless the user asks. One commit
  per milestone; for a load-bearing schema/architecture change, append a decision to
  `docs/decisions.md` in the same commit (see its "How to add a decision").

## Architecture invariants (do not re-derive)

- **`calculate()` is pure + synchronous.** The merchant resolver is async — the *caller*
  awaits it and passes `categorySlug` + `categoryResolutionConfidence` on the
  `TransactionContext`. Never make the calculator async to inline the resolver.
- **`ResolvedRule` is the seam** between schema and calculator (PRD §8.5) — schema can evolve
  without touching `calculate()`.
- **Cap accrual is the caller's responsibility.** The calculator reads `capUsage[...]` keys;
  the simulator scopes them by period at boundaries.

## Testing & verification

- `pnpm diagnose` is the canonical end-to-end check; DB-touching tests + diagnose need a live
  Postgres. `pnpm verify:ui` needs the dev server up.
- **Never report a test, `diagnose`, or `verify:ui` result you did not run and observe this
  session.** If you didn't run it, say so. Distinguish *verified fact* from *assumption*.

## Compact & handoff

`docs/claude/CURRENT.md` is the single cross-session state file. When context nears the
budget or the work package is done, run **`/handoff`**: it re-checks git, decides what is
truly done and truly tested, updates `CURRENT.md`, and prints the exact next
`/bootstrap <…>` command. Handoff must not modify product code or overstate test results.
