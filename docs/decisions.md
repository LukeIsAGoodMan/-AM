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

## D11 (P1) — Phase 2 extraction tables live in their own namespace, one-way dependency

**Decision**: All 5 Phase 2 tables (`source_claims`, `extraction_runs`, `cross_check_groups`, `review_tasks`, `reward_rule_sources`) live in `src/db/schema/extraction.ts`. They may reference catalog tables (cards, source_documents, reward_rules) via FKs. Catalog tables MUST NOT reference back. Enforced by file structure + import direction (`catalog.ts` never imports from `extraction.ts`).

**Why**: same logic as [[D7]] (user domain isolation). Catalog is stable + the calculator's input; extraction is the build-time pipeline that produces catalog rows. If catalog grew an FK into `source_claims`, deleting an extraction run would risk corrupting calculator inputs, and the MVP code would suddenly carry Phase 2 dependencies. One-way isolation means: a MVP-era developer never has to think about extraction; a Phase 2 developer can freely refactor extraction without breaking the calculator.

**Knock-on**: `reward_rules.source_id` stays a scalar FK to the primary citation. Multiple supporting sources live in `reward_rule_sources` (m:n join in the extraction namespace). The calculator reads only `source_id`; the rule detail page can JOIN out to `reward_rule_sources` for provenance display, but the calculator never sees it.

---

## D12 (P1) — `cross_check_groups` has UNIQUE `(card_id, claim_type, key_dimension)`

**Decision**: The aggregator's "group claims by dimension" output is keyed by `(card_id, claim_type, key_dimension)` and the DB enforces the uniqueness. `key_dimension` is the discriminator within a `claim_type` (e.g. `'category_slug=online_local'` for category bonuses, `'rule_type=base_earn'` for base earn).

**Why**: the cross-check aggregator (P4) is going to be re-run frequently — every time a new claim lands, every time a reviewer approves something. We want re-runs to be **idempotent**: same inputs produce zero net writes, not duplicate groups that the reviewer then has to manually merge. A unique constraint converts a possible bug class (silent duplicates) into a loud error (`unique_violation`) the aggregator must explicitly handle with an upsert.

**Knock-on**: P4's writer is `INSERT ... ON CONFLICT (card_id, claim_type, key_dimension) DO UPDATE`. `key_dimension` must be canonical — same logical rule from two different prompt versions must produce the same dimension string, or we get parallel groups. The P2 prompt design owns this canonicalization (lowercase, sort keys, etc.). Schema can't enforce it; tests + reviewer eyes catch drift.

---

## D13 (P2) — Extraction prompt design: schema-guided + cached + Zod-validated

**Decision**: P2's extraction prompt sits in `src/lib/extraction/prompt.ts`. It (a) constrains the model output via `output_config.format: {type: "json_schema", ...}` so the LLM can't free-form drift, (b) caches the system prompt + taxonomy via `cache_control: {type: "ephemeral"}` because that block is stable across every extraction call, and (c) Zod-parses the response anyway for belt-and-suspenders. Prompt is versioned (`PROMPT_VERSION = "p2-v1"`) and the version goes into `extraction_runs.prompt_version` and the `input_hash` so re-runs over the same chunk under a new prompt produce a distinct row.

**Why**:
- **Structured output, not prose**: LLMs reliably hallucinate JSON shapes when asked to "respond in JSON". The Messages API's `output_config.format` constrains generation against a JSON Schema at decode time, eliminating the "extra trailing comma" / "missing required field" failure modes that would otherwise require retry loops.
- **Prompt caching is non-negotiable for cost**: the system prompt + claim-type taxonomy is ~1500 tokens. At Opus 4.7 rates ($5/1M input), uncached that's $0.0075 per call. With caching (1.25× write, 0.1× read), the second call onward costs ~$0.001 for that prefix. Across ~75 cards × ~5 chunks each × ~3 sources = ~1100 calls during Phase 2, caching is the difference between $8 and $1 just on the system prompt.
- **Zod after structured output**: the API guarantees the shape matches the schema, but doesn't guarantee invariants like `extractedTextSnippet.length >= 1` (skill says JSON Schema can't carry `minLength`). Zod enforces those at parse time and surfaces a real error if the model emits a malformed claim, which we catch and persist as `extraction_runs.status='failed'` rather than silently dropping.
- **Prompt version in `input_hash`**: P2's caller pre-computes `sha256(prompt_version + source_id + chunk_text)` so P3's runner can `WHERE NOT EXISTS` against `extraction_runs.input_hash` to skip already-extracted chunks. Bumping `PROMPT_VERSION` automatically invalidates the dedup — desired: a new prompt is *meant* to re-extract.

