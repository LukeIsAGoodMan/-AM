# Roadmap: 17 Milestones, ~4 Weeks

Companion to [prd.md](./prd.md). PRD says **what** and **why**; roadmap says **in what order** and **how to know each step is done**.

## Design Principles

1. **Each milestone is one sit-down** (2–8 hours), ending with PR-able output.
2. **Highest-risk work first**: can the schema represent real cards? Answer by end of Week 1.
3. **Hard go/no-go after risky milestones**: if schema breaks, refactor now, not later.
4. **UI is last**: a working calculator + YAML pipeline beats pretty admin pages.
5. **Don't write code with no caller**: reserve interfaces, but don't implement until needed.

---

## Overview

```
Week 1: Foundation + Stress Test
  M0  Skeleton                       (0.5d)
  M1  First card end-to-end          (1d)    ← simple card runs
  M2  Category + cap                 (0.5d)
  M3  Adversarial #1: tiered rebate  (1d)    ★ Schema checkpoint
  M4  Adversarial #2: exclusion+stack(1d)    ★ Schema checkpoint

Week 2: Data Scale + Ingestion Pipeline
  M5  Calculator semantics doc       (0.5d)
  M6  YAML import + full-sync        (1.5d)
  M7  Merchant resolver stub         (0.5d)
  M8  Source text extraction         (1d)
  M9  Bulk add 5 more cards          (1.5d)  → 8–10 card coverage

Week 3: Surrounding Capabilities + First Demo
  M10 Welcome offers + campaigns     (1d)
  M11 Simulation skeleton            (0.5d)
  M12 Admin UI: cards browsing       (1d)
  M13 Admin UI: rules + sources      (1d)
  M14 Calculator test page           (1.5d)  ← main demo

Week 4: Editing + Projection + Wrap-up
  M15 Light edit forms               (1d)
  M16 Projection test page           (0.5d)
  M17 Polish + decisions log         (1d)
```

---

## Detailed Milestones

### M0 — Skeleton (0.5d)
**Ship**: Next.js + TS strict + Tailwind + Drizzle + Postgres (local Docker) + Vitest.
**Done when**: `pnpm dev` boots, `pnpm test` runs an empty test successfully.
**Why first**: don't let environment issues contaminate later debugging.

---

### M1 — First card end-to-end (1d)
**Ship**:
- First Zod schema: only `simple_percent` formula type.
- Drizzle migration: `issuers` / `reward_currencies` / `cards` / `reward_rules`.
- Manual SQL seed for 1 Citi Cash Back card ("$1 = 1.2% cashback", 1 rule).
- Naive `calculate(cardId, txn)` function.
- 3 tests: HKD 1000 → 12, HKD 500 → 6, HKD 0 → 0.

**Done when**: 3 Vitest tests pass.
**Proves**: data flow is wired; schema can hold the simplest card.
**Don't**: no YAML, no UI, no stacking yet.

---

### M2 — Category + cap (0.5d)
**Ship**:
- Add HSBC Red online bonus (4% capped at HKD 100k/year).
- Calculator adds category match + `is_online` match + single-rule cap.
- Tests: online vs offline, within cap vs over cap.

**Done when**: HSBC Red online HKD 5000 → 200, offline HKD 5000 → 8 (base 0.4%).
**Proves**: condition filtering + cap work.

---

### M3 — Adversarial #1: Tiered Rebate ★ CHECKPOINT (1d)

**Ship**: Model HSBC EveryMile (monthly tier, requires registration).
**Test fixtures**:
- Cumulative HKD 4000 in month → all at base.
- Cumulative HKD 8000 in month → first 4000 base, next 4000 high tier.
- Across months: last month 6000, this month 2000 → this month at base (tier reset).

**Done when**:
- `tiered_percent` + `accrual_period: month` work.
- `requires_registration` gating works.
- Cross-month reset test passes.

**★ Go/No-Go**:
- If `custom_note` is used → **stop, redesign RewardFormula union**.
- If cap accrual keys feel chaotic → **fix now, don't move to M4**.

---

### M4 — Adversarial #2: Exclusion + Stacking ★ CHECKPOINT (1d)

