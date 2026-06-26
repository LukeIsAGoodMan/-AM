# Schema Decisions Log

Records *why* each load-bearing schema / architecture decision was made. Conventions are documented in [README.md](../README.md); operational behaviour is in [calculator-semantics.md](./calculator-semantics.md). This file is the place to look when you want to know **why something is the way it is** before changing it.

PRD §18 seeded this list with 7 entries. Subsequent decisions are appended as milestones land.

---

## D1 — Welcome offers got their own schema, not a `RewardFormula` variant

**Decision**: `welcome_offers` is a sibling table to `reward_rules`, with its own `tiers` JSONB shape (PRD §6.8), its own `estimated_value_hkd` valuation field, and its own lifecycle.

**Why**: welcome offers are *one-shot*, time-bounded, with multi-tier "spend X within Y days" goals that don't compose with stacking / cap / exclusion logic the calculator runs on transaction rules. Trying to fold them into `RewardFormula` would have created a variant the calculator iterates per txn but only fires once — a misshaped abstraction.

**Knock-on**: Simulator (M11) treats welcome offers as a separate input (`includeWelcomeOffer` toggle). `/projection-test` splits "ongoing reward" from "welcome contribution" in its UI.

---

## D2 — `accrual_period` was added to tiered formulas

**Decision**: `tiered_percent` / `tiered_points` carry `accrualPeriod: 'month' | 'quarter' | 'year' | 'campaign'` as part of the formula payload, not as a separate column.

**Why**: tier boundaries reset at a period boundary that's a property of the **rule** (HSBC EveryMile resets monthly; some campaign tiers reset per-campaign), not the txn or the user. Putting it on the formula keeps the calculator pure — it reads `accrualUsedHkd = capUsage[rule.accrualKey]` and walks tiers without needing to know what the period meant; the **caller** scopes the `capUsage` key by period (convention: `<ruleId>__<YYYY-MM>`).

**Knock-on**: Simulator zeros `capUsage[rule.accrualKey]` at period boundaries derived from `accrualPeriod`. This isolation means a Phase 2 change to how periods are computed never touches `calculate()`.

---

## D3 — `applies_to` was added to exclusion rules (replacing v2's `exclusion_scope=bonus_only`)

**Decision**: Exclusion rules carry an explicit `appliesTo: string[]` of rule_types they disable (e.g. `[category_bonus, online_bonus]`). Calculator iterates this set, not a coarse enum.

**Why**: PRD v2 had `exclusion_scope=bonus_only` which meant "all bonuses excluded, base earns." The PRD §8.4 tax case revealed that real cards exclude some bonuses but not others — e.g. tax may exclude category bonuses but still earn the online channel bonus on certain cards. A boolean wasn't expressive enough.

**Knock-on**: Adding a new rule_type means deciding whether it should appear in existing exclusions' `appliesTo`. Schema docs the convention; YAML reviewer's responsibility to apply. `validate:data` could enforce stronger checks here in Phase 2.

---

## D4 — `reward_currencies` was re-introduced (cross-card ranking needs canonical valuation)

**Decision**: A `reward_currencies` table holds canonical currencies (`hkd_cashback`, `asia_miles`, `amex_membership_rewards`, ...) with a `base_value_hkd` field. Every rule cites a currency by slug; calculator multiplies `rewardUnits × rewardCurrencyValueHkd` to produce the HKD-equivalent in breakdown.

**Why**: V2 inlined points / cashback / miles into the `RewardFormula` payload, which made cross-card ranking impossible without re-deriving HKD value per call. Cross-card ranking is *the* primary product feature (PRD §3). Keeping currency value in a stable lookup table also lets us re-value all rules at once when a real-world rate (e.g. Asia Miles → HKD) shifts.

**Knock-on**: Currency revaluation = update one row + redeploy; no rule data touched. Time-travel valuation (historic txns valued at historic rates) is deferred to Phase 2 / Layer 6.

---

## D5 — Source text is extracted at ingestion, not at query time

**Decision**: `source_documents` has `extracted_text` populated by `pnpm extract:sources` on import. `source_chunks` carries pre-chunked spans for future embedding work. PDFs / URLs are fetched once and content-hashed.

**Why**: URLs die. PDFs move. Banks update T&Cs without changelogs. If our rules cite "https://hsbc.com.hk/...", we want the version we approved against — not whatever's at that URL when a question arrives. Embeddings + RAG (Phase 3) need the same fixed text.

**Knock-on**: `source_documents.content_hash` lets us detect when the upstream changed. `extraction_failed` flag means a re-attempt is a row update + script re-run, not a code change. Edit form (M15) explicitly excludes `extracted_text` from editable fields — owned by the extraction pipeline.

---

## D6 — Merchant resolver is an interface from Day 1 (calculator must work without categorySlug in TransactionContext)