**Knock-on**:
- The system prompt mentions every `ClaimType` enum value by name — a vitest pin (`SYSTEM_PROMPT.includes(t)` for every t) forces them to stay in sync. Add a new claim_type, the test reminds you to update the prompt.
- The user message is built deterministically (sorted-ish, no timestamps) so the same chunk under the same prompt version always serializes to the same bytes. The skill's caching invariant requires this — a `Date.now()` in the user message would silently make every call a cache miss.
- Cost computed inline in `extractor.ts` is a snapshot of Anthropic's pricing (cached 2026). If they change, update `PRICING` constant; `extraction_runs.cost_usd_cents` rows written before the change are historical and shouldn't be back-corrected.
- The extractor uses **non-streaming** at `max_tokens: 8000`. The skill flags streaming as a default for high `max_tokens`, but extraction outputs are small (one chunk → at most a handful of claims) so the simpler non-streaming path is fine. P3's runner can switch to streaming if a chunk genuinely needs more headroom.

---

## D14 (P3) — Extraction runner: dedup by input_hash, concurrent batches, fail-isolated

**Decision**: P3's batch runner orchestrates many P2 extractor calls under three constraints:
1. **Dedup** via `(PROMPT_VERSION, source_id, chunk_text)` SHA-256 hash. Before processing, query `extraction_runs WHERE status='succeeded' AND input_hash IN (...)` and skip matches. `--force` bypasses for prompt-iteration runs.
2. **Concurrency cap** (default 3). Process in `Promise.allSettled` batches sized to the cap; wait for the batch to finish before starting the next.
3. **Failure isolation**. A single chunk's API error or schema-validation failure produces an `extraction_runs` row with `status='failed'`, surfaces in the per-chunk callback, and does NOT abort sibling chunks. Re-runs naturally retry the failures because dedup only skips `succeeded`.

CLI default behavior is "no scope = no work" — must pass `--card-slug` or `--status`. Avoids the "I meant to test one card and just spent $50" footgun.

**Why**:
- **Hash-based dedup over a "processed" flag**: a flag couples the source-of-truth to the extraction_runs table (which would need a column added, plus a backfill). Hashing the inputs the model actually saw lets the same dedup logic work across chunks that may have been re-chunked, sources that may have been re-extracted, or prompts that may have changed (because PROMPT_VERSION is in the hash — a new prompt invalidates the dedup, *desired*: a new prompt is meant to re-extract).
- **Skip on succeeded, not on any-status**: a stuck `pending` run shouldn't permanently block a retry. A `failed` run is the recovery target. Only `succeeded` means "this was extracted correctly, don't re-pay for it."
- **`Promise.allSettled` over `Promise.all`**: with `.all`, one rejection aborts the whole batch and we lose the work of N-1 in-flight calls. With `.allSettled`, every chunk gets recorded one way or the other. Bank T&Cs are messy; a single chunk that confuses the model shouldn't take down a 50-card overnight run.
- **Cap concurrency at 3, not unlimited**: prompt caching (D13) requires the first cache-write to *finish streaming* before sibling requests can read the cache. Burst all 50 chunks in parallel and every single one pays the cache-write premium (1.25× input) instead of the read price (0.1×). 3-at-a-time means the first request seeds the cache before chunks 2-50 fan out and read from it. The 13× cost difference on cached input is the difference between "$5 to extract Phase 2" and "$60".

**Knock-on**:
- The runner exposes an `extractFn` parameter for tests to inject a mock (the production caller passes the real `extractClaimsFromChunk`). Avoids needing to mock Anthropic's SDK; one less moving part in the test suite.
- The CLI's "must specify scope" default is documented in `--help`. If we ever build a "background extractor cron" it'll need a `--all` flag that the test/dev CLI deliberately omits.
- `loadSeenInputHashes` does a single `IN + AND status='succeeded'` query — no per-chunk round trips. For Phase 2's expected ~1000-chunk runs, that's one query of ~1000 hashes, well within Postgres's IN-clause comfort zone.

---

## D15 (P4) — Cross-check aggregator: anchor-and-check verdict, informational-field carve-out