**Ship**: Model Citi PremierMiles (overseas FX bonus + tax excludes bonus only).
**Test fixtures**:
- Local HKD 1000 dining → base only.
- Overseas USD 5000 → base + FX bonus stack.
- Tax HKD 10000 → base still earns, bonus excluded (PRD §8.4 core case).

**Done when**:
- `applies_to: [category_bonus, online_bonus]` exclusion scope works.
- `stacking_policy: additive` works.
- Tax case passes with correct number.

**★ Go/No-Go**:
- If tax case wrong → schema still off, **stay on M3/M4, don't push forward**.
- If calculator code > 300 lines → wrong abstraction, refactor.

---

### M5 — Calculator semantics doc (0.5d)
**Ship**:
- `docs/calculator-semantics.md` capturing what M1–M4 actually do (pseudocode).
- Audit: anywhere code disagrees with doc, fix the code.
- Align with PRD §8 8-step algorithm.

**Done when**: doc written, code matches doc exactly.
**Why now**: memory is fresh, code is small. Later you won't make time.

---

### M6 — YAML import + full-sync (1.5d)

**Ship**:
- `data/cards/*.yaml` format finalized.
- `pnpm validate:data` (Zod + reference integrity).
- `pnpm import:data` (upsert + missing→archived + supersedes logic).
- Migrate M1–M4's 3 cards to YAML.
- Delete the manual SQL seed.

**Done when**:
- 3 cards imported from YAML, M3/M4 fixtures still pass.
- Delete a rule from YAML → re-import → DB row becomes `archived`.
- Change economic field without `supersedes` declaration → import errors.

**Proves**: data entry pipeline is live.

---

### M7 — Merchant resolver stub (0.5d)

**Ship**:
- `MerchantResolver` interface.
- `HardcodedMerchantResolver` with ~30 common HK merchants (PARKnSHOP, Wellcome, Klook, Foodpanda, Octopus, Trip.com, HKTVmall, Apple Store HK, etc.).
- Calculator accepts `merchant_name` without `category_slug` and still computes.
- Fallback to `unknown` drops confidence to low.

**Done when**: "Klook, HKD 5000" without category → calculator still ranks.

---

### M8 — Source text extraction (1d)

**Ship**:
- Install `pdf-parse` + `cheerio`.
- On import: PDF → text; URL → fetch + readability extract → text.
- `source_documents.extracted_text` auto-populated.
- `source_chunks` table + ~500-token chunking.
- Failures set `extraction_failed=true`, do not block import.

**Done when**: one real HSBC web page + one PDF T&C have non-empty `extracted_text`.
**Why now**: URLs die, PDFs move. Capture content at ingestion. Embeddings come later.

---

### M9 — Bulk add 5 more cards (1.5d)

**Ship** these 5 cards to YAML and import:
1. DBS Black World Mastercard
2. Hang Seng MPOWER
3. SC Simply Cash Visa
4. BOC Chill
5. Amex Cathay Elite

Each: base earn + 1–2 bonus + 1 exclusion + welcome offer.

**Done when**:
- 8 cards in DB (original 3 + new 5).
- `custom_note` usage < 10% (SQL query for now; dashboard later).
- M3/M4 + new fixtures all pass.

**Don't**: don't chase ZA Card and the 10th card. 8 accurate beats 10 sloppy.

**Bonus reference**: the user's existing `HK_credit_card_master_with_best_use_case.xlsx` (74 cards across 12 issuers) can seed names/fees/networks/welcome-offer skeletons. Hand-verify rules — do not trust the spreadsheet on rule logic.

**Optional M9.5 (recommended)**: write `scripts/seed-from-xlsx.ts` to insert all 74 cards as `status='draft'` (metadata + qualitative summary + welcome offer skeleton). This makes Phase 2 start with 66 cards in the draft pool instead of zero. Cost ~2 hours, saves ~30 hours later. Do NOT promote draft → approved in MVP — those 66 are Phase 2's input pool, not MVP output.

---

### M10 — Welcome offers + campaigns (1d)

**Ship**:
- `WelcomeOfferTiers` schema (PRD §6.8).
- `welcome_offers` table + YAML fields.
- `campaigns` table + at least one card with an active campaign (e.g., HSBC Reward+ quarterly).
- Campaign rules via `rule_type=campaign_bonus + campaign_id`.