**Decision**: `MerchantResolver.resolve(name): Promise<MerchantResolution>` is the only contract. M7 ships a `HardcodedMerchantResolver` (35 HK merchants); Phase 2 swaps in a DB-backed variant. The calculator never calls the resolver — the **caller** awaits resolution and passes `categorySlug + categoryResolutionConfidence` on the txn.

**Why**: keeping the calculator sync + side-effect-free is non-negotiable (calculator-semantics §1 invariants). If the resolver lived inside `calculate()`, every Phase 2 swap (DB queries, embedding lookups) would force the calculator async. Worse, the merchant-confidence floor would need to be propagated through internal state. Splitting them at the seam means resolver-side improvements never ripple into the calculator.

**Knock-on**: `HardcodedMerchantResolver.resolveSync()` (added M14) is a UI convenience over the async interface. `/calculator-test` runs the resolver client-side via this entry; the async contract stays canonical for server-side / Phase 2 paths.

---

## D7 — User domain is physically isolated (catalog evolution must not break user data)

**Decision**: `src/db/schema/user.ts` exists as an empty namespace, reserved for Layer 7 tables (`user_cards`, `user_card_caps_state`, `user_txn_history`, ...). Phase 2's source-extraction tables live under a separate `src/db/schema/extraction.ts` namespace.

**Why**: catalog (issuers / cards / rules / sources) churns frequently — every milestone adds columns. User data is high-stakes and slow-moving. Putting them in the same module would invite migrations that touch user tables for catalog reasons. Empty namespaces signal "this is reserved" without forcing premature design.

**Knock-on**: When Phase 3 begins (user accounts), the migration is contained to `user.ts` + cross-link tables. Catalog-side code never imports from `user`; calculator takes `UserCardContext` as a plain TS type (not a DB row), so it stays usable in tests + the admin UI without any user infra.

---

## D8 (M14) — `caveats.ts` + `explain.ts` live outside the pure calculator

**Decision**: `calculate()` stays minimal (invariant: pure, sync, deterministic). `caveats.ts` synthesizes UI-facing warnings; `explain.ts` produces per-rule decision traces for the "Why this lost" view. Both are pure but separate modules.

**Why**: caveats and per-rule explanations are presentation concerns. Folding them into `calculate()` would (a) bloat the hot path that simulator and ranking call once per card per txn, (b) couple the calculator to UI vocabulary, (c) make calculator-side changes risk breaking explanation semantics in subtle ways. Keeping the explanation in a parallel module that mirrors the pipeline gate-by-gate means we can change one without touching the other.

**Knock-on**: `explain.ts` re-runs each gate independently. A sanity check inside it asserts `matches()` agrees with its own per-condition walk — if they ever diverge, the test page surfaces it immediately as a thrown error.

---

## D9 (M15) — Edit forms mirror the syncer's economic-field refusal logic

**Decision**: `saveRuleEdit()` server action checks the same `ECONOMIC_RULE_FIELDS` list the YAML syncer checks. Changing any of them on an approved rule is refused with the list of changed fields; the recovery path is "demote to draft" or "rename slug + supersedes" (just like a YAML re-import).

**Why**: the calculator's correctness depends on "approved rule X means *this specific* reward math." If we let the edit form silently change rates on approved rules, the audit trail breaks and the source citation lies. The syncer already enforced this for YAML imports; the edit form is a parallel write path that must enforce the same invariant.

**Knock-on**: `ECONOMIC_RULE_FIELDS` is duplicated across `syncer.ts` and `actions/edit-rule.ts`. Keep them in sync — convention noted in README "Conventions" section. Adding a new calculator-observed field touches both.

---

## D10 (M16) — `NaiveSimulationEngine.projectSync()` companion to the async interface

**Decision**: The `SimulationEngine` interface stays async (Phase 2 may need IO for historic txn history / user state). The naive impl exposes a sync `projectSync()` method; the async `project()` delegates to it.

**Why**: `/projection-test` recomputes projections per render in `useMemo`. React's `useMemo` can't await. Wrapping in `useEffect + useState` adds a flash-of-stale-state and complicates the render path. Since the naive impl has zero IO, exposing the sync entry keeps the render simple without violating the interface contract. Same pattern as `HardcodedMerchantResolver.resolveSync()` (D6 knock-on).

**Knock-on**: A Phase 2 simulator with real IO won't have `projectSync()`, which forces the page to be refactored to async-aware state. That's correct: when the simulator stops being trivial, the UI must stop pretending it is.

---

## How to add a decision

When you make a load-bearing schema or architecture choice:

1. Append a numbered entry here in the same commit that lands the code.
2. Lead with the **decision** (one sentence), then **why** (motivation / what alternative was rejected), then **knock-on** (what other code now depends on this choice).
3. Cross-link to the milestone (M-number) so it's findable from `git log --oneline`.

If you later reverse a decision, don't delete the entry — add a new one citing the old one and explaining what changed.
