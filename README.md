# Ask Mike — HK Card Rewards

Internal admin + foundation layer for a future Hong Kong credit card rewards Q&A product. MVP scope is the **data model + deterministic calculator + admin UI**; the chatbot itself is Phase 4+.

- [docs/prd.md](./docs/prd.md) — product scope, architecture, schema (22 sections)
- [docs/roadmap.md](./docs/roadmap.md) — 17-milestone build plan
- [docs/calculator-semantics.md](./docs/calculator-semantics.md) — operational spec for `calculate()` (load-bearing)
- [docs/decisions.md](./docs/decisions.md) — *why* each schema decision was made
- [docs/known-limits.md](./docs/known-limits.md) — what the calculator deliberately can't represent yet

## Stack

- Next.js 15 (App Router) + TypeScript strict + `noUncheckedIndexedAccess`
- Drizzle ORM + Postgres 16 (local Docker)
- Tailwind v4
- Zod for runtime validation (YAML import, edit forms, server actions)
- Vitest unit tests + Playwright probe (`pnpm verify:ui`)

## Prerequisites

- Node 22+
- pnpm (`npm i -g pnpm`)
- Docker Desktop

## First-time setup

```bash
pnpm install
docker compose up -d              # start Postgres on :5432
cp .env.example .env.local        # already done if you cloned this repo
pnpm db:migrate                   # apply migrations
pnpm import:data                  # seed everything from data/ YAML
pnpm test                         # expect 87/87
pnpm diagnose                     # expect "✓ All expectations met."
pnpm dev                          # http://localhost:3000
```

If something looks off, `pnpm diagnose` is the canonical end-to-end check — it loads every approved rule from the live DB and runs the calculator across 7 canonical scenarios.

## What the admin pages do

| Path | What you can do |
|---|---|
| `/dashboard` | Catalog counts + `custom_note` ratio (schema-health metric) + recent activity |
| `/cards` | Browse all 74 cards (11 active + 63 draft). Detail page links to rules, sources, welcome offers |
| `/rules` | Filterable rule list. Detail page shows the formula payload + provenance chain |
| `/sources` | Source documents with extracted text preview |
| `/calculator-test` | **Main demo.** Enter a txn → ranked rewards per card with breakdown + caveats + side-by-side compare |
| `/projection-test` | **Plan mode.** Spending profile → per-card N-month projection with welcome-offer contribution |
| `/rules/[slug]/edit`, `/sources/[slug]/edit` | Light edit forms (escape hatch — see warning below) |

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` / `pnpm start` | Production build + serve |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm validate:data` | Zod-validate every YAML file in `data/` |
| `pnpm import:data` | Full-sync `data/` → DB (insert/update/archive + refusal on approved-rule economic changes) |
| `pnpm extract:sources` | Re-fetch + extract text for source documents missing it |
| `pnpm diagnose` | End-to-end: live DB → calculator → 7 canonical scenarios with pass/fail report |
| `pnpm verify:ui` | Playwright headless probe of the admin UI (run after `pnpm dev` is up) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle migrations + browser |

## Project structure

```
src/
  app/(admin)/         # Next.js routes — server components fetch via Drizzle,
                       # client components drive interactivity. force-dynamic
                       # on every page so YAML edits flow through immediately.
  components/
    admin/             # sidebar + admin-only helpers
    ui/                # hand-written shadcn-style primitives (Badge, Card,
                       # PageHeader) — no shadcn CLI, no extra deps
  db/
    client.ts          # Drizzle + pg pool
    schema/
      catalog.ts       # Layer 2 — issuers / cards / rules / sources / etc.
      extraction.ts    # Phase 2 reserved namespace (empty)
      user.ts          # Layer 7 reserved (empty)
  lib/
    actions/           # Next.js server actions (edit forms) — mirror syncer's
                       # refusal logic for economic-field changes on approved rules
    calculator/        # Pure functions. calculate.ts is the entry; explain.ts
                       # + caveats.ts wrap it for the test page
    import/            # YAML loader, Zod schemas, syncer (full-sync upsert)
    queries/           # All Drizzle reads. Pages stay declarative; complex
                       # joins live here
    resolver/          # Merchant → category resolver (hardcoded ~35 HK merchants
                       # today; DB-backed in Phase 2)
    schemas/           # Runtime Zod schemas shared by import + calculator
    simulation/        # Naive projection engine (M11/M16)

data/                  # SOURCE OF TRUTH — Yaml that pnpm import:data syncs
  issuers/             # one yaml per issuer
  reward_currencies/   # canonical currency definitions
  categories/          # base.yaml — taxonomy
  cards/               # one yaml per card (rules + sources + welcome offers
                       # embedded under the card's slug)
  campaigns/           # standalone campaign definitions

scripts/
  diagnose.ts          # canonical end-to-end check
  inspect-calc-page.ts # Playwright probe (pnpm verify:ui)
  import-data.ts       # entry for pnpm import:data
  validate-data.ts     # entry for pnpm validate:data
  extract-sources.ts   # entry for pnpm extract:sources
  seed-from-xlsx.ts    # one-off: pull 74 cards from iCloud xlsx into draft YAMLs

docs/                  # PRD, roadmap, calculator semantics, decisions, limits
drizzle/migrations/    # generated migration SQL
docker-compose.yml     # Postgres 16
```

## How to add a card