**Done when**: HSBC Red welcome offer visible in admin; one campaign in DB; calculator only applies campaign bonus when `user_context.activated_campaign_ids` includes it.

---

### M11 — Simulation skeleton (0.5d)

**Ship**:
- `SimulationEngine` interface.
- Naive impl: per month, build synthetic txn per category, call calculator, sum.
- Welcome offer adds `estimated_value_hkd`.
- One projection test: fixed profile + HSBC Red → 12-month reward.

**Done when**: `simulate({ dining: 5000, online: 3000 }, "hsbc-red", 12)` returns a number.

---

### M12 — Admin UI: cards browsing (1d)

**Ship**:
- Sidebar + topbar layout (shadcn).
- `/cards` list (TanStack Table, filter by issuer/status).
- `/cards/[slug]` detail: metadata + rules list + linked sources + welcome offer.
- Read-only first; no edit yet.

**Done when**: click HSBC Red → see all rules and sources.

---

### M13 — Admin UI: rules + sources (1d)

**Ship**:
- `/rules` list (filter by card / rule_type / category / status / is_online).
- `/rules/[id]` detail: all fields + formula payload + condition payload.
- `/sources` list.
- `/sources/[id]`: metadata + `extracted_text` preview + linked rules.

**Done when**: from a source page, you can navigate to every rule that cites it.

---

### M14 — Calculator test page (1.5d) ← main demo

**Ship** `/calculator-test`:
- Left: manual txn input OR fixture dropdown.
- Middle: card multi-select.
- Right: ranking
  - Card name + reward HKD + confidence badge.
  - Breakdown expansion: each rule's contribution.
  - Source links.
  - Caveats list.
- **"Why this lost" comparison view**: pick two cards, side-by-side rule-match table.

**Done when**: PRD §20 demo flow runs without intervention.

---

### M15 — Light edit forms (1d)

**Ship**:
- `/rules/[id]/edit` (RHF + Zod resolver).
- `/sources/[id]/edit`.
- Save → triggers same validation path as `import:data`.
- After save, `/calculator-test` immediately reflects the change.

**Done when**: change HSBC Red online rate from 4% → 3%, calculator updates live.

**Note**: edit form is an escape hatch, not the main data entry. YAML is the source of truth.

---

### M16 — Projection test page (0.5d)

**Ship** `/projection-test`:
- Spending profile input.
- Multi-select cards.
- Choose `months_ahead`.
- Display per-card projection + welcome-offer contribution breakdown.

**Done when**: can demo a "Plan Mode" prototype.

---

### M17 — Polish + decisions log (1d)

**Ship**:
- `README.md`: "how to add a card via YAML" walkthrough.
- `docs/decisions.md`: every schema decision's "why" (PRD §18's 7 + whatever else was made along the way).
- `docs/known-limits.md`: rules/cards still not representable (lucky draw, AlipayHK-binding +1%, etc.).
- `/dashboard`: `custom_note` ratio metric + counts.
- Final cleanup: delete unused fields, mark unimplemented interfaces with `// TODO: implement`.

**Done when**: a newcomer can read README and add a new card.

---

## 4 Go/No-Go Decision Points

| When | Check | If failing |
|---|---|---|
| **End of M3** | Can the tiered card avoid `custom_note`? | Redesign `RewardFormula` union. **Do not start M4.** |
| **End of M4** | Exclusion + stacking semantics clear, tax case correct | Rewrite calculator semantics. **Do not start M5.** |
| **End of M9** | 8 cards with `custom_note` < 10% | Stop at 8 cards. Don't push to 10. |
| **End of M14** | Can you demo this to a non-technical friend in 5 min? | Cut M15/M16, spend remaining time polishing M14. |

Each decision point: 30 minutes of honest review. Don't push through red lights.

---

## Suggested Week 1 Cadence

| Day | Morning | Afternoon |
|---|---|---|
| Day 1 | M0 Skeleton | M1 part 1 (schema + migration) |
| Day 2 | M1 part 2 (calculator + tests passing) | M2 |
| Day 3 | M3 part 1 (HSBC EveryMile loaded) | M3 part 2 (tier tests pass) ★ |
| Day 4 | M3 review + any schema patches | M4 part 1 |
| Day 5 | M4 part 2 ★ | M5 calculator semantics doc |

