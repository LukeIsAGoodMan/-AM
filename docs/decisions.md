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

## D16 (P7) — Materializer: claim_type allowlist, synthetic slug, cap stitching, idempotent on `approved_rule_id`

**Decision**: P7's materializer turns an approved `cross_check_group` into a `reward_rule` (+ `reward_rule_sources` join rows), but only for claim_types that have a 1:1 destination in `reward_rules` — `earn_rate` and `exclusion`. Other claim_types (`annual_fee`, `welcome_offer`, `cap`, `eligibility`, `category_definition`) skip with `kind='skipped'` and a reason; each has a different destination (cards table / welcome_offers table / cap-stitching / qualitativeFeatures) that warrants its own materializer when it's needed. The new rule's slug is synthesized as `xchk__<claim_type>__<sanitized_key_dimension>__<group_id_prefix>` — distinct from the MVP hand-curated `<card>__<rule_name>` convention so it's obvious at a glance whether a rule came from YAML or from the cross-check pipe. Slug-collision detection (rule with that slug already exists) marks the group as materialized against the existing rule rather than erroring. For earn_rate, we opportunistically stitch in cap conditions from a matching cap group (same `card_id`, same `key_dimension`, eligible verdict) — both flow into the same `reward_rule` row so the calculator sees one rule, not two.

**Why**:
- **Allowlist over "materialize everything"**: each claim_type's destination has different schema semantics. annual_fee is a column on `cards`. welcome_offer is a structured tier array in its own table. cap supplements an earn_rate; it isn't a standalone rule the calculator reads. Pretending they all fit into `reward_rules` would either drop information or force a "type=annual_fee, payload=opaque-blob" pattern that defeats the point of flattened-condition columns (PRD §5 principle 4). Skipping cleanly with a reason lets the reviewer see what's happening and lets a follow-up milestone wire up each destination explicitly when there's user demand.
- **xchk__ slug prefix**: when a reviewer is debugging "where did this rule come from?", the slug is the fastest signal. A `hsbc-red__online_local_bonus` slug points back to the YAML; a `xchk__earn_rate__category_slug_online_local__7c3c067f` slug points back to a cross_check_group id (first 8 chars embedded). The id-suffix means even if two cards happen to produce the same key_dimension, the slugs don't collide. The collision path (linking to an existing rule) handles the legit case where the same group gets re-materialized after the rule was hand-renamed in YAML.
- **Atomic transaction (rule + join rows + group pointer)**: a half-materialized state — group pointing at a rule that doesn't exist, or a rule with no source provenance — would corrupt the audit chain. `db.transaction` makes the three writes one unit. On failure, none land.
- **Cap stitching is opportunistic, not required**: forcing earn_rate materialization to block on cap-group approval would mean a reviewer who approves the rate but not the cap leaves the group permanently unmaterialized. Better: materialize with whatever's currently eligible, and if the cap arrives later, the reviewer either edits the rule in /rules (M15 escape hatch) or we add a P7.1 pass that re-stitches caps onto already-materialized rules.
- **Primary source = highest priority (lowest number)**: PRD §22.7 specifies it. With multiple supporting sources (e.g. official P2 + 2 competitors at P5), the calculator's "rule has a source citation" invariant points to the most authoritative source. The other supporting sources go in `reward_rule_sources` for provenance display.