YAML in `data/` is the source of truth. The shape is locked by Zod schemas in `src/lib/import/schemas.ts` (`CardFileSchema` + nested `RuleEntrySchema` + `SourceEntrySchema`). The walkthrough below adds a hypothetical "Demo Bank Cashback Card."

### 1. Create the card YAML

`data/cards/demo-bank-cashback.yaml`:

```yaml
issuerSlug: demo-bank          # must match data/issuers/demo-bank.yaml

card:
  slug: demo-bank-cashback
  productFamily: Demo Bank Cashback
  cardNameEn: Demo Bank Cashback Card
  cardNameZh: Demo Bank 現金回贈卡
  network: Visa
  cardLevel: classic
  annualFeeHkd: 0
  status: active                # draft until rules are sourced
  officialUrl: https://demobank.example/cashback
  notes: |
    Walkthrough example for the M17 README.

sources:
  - slug: demo-bank-cashback-official-page
    sourceType: official_page
    sourcePriority: 2           # 1=highest. Bands: §6.10
    title: Demo Bank Cashback — official page
    url: https://demobank.example/cashback
    language: en
    status: active

rules:
  - slug: demo-bank-cashback__base_earn
    ruleName: Base earn 0.5%
    ruleType: base_earn
    status: approved            # ← MUST cite a source
    rewardFormula:
      type: simple_percent
      rate: 0.005
    rewardCurrencySlug: hkd_cashback
    sourceSlug: demo-bank-cashback-official-page
    confidenceScore: 0.9
    notes: ""

  - slug: demo-bank-cashback__online_bonus
    ruleName: Online local 3% bonus (capped HKD 60k/year)
    ruleType: online_bonus
    status: approved
    rewardFormula:
      type: simple_percent
      rate: 0.03
    rewardCurrencySlug: hkd_cashback
    isOnline: true
    cap:
      amountHkd: 60000
      period: year
      basis: spending
    sourceSlug: demo-bank-cashback-official-page
    confidenceScore: 0.85
    notes: ""
```

### 2. Create the issuer YAML if needed

`data/issuers/demo-bank.yaml`:

```yaml
slug: demo-bank
nameEn: Demo Bank
nameZh: 演示銀行
websiteUrl: https://demobank.example
countryRegion: HK
```

### 3. Validate, import, verify

```bash
pnpm validate:data              # Zod + cross-reference check (fail fast)
pnpm import:data                # writes to DB
pnpm diagnose                   # confirm calculator still passes canonical scenarios
pnpm dev                        # visit /cards/demo-bank-cashback to see it
```

### 4. Test it in the calculator

Go to `/calculator-test`, enter a transaction (e.g. amount=2000, isOnline=true, region=HK), select the new card → it should appear in the ranking with the expected reward.

### Common gotchas

- **Approved rule without a source** → DB CHECK constraint + Zod refuse. Set `status: draft` while iterating.
- **Economic field changed on an approved rule** → syncer refuses with a list of changed fields. To change a rate (or any of: `ruleType`, `rewardFormulaPayload`, conditions, cap, stacking, campaign, dates), either demote to `draft` first, or **rename the slug** (`...__base_earn__v2`) and set `supersedesSlug: <old-slug>` so the audit trail is preserved.
- **Cross-reference missing** → e.g. `rewardCurrencySlug: hkd_cashback` requires `data/reward_currencies/hkd_cashback.yaml` to exist. `pnpm validate:data` catches this.
- **Selected-category card** (Hang Seng enJoy style) → set `requiresSelectedCategory: true` on the category-bonus rule. Calculator gates it via `selectedCategorySlugs` on the user context.
- **Campaign rule** → create `data/campaigns/<slug>.yaml`, then set `campaignSlug: <slug>` on the rule. Calculator gates via `activatedCampaignIds`.
- **Welcome offer** without a priced `estimatedValueHkd` → won't show up in `/projection-test` because the simulator can't price it. Fill it in (even rough) so plan-mode demos work.

See `data/cards/hsbc-red.yaml` for a card exercising every gnarly feature (online + overseas bonuses, exclusions, welcome offer, campaign).

## Conventions

- **One commit per milestone**, structured commit messages explaining *why*. `git log --oneline` is the project's history.
- Annual fees use the format `$X / $X` with spaces.
- Slugs: `<issuer-slug>-<card-name-slugified>`. Rule slugs: `<card-slug>__<rule_purpose>`.
- `ECONOMIC_RULE_FIELDS` (in `src/lib/import/syncer.ts` and mirrored in `src/lib/actions/edit-rule.ts`) defines what triggers refuse-on-approved. Keep them in sync if you add a calculator-observed field.
- New schema field? Update [calculator-semantics.md](./docs/calculator-semantics.md) and add a [decisions.md](./docs/decisions.md) entry in the same commit.

## Current state

- 11 active cards (hand-curated) + 63 draft cards (xlsx seed → Phase 2 input pool)
- 34 approved rules, 1 active campaign, 1 priced welcome offer
- `custom_note` ratio: 0%
- 87 vitest tests passing, 6/6 verify:ui assertions green

MVP demo (PRD §20) runs end-to-end. Phase 2 (multi-source extraction + cross-check, see [docs/prd.md §22](./docs/prd.md#22-phase-2-multi-source-extraction--cross-check-post-mvp)) lifts the active set from ~10 to ~25 cards.