**Expected state at end of Week 1**:
- 3 real cards (1 simple + 2 adversarial) all working.
- ≥10 passing tests.
- Zero `custom_note` usage.
- High confidence in the schema.

**Red flags that mean "delay Week 2"**:
- Schema still being patched.
- Tests still failing.
- Calculator code > 500 lines.

Better to do 2 cards solidly than 3 half-built.

---

## What "Done" Looks Like (Week 4 Demo)

Per PRD §20:

```
1. Import 10 cards from YAML
2. Visit /dashboard → see 10 cards, custom_note ratio ~6%
3. /cards/hsbc-everymile → all rules, sources, welcome offer
4. Click source → extracted PDF text preview shows up
5. /calculator-test: "Klook, HKD 5000, online, 2026-06-15"
   → merchant_resolver auto-fills category = travel_ota
   → Rank: Card A (HKD 250, breakdown, source links, confidence high)
            Card B (HKD 200)
            Card C (HKD 150, flagged low confidence)
6. Same with "Some random shop XYZ" → resolver fallback, confidence low
7. /projection-test: profile of HKD 8000/mo dining + 4000/mo online + 2000/mo overseas
   → HSBC EveryMile + welcome offer
   → 12-month projection HKD ~4800 (welcome 800 + ongoing 4000)
8. Edit a rule via admin → save → re-run calculator → output updates
```

If this demo runs end-to-end without intervention, MVP is shipped. Layer 3/5 v2 / 6 v2 / 7 / 8 can start.

---

## Beyond MVP: Phase 2 — Multi-Source Extraction + Cross-Check