**Knock-on**:
- The `supportsP7()` allowlist is the single switch. Adding a new claim_type to it requires defining `deriveRuleType` + `pickFormulaPayload` for that type and likely a new schema lookup. New claim_types that don't get added skip cleanly — not a regression risk, just a "deal with this in the follow-up milestone" signal.
- The reviewer's Approve action in `resolveReviewTask` calls `materializeGroup` inline and appends the outcome to the success banner. A failure here doesn't roll back the claim-approval state (the materializer runs in its own transaction); the operator can re-run via the P7 CLI to recover.
- `reward_rules` has the `check (status <> 'approved' OR source_id IS NOT NULL)` invariant. The materializer always sets a source from the highest-priority supporting claim, so the constraint is satisfied — but if we ever allow materialization with zero supporting claims (we don't today), the insert would 23514. The fail-fast guard `loadSupportingClaimsWithSources(...).length === 0 → skipped` catches that case before the insert.
- For earn_rate, `pickFormulaPayload` strips fields that live on flattened columns (`isOnline`, `categorySlug`, `capAmountHkd`) so the jsonb payload only contains formula-shape fields the calculator dispatches on (`type`, `rate`, `points`, `perHkd`). Same convention as the hand-curated YAML; means /calculator-test sees materialized + hand-curated rules identically.
- `cross_check_groups.approved_rule_id` is the only idempotency gate. If an operator manually clears it (e.g. after deleting the rule for a re-do), the next materializer run will re-create. Slug-collision detection then catches "but the rule still exists" and links instead of inserting duplicate.

---

## D17 (P2 v2) — `promotionType` mandatory tag; aggregator only groups baseline claims

**Decision**: Every claim the extractor emits carries a mandatory `promotionType` enum tag (`baseline` / `referral_exclusive` / `conditional` / `time_limited` / `registration_required`). The tag rides inside `source_claims.structured_payload.promotionType` (no schema migration — the JSONB column already holds free-form per-claim shape). The P4 aggregator filters the working set to `promotionType='baseline'` claims only before grouping; non-baseline claims stay in `source_claims` as `status='pending_review'` but never contribute to any `cross_check_groups` row. `PROMPT_VERSION` bumps to `p2-v2`; the D14 `input_hash` semantics auto-invalidate every p2-v1 dedup entry, so a re-run over the same chunks produces fresh work.

**Why**:
- **The real-world pollution**: aggregator sites (MoneyHero, 里先生 Mr. Miles, 小斯 flyformiles, FlyAsia) interleave the CARD'S BASELINE TERMS with two other kinds of content: (a) their own referral commission cut re-packaged as "里先生独家 HK$1,600 現金回贈", and (b) time-limited campaigns ("推廣期至 2026-07-31"). The p2-v1 extractor emitted all of these as plain `welcome_offer` / `earn_rate` claims. The aggregator then grouped them together under `welcome_offer_default` / `category_slug=X`, and P7 materialized the inflated canonical as an approved reward_rule that the calculator started reasoning about. `pnpm diagnose` caught the effect (4 regressions in P9.5) but only because a hand-curated baseline was displaced — cards without a baseline just quietly ended up with fictional rules. Live SQL survey (search: "獨家 / 額外 / 里先生獨家 / MoneyHero exclusive" in `source_claims.extracted_text_snippet`) found this exact pattern on Citi Prestige, DBS Eminent, HSBC Visa Signature, and others.
- **Tag at the extractor, not the reviewer**: the LLM sees the source_type in the user message + the surrounding text — it's the best-positioned actor to decide whether "首2個月簽 HK$5,000 賺 HK$1,600" is `baseline` (bank T&C) or `referral_exclusive` (aggregator payoff). Pushing the classification down to a manual reviewer for every claim would multiply review-queue load by 4x for a decision the LLM makes at zero marginal cost.
- **Mandatory, not optional-with-default**: if `promotionType` were optional with a `baseline` default, silent LLM omission would recreate the pollution. Zod + JSON Schema `required` list forces the model to emit an explicit tag on every claim. A schema-violation → structured-outputs 400 → extraction_run marked failed → operator notices. Belt-and-suspenders — the p2-v2 prompt also puts the taxonomy inside the cached system-prompt block so the model can't miss it.
- **Payload nesting vs new column**: adding `source_claims.promotion_type` would require migration 0012 + backfill for p2-v1 rows. Nesting inside `structured_payload` keeps schema untouched and works today. Trade-off: can't index/filter at the DB level, but P4 loads all pending claims into memory anyway (bounded set — ~1000 at Phase 2 scale). Migrate later if we ever need a `WHERE promotion_type = ...` query at DB level.
- **Aggregator carve-out vs new group per type**: another design was to keep all promotion types in aggregator groups but add `promotionType` to the `key_dimension` string. That would produce 4x-5x more groups + review_tasks (baseline earn + referral earn + time-limited earn all separate) → reviewer queue explodes for no user-facing value. Non-baseline claims are visible in `/sources/[slug]` (raw claim view) if a reviewer wants to see them; they don't need their own review task.

**Knock-on**:
- `PROMPT_VERSION='p2-v2'` invalidates all p2-v1 `extraction_runs.input_hash` values (D14 hash includes prompt_version). Existing p2-v1 `source_claims` rows are marked `status='superseded'` before the p2-v2 re-run so the aggregator only sees fresh claims. Materialized xchk__ rules from p2-v1 canonical get nuked in the same transition (they were built on polluted canonicals).
- Runner + extractor tests need mocks updated: `ExtractResult.claims` shape now requires `promotionType`. Missed this in the first pass → typecheck failure caught it.
- Prompt test pins added: (a) every `PromotionType.options` value must appear in `SYSTEM_PROMPT` (mirrors the claim_type pin), (b) JSON Schema's `required` list contains `promotionType`, (c) Zod rejects an unknown promotionType value, (d) Zod rejects a missing promotionType.
- The `AggregateSummary` grows a `claimsSkippedNonBaseline` field so P4 CLI + `/dashboard` telemetry can report how much promotional noise the filter caught. A card whose non-baseline count is close to its total-scanned count is a data-quality flag ("this source has more marketing than facts") for the reviewer.
- Backward compat for p2-v1 claims: the filter reads `payload.promotionType` and treats missing as baseline. So during a mid-transition run (some p2-v1, some p2-v2 claims), old ones still flow. In practice we supersede all p2-v1 before re-running so this branch never fires — but it prevents accidental drop on partial re-run.

---

## D18 (P9.5 side-fix) — Syncer must skip xchk__ rules during archive sweep

**Decision**: `src/lib/import/syncer.ts`'s Phase-E "rules in DB but missing from YAML → archived" sweep excludes rules whose slug starts with `xchk__`. Enforced by a one-line filter (`!r.slug.startsWith("xchk__")`) on `toArchiveRules`. Materialized rules live in the DB by design (D16) and have no YAML counterpart; without the carve-out, every `pnpm import:data` would archive all of them.

**Why**:
- **The bug bit once already**: first `pnpm import:data` in P9.5 silently archived 104 P7-materialized rules — the operator only noticed because the next `pnpm diagnose` came up wrong. A silent data-quality regression triggered by an unrelated YAML edit is exactly the kind of surprise the syncer is supposed to prevent.
- **Slug prefix is the right carve-out granularity**: it's the same signal D16 uses to distinguish materialized vs hand-curated rules everywhere else (calculator, /rules provenance card, dashboard bar chart). One convention, everywhere.
- **Alternative rejected — track origin column**: adding a `rewardRules.origin` column with values `yaml` / `xchk` is more explicit but requires migration + backfill + touching every reader. Slug prefix is zero-cost and already-load-bearing.

**Knock-on**:
- If a hand-curated rule ever gets slug-prefixed `xchk__` (accidentally or on purpose), the syncer will stop touching it. That's fine — the naming convention is documented in D16, and the failure mode is "rule doesn't get archived", not "rule gets corrupted".
- The dashboard's `topCardsByMaterializedRules` query also uses `slug LIKE 'xchk__%'`. Same convention. Change either → change both.

---

## D19 (P13) — Currency FK is load-bearing for points_per_hkd; refuse partial rules on both write and read

**Decision**: A materialized `reward_rule` with `reward_formula_type='points_per_hkd'` MUST have a non-null `reward_currency_id`. Two enforcement points: (1) the P7 materializer refuses to insert a `points_per_hkd` rule if `lookupCurrencyId(payload.currencySlug)` returns null — the group is left with `approved_rule_id IS NULL` and a skip reason surfaces in the CLI + review queue; (2) the calculator's `ResolvedRule` loader (mirrored across `queries/resolved-rules.ts`, `queries/calculator-test.ts`, `queries/projection-test.ts`) throws when it sees `formula.type='points_per_hkd' && currencyValueHkd IS NULL` instead of silently falling back to hkd_cashback + 1.0 HKD/mile. `pnpm diagnose` gains a health check that runs before the calculator to fail loud if any such row exists.

**Why**:
- **The 1025-HKD ghost incident**: HSBC EveryMile ranked #1 in every diagnose fixture at 1025 HKD. Root cause was a stacked bug: (a) the P2 extractor emitted `currencySlug: "miles_generic"` — an off-taxonomy slug the LLM invented from HSBC product-page copy "at a rate as low as HKD2 = 1 mile" (which is itself category-conditional marketing, not base earn — see the P14 note below); (b) the P7 materializer read the wrong key (`payload.rewardCurrencySlug`, but the aggregator's canonical_payload uses `currencySlug` — same key as RewardFormulaSchema), so `lookupCurrencyId` always returned null; (c) the materializer inserted the rule with `reward_currency_id=NULL` anyway; (d) the calculator loader saw NULL and defaulted to `hkd_cashback` + 1.0 HKD/mile as a "sensible fallback". Result: 1000 miles × 1.0 HKD = **1000 HKD phantom reward** stacked on top of the real base earn — every fixture. Fourteen approved rules across six cards had this shape (asia_miles × 10 that landed correctly once the FK was fixed; avios × 2 + membership_rewards × 1 + miles_generic × 1 that need currency added to YAML or human triage).
- **Why the syncer wasn't enough**: `src/lib/import/syncer.ts:491` already refuses YAML rules with unknown `rewardCurrencySlug`. But the P7 materializer bypasses the syncer entirely (D16, D18) — it writes to `reward_rules` directly from `cross_check_groups.canonical_payload`. So the syncer's guard didn't cover the extraction path. D19 adds equivalent guards to the two entry points the materializer uses.
- **Fail-loud > silent fallback**: the fallback (`currencyValueHkd ?? 1.0`) looks like a helpful default in isolation — cashback rules genuinely earn HK$1 per HK$1. But *paired with a points_per_hkd formula*, it becomes a 10× reward inflation, and the calculator emits no signal that the number is wrong. A load-time throw makes the failure loud and traceable (the error message names the offending rule slug). The right handling for an off-taxonomy currency is upstream (add to reward_currencies YAML, or reclassify the claim in /review), not a downstream guess.
- **Dead `fallbackCurrencySlug` parameter removed from pickFormulaPayload**: it was reading the same wrong key (`rewardCurrencySlug`) that broke the whole chain, and would have masked more bugs of the same shape. Callers now rely on the D19 fail-fast guard for the "not in table" case.

**Knock-on**:
- `pnpm diagnose` gains `checkOrphanCurrencyRules()` as its first step. If any approved `points_per_hkd` rule has a null currency FK, diagnose exits 1 with each offending `card::rule` pair printed. A CI hook running diagnose catches regressions before they displace baseline rankings.
- Three duplicated `mapRow` functions in `src/lib/queries/{resolved-rules,calculator-test,projection-test}.ts` all carry the D19 guard. Comment already flagged "kept in sync by hand". If a fourth loader is added, add the guard.
- The P7 materializer's skip reason `currencySlug 'X' not in reward_currencies` becomes a review-queue signal: an operator seeing it knows to either add the slug to `data/currencies/*.yaml` (if it's a legitimate currency AsiaMiles doesn't cover — e.g. `avios`, `membership_rewards`) or reject the claim (if the LLM hallucinated the slug — e.g. `miles_generic`).
- The materializer test suite pins one D19 skip case against the live corpus (`skips points_per_hkd groups whose currencySlug isn't in reward_currencies`). If all off-taxonomy groups are eventually cleaned up, the test fails with a message telling the maintainer to delete or refresh it.
- The 4 sidelined groups (miles_generic × 1 on hsbc-everymile-credit-card, avios × 2 on citi-prestige-card, membership_rewards × 1 on american-express-gold-card) live in the review queue awaiting triage — they don't block diagnose, they just don't materialize until someone decides.
- HSBC EveryMile's `xchk__earn_rate__rule_type_base_earn__e8feb83a` group surfaced a **separate, deeper** bug: the marketing phrase "as low as HKD2 = 1 mile" was extracted as a base_earn rate when it's actually category-conditional. D19 sidelines it as a symptom; the root cause is a P2 extractor classification gap — deferred to a P14 prompt-hardening pass (add "if the rate is qualified by 'up to', 'as low as', or a category list, do NOT emit as base_earn").

---

## D20 (P14) — Caps carry their gating fields; cap key_dimension mirrors earn_rate

**Decision**: The `cap` claim type gains the same gating fields as `earn_rate` (`categorySlug?`, `appliesTo?`, `isOnline?`, `isOverseas?`, `isForeignCurrency?`), enforced at three layers: (1) the P2 extractor prompt (`p2-v3`) explicitly instructs the LLM that a cap MUST carry the same category/applies_to that its earn_rate does — "15% Fare Rebate on public transport, capped at HK$300/month reward" → cap payload `{categorySlug: 'public_transport', ...}`; (2) the P4 aggregator's `computeKeyDimension` for cap prioritises `categorySlug` → `applies_to=...` sorted-join → `cap_default=<period>_<basis>_card_level` (was `cap_default=<period>_<basis>`, no card_level suffix — the new suffix stops category-specific and truly-card-wide caps of the same period/basis from colliding into one group); (3) the P7 materializer's `loadMatchingCap` continues to match by exact key_dimension — now caps with `category_slug=X` line up naturally with the earn_rate group's `category_slug=X` dimension and stitch. The prompt also adds an anti-pattern for base_earn misclassification: "as low as", "up to", "at rates from" style qualifiers → emit as category_bonus with `categorySlug`, NOT base_earn (mitigates the P13 remnant where marketing copy like "HKD2 = 1 mile" was extracted as base earn).

**Why**:
- **The 178/178 no-cap incident**: PM-driven audit after P13 found that ZERO of the 178 materialized xchk__ bonus rules carried a cap. Root cause was symmetric to the D19 currency bug: p2-v2 prompt taught the LLM cap payload shape as `{amountHkd?, rewardAmount?, period, basis}` — with no gating fields at all. Every cap group ended up with `key_dimension = cap_default=<period>_<basis>` while every earn_rate group had `key_dimension = category_slug=X` → `loadMatchingCap` never got a hit. Result: Citi Octopus's 15% public_transport rule (real T&C caps it at HK$300/month reward) fired unbounded → HK$5000 transit spend produced 750 HKD phantom reward. BOC Chill 10% merchant_specific, HSBC Red 8% merchant_specific, plus every 4-5% category bonus in the corpus had the same shape. Rankings on any high-rate bonus scenario were structurally wrong.
- **Why fix at the prompt, not the materializer**: the necessary information (which category does this cap gate?) is available in the source text — "first HK$10,000 in airlines OR selected online travel merchants each quarter" is unambiguous — but the LLM was never asked. Attempting to reconstruct the linkage in the materializer would require re-reading the extracted_text_snippet with a second LLM call. Adding one field to the prompt shape is one order of magnitude cheaper and more accurate.
- **Symmetry with `exclusion`**: exclusion payload has had `{categorySlug?, appliesTo: string[]}` since p2-v1 for exactly the same reason (exclusions are conceptually the "no-earn version" of earn_rate). Bringing cap into line with exclusion means one mental model for reviewers: cap and exclusion are both modifiers on earn_rate, and they carry the same category dimension the earn_rate does.
- **Card-level cap suffix**: a small but load-bearing detail. Before D20, `cap_default=month_reward` was used both for "aggregate monthly reward cap of HK$500 across all bonuses" AND (implicitly) for any cap that just happened to have that period/basis pair. After D20, only the truly card-wide caps land as `cap_default=<period>_<basis>_card_level`, freeing the plain `category_slug=X` dimension for the specific-category caps. This won't affect a materializer that only stitches category-specific caps in v1, but sets up cleanly for a future P15 that adds card-level cap support (via a shared `usageKey = card_slug` cap that multiple rules point to).
- **The "as low as" guard**: HSBC EveryMile's "Earn unlimited miles at a rate as low as HKD2 = 1 mile" was extracted as `rule_type=base_earn, perHkd:2, currencySlug:miles_generic` in p2-v2. Real base earn is HK$8/mile; the HK$2/mile only applies to designated everyday spend (a category subset). D19 caught the currency half of the bug but the classification half (should have been `categorySlug='designated_everyday'` category_bonus) survived. p2-v3's anti-pattern instruction addresses it upstream so the miles_generic-shape bug doesn't recur under a fresh disguise.

**Knock-on**:
- **PROMPT_VERSION bump to `p2-v3`**: auto-invalidates every D14 `input_hash` dedup entry from p2-v2, forcing a full re-extract on the next `pnpm p3:run`. p2-v2 source_claims were superseded before the p2-v3 run; xchk__ rules and cross_check_groups were deleted and re-created (aggregator is idempotent D12; materializer is idempotent D16).
- **Bulk re-extract cost**: 631 chunks across 25 cards → $13.41 wall-clock ~30 min ($0.87 for citi-octopus test + $12.54 bulk). Well under P14's cost forecast because prompt caching stayed warm across the run.
- **Cap-stitch coverage in v1**: 5 of 73 xchk__ bonus rules now carry a stitched cap (from 0). Remaining 68 fall into three buckets: (a) card-level caps where no matching category-specific earn_rate exists (need P15 for card-scoped `usageKey`), (b) `applies_to=X,Y` multi-category caps where no single earn_rate matches (need materializer smartness to fan out one cap onto multiple rules), (c) legitimate LLM data-quality gaps where the payload can't materialize at all (points_per_hkd rules missing perHkd/points fields on a card like boc-cheers). The Citi Octopus HK$300 case landed as `conflict` because the T&C has a two-tier structure ("HK$300 fare-only OR HK$500 fare+tunnel+parking aggregate") and our schema doesn't model nested caps — that's not a P14 miss, it's a real ambiguity the reviewer needs to resolve.
- **Aggregator test coverage**: new pins added for cap `applies_to=X,Y` (sort-insensitive) and card_level suffix, plus prompt test pins for the p2-v3 cap-gating language and the "as low as" guard. If a future edit softens either, tests fail with a clear message.
- **Not addressed here (P15+ candidates)**: (a) card-level cap materialization — needs a `capUsageScope: card_slug` shape and materializer wiring so multiple rules can share one accrual bucket, (b) multi-category applies_to cap fan-out — one cap group with `applies_to=[travel_airline, travel_ota]` needs to stitch to both category-slug earn_rate rules via a shared cap usage key, (c) rule dedupe against existing YAML — the audit finding about HSBC Red / BOC Chill online_local double-count still holds (yaml 4% + xchk 4% → 8% effective), needs xchk to skip creation when a matching yaml rule already exists.

---

## D21 (P15) — Shared cap accrual via `cap_usage_key`; fan-out + card-level cap materialization; reward-basis cap in the calculator

**Decision**: One materialized reward_rule can now inherit a cap from a cross_check_group whose key_dimension DOESN'T exactly match its own — via two new stitch paths in the materializer, both writing a shared `cap_usage_key` so the calculator's accrual bucket is shared across all rules the cap fans out to:

- **applies_to fan-out**: a cap group with `key_dimension='applies_to=X,Y,Z'` stitches onto every earn_rate rule on the same card whose category ∈ {X, Y, Z}. All those rules get `cap_usage_key = 'xcap:<capGroupId>'`.
- **Card-level fallback**: a cap group with `key_dimension` matching `cap_default=<period>_<basis>_card_level` (D20's suffix) stitches onto every earn_rate rule on the card that didn't get a more-specific cap first. Same `xcap:<capGroupId>` bucket per card+cap-group.

Match precedence: (1) exact category_slug=X match → per-rule cap (existing behaviour, `cap_usage_key` stays NULL), (2) applies_to fan-out → shared, (3) card-level fallback → shared. First hit wins.

At the calculator side, `mapRow` in the three query-loaders reads `usageKey: r.capUsageKey ?? r.slug` — non-null enables sharing, null preserves per-rule accrual. `applyRuleWithCap` also gains a `basis='reward'` branch (was `throw "not implemented"`): compute the pre-cap reward via `applyFormula`, then trim it at `cap.rewardAmount - capUsage[usageKey]`. Migration 0012 adds the `cap_usage_key` column to `reward_rules` as a nullable `text`.

**Why**:
- **The 178/178 audit → P14 got 5, P15 got 35**: P14 wired the LLM/aggregator/materializer plumbing so category-specific caps stitch, but that only helped rules whose cap group had `key_dimension = category_slug=X` verbatim. Real HK T&C caps are mostly *card-wide* ("aggregate HK$500/month reward across all bonuses") or *multi-category applies_to* ("first HK$10,000 in dining OR overseas each quarter"). P14 left them orphaned. P15's two new paths pick them up: Citi Octopus now has HK$50k/mo reward cap on all 7 of its rules (shared bucket), BOC Chill has HK$150/mo shared across 3 online/overseas rules, DBS Black/Eminent get their spending caps, etc.
- **`cap_usage_key` in a column, not derived**: two options were considered — (a) store on the row like this, (b) derive at load-time in mapRow by hashing (card_id, cap_group_id). (a) won because it makes the accrual identity visible in SQL for debugging (`SELECT slug, cap_usage_key FROM reward_rules WHERE cap_usage_key = 'xcap:XYZ'` immediately shows every rule that shares that bucket), and it survives future refactors of loadMatchingCap. The migration is a single nullable column — zero backfill.
- **NULL fallback to rule.slug preserves the invariant**: pre-P15 rules and freshly-materialized single-rule caps both leave the column NULL, and mapRow uses `r.slug` — same as before. No behavioural change on the majority of rules; the sharing semantics only kick in for the ~30 fan-out/card-level rules where the column is populated.
- **Reward-basis cap was already needed**: the pre-P15 corpus had zero reward-basis caps materialized because the calculator threw and no cap group was stitching them anyway. P15's shared-bucket fan-out immediately surfaces them (Citi Octopus HK$50k/mo, BOC Chill HK$150/mo, Citi Rewards HK$300/campaign). Implementing basis='reward' is small — compute reward first, cap the total — and the semantics match how the extractor emits `rewardAmount` (same units as `applyFormula` returns: HKD for simple_percent, miles/points for points_per_hkd).
- **Card-level fallback runs LAST, not FIRST**: if we ran it first, a rule with a more-specific category cap would be capped by the loose card-wide cap instead. The correct semantic when a rule has both a specific and card-level cap in T&C is "the tighter one bites first" — modelling that fully requires multi-cap-per-rule support which P15 v1 doesn't do. Running specific first at least gets the calculator to enforce the tighter bound, which is what a reviewer would expect.

**Knock-on**:
- **cap-stitch coverage 0/178 → 35/73 in two milestones** (P14's plumbing + P15's fan-out). Rule-count differs because P14's full re-extract also churned rule counts. The remaining 38 unstitched are: (a) rules where no cap group exists on the card at all — the T&C really has no cap for that category, or the LLM missed it; (b) rules whose earn_rate group has payload-quality issues and materializes with `skipped` reason; (c) rules on cards with conflict-status cap groups (like Citi Octopus HK$300 fare-only which conflicts against HK$500 aggregate — human triage territory).
- **Calculator tests**: new suite pins reward-basis cap at three points (under cap → full reward, cross-boundary → trimmed, fully consumed → zero) plus one shared-usageKey test proving two rules with the same `xcap:X` string read from the same accrual bucket. `apply-cap.ts`'s `transaction_count` branch still throws — no live rule uses it; wire when needed.
- **Materializer test**: read-only invariant added — the live corpus must contain at least one `xchk__` approved rule with a non-null `xcap:` prefixed `cap_usage_key`. If someone deletes the fan-out branch or nuke every fan-out cap group, the test fails loudly.
- **P14's promise landed**: audit-level cap-stitch coverage crossed the "usable" threshold. Rankings for scenarios like "public_transport HK$5000 on Citi Octopus" now respect the 300/mo cap and don't produce a phantom 750 HKD.
- **Not addressed here (P16+ candidates)**: (a) multi-cap per rule (tightest-bite semantics for a rule with both category-specific + card-level caps in T&C), (b) YAML rule dedupe (still the audit finding about HSBC Red / BOC Chill 4% × 2 stacked = 8% effective), (c) conflict cap resolution (Citi Octopus HK$300 fare-only vs HK$500 aggregate — reviewer triage). None block calculator correctness on the majority of scenarios; all worth revisiting once the review-queue backlog clears.

---

## D22 (P16) — Materializer dedups xchk__ rules against hand-curated YAML baselines

**Decision**: Before inserting an xchk__ rule for a `claim_type='earn_rate'` group, the materializer looks for an existing approved, non-xchk__, non-campaign rule on the same card that covers the same `(rule_type, category_id)` combo (with matching NULL semantics on both sides for base_earn). If a match exists, the group is marked `kind='skipped'` with reason `dedup against yaml rule '<slug>'` and its `approved_rule_id` is set to the yaml rule so future re-runs don't retry. The check runs after `deriveRuleType` (which needs the earn_rate payload's isOnline/isOverseas flags to distinguish e.g. `online_bonus` from `category_bonus`) and before the currency guard / cap stitch — the earliest point where the ruleType is known but no side effects have landed.

**Why**:
- **Silent 2× reward inflation was the audit's finding #2**: HSBC Red online_local was 4% yaml + 4% xchk both stacking additive → **8% effective**. BOC Chill was 5% + 5% → 10%. Same shape on base_earn: HSBC Red, BOC Chill, SC Simply Cash all had their yaml base rate re-emitted by the extractor as an xchk baseline, then both fired → doubled base earn. Six identical duplication triplets across the corpus, all silently poisoning rankings for any transaction that hit the affected category. Nothing in the calculator or /rules page flagged them — they looked like two legitimate rules on the same category with matching rates.
- **Slug collision alone wasn't enough**: the materializer already had a slug-collision guard (D16). But xchk__ rules use synthesized slugs (`xchk__earn_rate__category_slug_online_local__<groupIdPrefix>`) while yaml rules use hand-picked ones (`hsbc-red__online_local_bonus`) — no collision, no skip. The two coexist as different rule rows on the same card+category. D22 adds a semantic dedup on top of the syntactic slug guard.
- **Match on `(card, rule_type, category)`, not on rate**: two options considered — (a) always dedup when card+rule_type+category matches, trusting yaml as ground truth for rate; (b) only dedup when rates also match (within ±5%). Went with (a) because: yaml is the human-curated source of truth (D1) and is what the syncer/reviewer flow refuses to overwrite. If the extractor emits a divergent rate for the same (card, category), that's a data-quality signal for review — surfacing it as a competing xchk__ rule that "wins by newer commit" would be worse than surfacing it as an xchk group without a materialized rule. The /review queue already flags rate conflicts as `conflict_resolution` review_tasks.
- **`campaignId IS NULL` filter is load-bearing**: Q3 2026 online extra 2% campaign on hsbc-red carries `campaignId != NULL` and lives at `rule_type='campaign_bonus'`. It shouldn't dedup a baseline xchk group and it shouldn't be deduped-against by one. Dropping campaign rules from the yaml match set keeps campaigns as separate stackable rules — same design as D8's caveat that campaigns stack on top of baselines.
- **Only earn_rate, not exclusion**: an xchk__ exclusion + yaml exclusion for the same category is redundant but not calculator-poisoning (exclusions filter other rules; they don't stack rewards). Deduping exclusions is a cosmetic cleanup for /rules, worth doing but not in P16 v1 scope.

**Knock-on**:
- **Post-P16 corpus**: xchk__ rules 161 → 155 (six dedup'd — matches the six duplicates the audit found). Yaml count unchanged at 34. Total approved rules 195 → 189. Cap-stitching preserved: 33 rules with caps (was 35 pre-P16; two of the deduped rules had caps, but their yaml counterparts didn't inherit them — the yaml rules keep whatever cap the curator wrote in the file, since materializer doesn't back-patch caps onto yaml rules).
- **Diagnose rankings shift correctly**: `Hang Seng enJoy dining HKD 2000 NOT selected` scenario — DBS Black World now ranks #2 at 110 HKD (was 143.33 pre-P16, with duplicate dining_local rules stacking). DBS Eminent #1 at 120 HKD (has an xchk dining rule but NO yaml dining rule — dedup didn't fire). The 143.33 → 110 shift is the double-count being removed.
- **Test scaffold updated**: `resetGroupMaterialization` in materializer.test.ts now guards against deleting the linked rule if it's a yaml (non-xchk__) row — the P16 dedup path can legitimately link a group to a yaml rule, and the test helper mustn't cascade-delete real curated data. Guard: only cascade-delete when linked rule's slug starts with `xchk__`. Two existing tests moved from `category_slug=online_local` (now dedup'd) to `category_slug=utilities` (not covered by hsbc-red yaml) to keep exercising the `kind='created'` path.
- **Materializer test pin added**: pins the exact hsbc-red base_earn dedup case. If the dedup logic is reverted or misconfigured, the test fails with `Expected: "skipped", Received: "created"` — a clear signal.
- **Cap group linkage**: when P16 dedups an earn_rate xchk group, the corresponding cap group (if any) is left un-stitched. The cap group's canonical still exists in cross_check_groups; a reviewer could edit the yaml rule to add the cap manually, or a future P17 could back-patch caps onto yaml rules. Not addressed in P16.
- **Not addressed (P17+ candidates)**: (a) exclusion dedup (cosmetic), (b) yaml back-patch — some yaml rules lack caps that xchk correctly identified; a follow-up could optionally propose these to the reviewer, (c) rate-divergence surfacing — when yaml says 4% and xchk single_source says 3%, dedup silently trusts yaml; showing the reviewer the divergence in /review would improve auditability.

---

## How to add a decision

When you make a load-bearing schema or architecture choice:

1. Append a numbered entry here in the same commit that lands the code.
2. Lead with the **decision** (one sentence), then **why** (motivation / what alternative was rejected), then **knock-on** (what other code now depends on this choice).
3. Cross-link to the milestone (M-number) so it's findable from `git log --oneline`.

If you later reverse a decision, don't delete the entry — add a new one citing the old one and explaining what changed.