**Decision**: P4's aggregator computes a group's verdict in two passes rather than the per-field median/mode flow PRD §22.6 describes. Pass 1: rank claims by `priority_weight × confidence` (ties broken by claim id for determinism), take the heaviest as the **anchor** — its payload becomes `canonical_payload`. Pass 2: walk the remaining claims; a claim is **supporting** if every shared CALCULATOR-OBSERVED field agrees with the anchor (numeric within ±5% relative tolerance with a 0.001 absolute floor, strings case-/trim-insensitive, arrays order-insensitive, mixed types never match), else **contradicting**. Verdict: `conflict` if any contradicting claim is from priority ≤5, `agreed` if ≥2 supporting and no meaningful contradiction, `single_source` if only 1 supporting. `aggregate_confidence` = weighted-average of supporting claims only. Informational fields (`waiverConditions`, `criteria`, `definition`, `description`, `note`) are skipped during agreement comparison — they're descriptive text the reviewer reads, not values the calculator observes.

**Why**:
- **Anchor-and-check over per-field median/mode**: our actual clusters are 2–8 claims wide. Per-field median was designed for hundreds-of-sources crowdsourcing, where one outlier on `rate` shouldn't drag the canonical value down. At our scale, divergence shows up as whole-claim disagreements (one source extracted the merchant-specific 8% as the headline rate; the others extracted the 4% online_local rate). Anchor-and-check correctly tags that as a conflict and surfaces the offending claim id for the reviewer. The simpler model gives the same verdict on our real HSBC Red data while being trivially auditable: "the verdict is what the highest-weighted claim says, modulo who agrees." If a real conflict surfaces where the anchor-based approach picks the wrong canonical (e.g. the heaviest claim is actually the outlier), we'll graduate to true per-field consensus then.
- **Informational-field carve-out is load-bearing**: the first live run produced `conflict` on annual_fee because three sources all said `amountHkd=0` but phrased the waiver text differently ("Perpetual annual fee waiver" vs "perpetual waiver, no spending requirement" vs "永久豁免年費"). That's not a real conflict — the calculator stores `cards.annual_fee_hkd` and doesn't read `waiverConditions` at all. Treating text-field variance as a verdict-gating signal would mean the reviewer would have to dismiss every multi-source group as a false positive. The carve-out makes the aggregator's verdict track the same notion of "equivalence" that the calculator uses (D11 mirror: the schema seam is `ResolvedRule`; only fields a `ResolvedRule` would observe should gate equivalence).
- **Deterministic tiebreak (claim_id alphabetical)**: without it, two equally-weighted claims could swap anchor positions across re-runs as Postgres's ordering changes. The aggregator must be idempotent (D12) — that includes producing the same canonical_payload across re-runs, not just the same group row count.
- **Confidence excludes contradicting claims**: the agreed verdict's confidence should reflect "how strong is the agreement", not "how strong are the disagreeing claims". A contradiction's weight goes into deciding the status, not the confidence number once status is known.

**Knock-on**:
- The `INFORMATIONAL_FIELDS` set in `aggregator.ts` is the canonical list. If a new informational field gets added to the extraction prompt (e.g. `reasoning`), add it here too — otherwise the aggregator will start gating verdicts on prose.
- `key_dimension` is the discriminator-string format `${field}=${value}`. `computeKeyDimension` is the single place that decides what fits where for each claim_type. Adding a new claim_type without updating this function silently drops claims of that type from aggregation (logged on the run, not crashed) — a defensive default since the aggregator can run before the dimension logic is wired. Tests pin the existing cases.
- Review-task creation is idempotent (skip-if-open-task-exists for this group), but the task content is built from the verdict *at task-creation time*. If a verdict later flips (e.g. agreed → conflict because a new contradicting claim arrived), the group row updates but the open task does not — reviewer sees stale title/priority until they dismiss + re-run. Conscious v1 trade-off; the alternative (dismiss-and-recreate on verdict change) risks spamming the reviewer queue when verdicts flap. Revisit if it becomes a real workflow problem.
- `aggregateConfidence` is stored as a numeric(4,3) string in Postgres. Aggregator computes a JS float and toFixed(3)'s it on write; tests use `toBeCloseTo` because of float arithmetic. Don't compare these strings with `===`.

---

## How to add a decision

When you make a load-bearing schema or architecture choice:

1. Append a numbered entry here in the same commit that lands the code.
2. Lead with the **decision** (one sentence), then **why** (motivation / what alternative was rejected), then **knock-on** (what other code now depends on this choice).
3. Cross-link to the milestone (M-number) so it's findable from `git log --oneline`.

If you later reverse a decision, don't delete the entry — add a new one citing the old one and explaining what changed.