See [prd.md §22](./prd.md#22-phase-2-multi-source-extraction--cross-check-post-mvp) for the design. Phase 2 lifts coverage from 8–10 cards → ~25 cards without sacrificing the source-backed accuracy bar.

### Why Phase 2 (not "add 30 more YAML cards")

Hand YAML scales to ~25 cards comfortably. Reaching the ~75 card universe needs LLM-assisted extraction. But "LLM extracts → DB" alone is dangerous on financial data. So Phase 2 = **multi-source scan → per-source claims → cross-check aggregation → human review of conflicts/agreements → approved rules**.

### Design principles (added to PRD §5)

1. **Multi-source by default** — every rule anchored to ≥1 source; ideally ≥2 for high-confidence.
2. **Cross-check before approve** — agreement boosts confidence, disagreement creates a review task.
3. **LLM extracts; humans approve** — LLM never writes to `reward_rules` directly.

### Phase 2 milestones (sized for sit-down PRs like MVP)

```
P1  ✅ Migration: source_claims / extraction_runs /     (1d)
    cross_check_groups / review_tasks / reward_rule_sources
P2  ✅ Extraction prompt v1 (Claude Opus 4.7,           (1.5d)
    schema-guided, one chunk → many claims)
P3  ✅ Extraction runner: source_chunks → source_claims (1d)
P4  ✅ Cross-check aggregator + review_task auto-gen    (1.5d)
P5  ✅ /review queue page (list + filters)              (1d)
P6  ✅ /review/[task] detail (side-by-side source vs    (1.5d)
    claim, approve / reject / mark-conflict /
    edit-canonical / reopen)
P7  ✅ Auto-create reward_rule from approved claim      (1d)
    cluster + reward_rule_sources join
    (earn_rate + exclusion; cap stitched in; other
    claim_types skip cleanly per D16)
P8  ✅ Multi-source scan: fetch official + 2 competitors (1.5d)
    for one card → run extraction → produce 6-9 claims
    (P8-partial: hsbc-red. Full meaning of P8 satisfied by
    P9's 10-card bulk run that includes the same single-
    card flow at scale.)
P9  ✅ Bulk run P8 across 10 more cards                 (2d)
    → 11 cards total · 484 source_claims · 187 cross_check
    groups (58 agreed / 87 single_source / 42 conflict) ·
    104 P7-materialized reward_rules. PRD §22.10 #2 + #3
    + #4 all green. #1 still gated on draft→approved card
    promotion which is downstream of P9's per-card pipeline.
P10 Polish: extraction cost dashboard, claim provenance (1d)
    on rule detail page, archive superseded claims
```

Total: ~12–13 sit-downs ≈ 3 working weeks for one person.

### Phase 2 success criteria (mirrors PRD §22.10)

1. ≥25 cards `approved` (up from 10).
2. ≥10 more in `single_source` or `conflict` review state.
3. End-to-end extraction demo runs: open source → click Extract → claims appear in `/review` → approve → calculator output updates.
4. At least 1 cross-source conflict has been detected and resolved through the UI.
5. `/dashboard` shows extraction cost + claim review backlog.

### Tooling reservations already in MVP (so Phase 2 isn't from-scratch)

- `source_documents.extracted_text` + `source_chunks` populated from M8.
- `db/schema/extraction.ts` reserved as empty namespace.
- `reward_rules.confidence_score` semantics already match the cross-check aggregator output.
- Calculator already operates on `ResolvedRule`, so swapping in cross-check-derived rules is invisible to it.

### What is still NOT in Phase 2

- Wallet Mode / Plan Mode (Phase 3).
- Public-facing UI (Phase 3).
- Automatic re-crawl + freshness alerts (Phase 4 — when stale data starts mattering).
- Browser extension (Phase 4+).
- Bank account connection (Phase 5+).

---

## Known schema gaps (defer to Phase 2 or later)

Surfaced during MVP build. None block the M14 demo; flagging so they don't get forgotten.

### G1 — Registration / activation time window

Today's calculator gate only checks "is the rule id in `activatedRuleIds`" (boolean). Real banks scope activation to a date window: the bonus applies to txns AFTER you registered, often within a quarter/period.

**Fix shape**: extend `UserCardContext.activatedRuleIds` from `string[]` → `{ ruleId: string; activatedAt: string }[]`. Calculator's step 3b compares `txn.transactionDate >= activatedAt`. Same for campaigns. Schema unchanged; user-context only.

**When**: lands with Phase 2's `user_*` tables (Layer 7), since the activation event has a timestamp by then anyway.

### G2 — Cap basis = `reward` (max HKD X reward per period)

`apply-cap.ts` throws on `cap.basis ∈ { 'reward', 'transaction_count' }` today. Real HSBC Reward+ and several enJoy tiers cap REWARD (e.g. "max HKD 800 RewardCash / month"), not spending. Today we approximate by setting an equivalent spending cap, which over-credits in some edge cases.

**Fix shape**: add the `reward` branch to `applyRuleWithCap`:
- Convert `cap.rewardAmount` → reward-units cap (divide by `rewardCurrencyValueHkd` if cap is denominated in HKD)
- Compute applied formula's would-be reward; cap it; back-derive the eligible portion for the period accumulator

**When**: when a real card under maintenance forces it (probably during Phase 2 source extraction — reviewer hits a "max HKD 500/mo" T&C and won't accept the spending-cap approximation).

### G3 — Multi-rule shared caps (`cap_shared_group`)

Schema already has `cap.usageKey` so this is partly wired — different rules can name the same key and the calculator naturally sees one shared counter. What's missing:
- `cap_shared_group` column to make the grouping explicit and queryable
- A YAML-level convention ("these 3 category bonus rules share a HKD 60k spending cap")
- Test fixtures (HSBC has had this pattern for tiered campaigns)

**When**: as soon as a card with this pattern joins the approved set (likely during M9-equivalent batch in Phase 2).

### G4 — `first_n_transactions_bonus` formula variant

Listed in PRD §7 and reserved in Zod's `RewardFormulaTypes` const, but `applyFormula` doesn't switch on it. Used by Citi Octopus and several "first 3 transactions per month" promos.

**Fix shape**: add the `case "first_n_transactions_bonus":` arm; gate against a per-month transaction counter the simulator/user-context advances. Requires the same period-token scoping the cap rollover uses.

**When**: when Citi Octopus or similar joins the approved set.

---

## Phase 3+ teaser (not designed yet)

- **Phase 3**: Public Wallet Mode beta. User submits owned cards + a transaction → ranking. Captures `merchant_datapoints` from real users.
- **Phase 4**: Plan Mode (spending profile → card recommendations). Re-crawl scheduler for freshness.
- **Phase 5**: Agent orchestration (LLM calls calculator + RAG + simulation as tools).

Designs land when MVP + Phase 2 are real, not before.
