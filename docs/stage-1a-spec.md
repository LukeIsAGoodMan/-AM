# Stage 1A · Approved Implementation Spec

**Status**: PM approved on 2026-07-16. Not yet started.
**Scope**: Deterministic canary implementation for American Express Explorer + Blue Cash only. Do NOT run full-database materialization.
**Long-term architecture (approved direction · do not redesign)**:
- MoneyHero-assisted coverage discovery
- Multi-source source claims
- Field-level authority policies
- Persistent rule identities
- Manual overrides
- Versioned materialization
- Scenario-based reward calculation

Stage 1B / 2 / 3 come AFTER Stage 1A landing + PM verify.

---

## Prior Context (for the implementing session)

### 3 rounds of architecture audit preceded this spec

1. **Round 1** · initial audit found 6 systemic gaps (materialization holes for annual_fee/welcome_offer, currency display, conversion chain missing, aggregator grouping too coarse, no override layer). See `docs/decisions.md` and the git log around P13–P17.
2. **Round 2** · PM demanded concrete evidence per issue + MoneyHero role clarification + stable override identity + objective/subjective valuation separation + no temporary schema.
3. **Round 3** · PM approved the *direction* but rejected (a) using derived logical keys as sole identity, (b) global 5% material-diff threshold, (c) union-exclusion for published data, (d) auto-publishing single-source alt modes, (e) claim-count fixtures, (f) inline partial-UNIQUE syntax, (g) blindly migrating base_value_hkd into a "default profile".
4. **Round 4 (current spec)** · PM added new normalization requirements (four-layer reward model · typed directional ratios · legacy-unverified default · dry-run tooling · HSBC evidence audit). Corrected Stage 1A scope to remove premature persistent-identity work (moved to Stage 1B).

### Confirmed evidence pins (do not re-audit · already collected)

| Issue | Concrete evidence |
|---|---|
| Blue Cash HK$100 Octopus offer exists in DB | 10+ claims across MoneyHero (`0771306e`, `db0def40`, `2f8882ac`), mrmiles (`6a4e22fc`, `32549e30`, `9d6d965d`), official page (`2d2c6e27`, `ce32b962`). Lost by (a) aggregator `welcome_offer_default` single key_dim, (b) `valuesAgree` object-array bug, (c) materializer skips `welcome_offer` |
| Blue Cash "1.2% insurance" misclassification source | **mrmiles claim `6db31629`** URL `https://www.mrmiles.hk/ae-blue-cash/` quote `如當面交付保險費用都有1.2%消費回贈！` — Chinese inclusion pattern `如...都` |
| Blue Cash base_earn group conflict | Group has 5 correct no-category simple_percent claims + 1 mrmiles no-category `points_per_hkd asia_miles perHkd:6` claim `a5a2e5a5` (miles-convert alt-mode). Formula-type mismatch → conflict. Correct 1.2% base rule never materializes |
| Explorer annual_fee canonical | Group `37f13d3a` status=conflict. Correct value HK$2200 sourced from official claim `42a62f31` URL `https://www.americanexpress.com/hk/en/credit-cards/explorer-credit-card/`. Outlier HK$9500 from mrmiles `750f40eb` (quote `年費$9,500無得豁免` — needs investigation, may reference different Amex product). Various HK$0 first-year-only interpretations from mrmiles |
| Explorer welcome_offer collapse | 17 pending_review welcome claims + agreed group `fd617117` `welcome_offer_default` collapsed to canonical `{tiers:[{amount:1152000, currencySlug:ae_points, days:90, spend:192000}]}` via array-of-objects agreement bug |
| Materializer supportsP7 | Only `earn_rate` + `exclusion`. `annual_fee`, `welcome_offer`, `category_definition`, `eligibility`, `cap` are skipped. D16 documented this deferral |
| Currency display | `reward_currencies` has `name_en`, `name_zh`. `ResolvedRule` only surfaces `rewardCurrencySlug`. `CalculatorTestClient.tsx:853` displays slug directly |
| No override layer | No `reviewer_overrides` table, no `rule_identities` table. `/review` actions directly mutate main tables |

### Key repo landmarks

- Existing prompt: `src/lib/extraction/prompt.ts` · `PROMPT_VERSION = 'p2-v3'`
- Aggregator bug locations: `aggregator.ts:364` (`computeKeyDimension`), `aggregator.ts:548-553` (`valuesAgree` array branch)
- Materializer: `materializer.ts:415` (`supportsP7`)
- ResolvedRule seam: `src/lib/calculator/resolved-rule.ts`
- 3 mapRow copies: `queries/resolved-rules.ts`, `queries/calculator-test.ts`, `queries/projection-test.ts`
- Current migrations end at 0013 (caps jsonb). Stage 1A adds 0014+.

---

## PM's Stage 1A Spec (verbatim · authoritative)

The following 12 sections are the PM's approved requirements. Implement to these definitions, not to any prior draft.

### 1. Current Problems We Have Confirmed

Confirmed failures include:

1. **`materializer.ts` only supports a limited set of claim types.** Annual fees and welcome offers may be correctly extracted but never written into the final product tables.

2. **Earn-rate grouping is too coarse.** Different reward formula types (simple cashback percentage, points per HKD, miles per HKD) may be grouped together and incorrectly treated as conflicts.

3. **Welcome-offer grouping and object-array comparison are incorrect.** Separate components such as HK$500 welcome cashback vs HK$100 Octopus top-up bonus can be incorrectly treated as equivalent because object arrays are converted to `[object Object]`.

4. **Category inference may reverse the meaning of source text.** A sentence such as "Even insurance payments earn 1.2% cashback" may mean insurance is included in the general base rate. It must not automatically become `insurance category rate = 1.2%`.

5. **Legacy spreadsheet values remain published even when newer official claims exist.** Explorer's annual fee is one confirmed example.

6. Reward earning, reward conversion, reward valuation, and effective return are currently too flattened.

7. Manual corrections and review decisions do not yet have a durable recrawl-safe identity and override layer.

### 2. New PM Feedback (product hypothesis · not verified facts)

**A. Cashback cards** — generally straightforward. 1.2% cashback can be stored and calculated directly as a normalized cashback rate.

**B. Points cards** — require a conversion chain:
`card spending → card reward points → airline miles or another reward currency → estimated HKD value → calculated effective reward percentage.`

**C. Asia Miles valuation** — PM suggests HK$0.10–HK$0.16 per Asia Mile. Treat as analytical assumption, not issuer rule.

**D. HSBC optimized rewards** — PM suggests:
- HSBC Premier Mastercard / Gold Card: approximately 2.4%
- HSBC Visa Signature: approximately 3.6%

**Must NOT auto-become unconditional base reward rates.** Treat as potential `optimized_selected_category_rate` until verified against official conditions, caps, registration, category-selection requirements.

### 3. Stage 1A Implementation Scope

#### A. Fix earn-rate aggregation

Update `computeKeyDimension` so earn-rate claims are separated by essential formula dimensions. At minimum distinguish: `simple_percent`, `points_per_hkd`, `hkd_per_point`, `miles_per_hkd`, other existing formula types. Also distinguish reward currency when necessary.

Blue Cash's 1.2% cashback and HK$6=1 mile must NOT enter the same cross-check group.

Correct grouping does NOT automatically authorize publication.

#### B. Fix structured-array comparison

Replace the current `String(object)` array comparison. Do NOT implement naïve raw JSON equality only.

Build normalized structured comparison that:
1. normalizes field names and numeric representations
2. compares objects by semantic component identity when available
3. ignores array ordering
4. distinguishes: same value / one source more complete / real numeric conflict / additional component or enrichment
5. does NOT treat missing optional fields as automatic contradiction
6. preserves all original payloads

Reusable for Stage 2 welcome-offer components.

#### C. Add inferred-category publication gate

A category-specific earn-rate claim must NOT auto-publish when ALL of:
- supported by only one source
- category is inferred from an example, inclusion statement, or counterexample
- there are multiple claims describing the same rate as a general base rate
- there is no explicit source condition limiting the rate to that category

Risky language:
- **English**: even, including, such as, for example, also eligible, as well
- **Chinese**: 如, 例如, 即使, 甚至, 包括, 連, 亦, 都有, 均可

Required behavior:
- preserve source claim
- do NOT auto-materialize the category rule
- create a review task
- allow reviewer to reject or reclassify the claim
- store a reason and reviewer email
- keep full source provenance

Blue Cash specifics:
- 1.2% must publish as base spending cashback
- mrmiles insurance claim `6db31629` must be rejected through normal review
- no active calculator rule should remain for `insurance = 1.2%`

Correct representation: one base-spend rule + optional note that insurance is not excluded. NOT a special insurance earn-rate rule.

#### D. Add alternate-reward-mode publication gate

A second formula type must NOT auto-publish merely because grouping is now correct.

For a single-source alternate mode such as `HK$6 = 1 Asia Mile`:
- preserve as candidate claim
- create candidate rule or review candidate
- mark inactive for calculator use
- create review task
- require official verification or reviewer approval before publication
- do NOT add UI mode toggle yet

Distinguish: default cashback mode, selectable reward mode, points conversion, miles transfer, promotional mode, third-party interpretation.

#### E. Materialize annual fees safely

Do NOT select the first positive official number blindly.

Annual-fee claims must first be classified:

- `cardholder_type`: primary | supplementary | unknown
- `fee_kind`: standard_annual_fee | first_year_fee | fee_waiver | membership_fee | unknown
- `effective_scope`: current | historical | unknown

Only `primary + standard_annual_fee + current` may update `cards.annual_fee_hkd`.

First-year waiver of HK$0 must be modeled as a waiver, NOT a conflicting standard annual fee.

**Publication policy**:
1. Current official source supports exact primary standard annual fee → publish provisionally, preserve lower-authority conflicts, create review task, mark needs_review when conflict remains.
2. Two independent reliable third-party sources agree + no official source → provisional candidate, require review.
3. No authoritative evidence → do NOT replace existing value automatically, create review task.

**Explorer expected**:
- replace stale HK$1,800 seed with supported HK$2,200 official value
- mark provisional if conflict remains
- preserve HK$9,500 outlier for investigation (do NOT auto-reject)
- investigate whether it refers to another product, supplementary card, contaminated table, or extraction error

#### F. Fix reward-currency display

Expose structured display object:

```
rewardCurrency:
  slug: amex_membership_rewards
  displayNameEn: Membership Rewards Points
  displayNameZh: ...
  displayAbbreviation: MR
```

UI shows `Membership Rewards Points (MR)` not `amex_membership_rewards` or unexplained `MR`.

Do NOT falsely label an unverified reward program relationship. Full `reward_programs` model stays Stage 2.

#### G. Add controlled publication states

Explicit distinction:
- active published rule
- provisional published rule
- candidate
- reviewer approved
- reviewer rejected
- **legacy unverified**

**Critical**: Do NOT migrate historical records to `auto` by default. Existing legacy spreadsheet values and historical materialized rules have not passed the new authority policy. Migration defaults must use `legacy_unverified` not `auto`.

Legacy rules may remain visible or calculator-active where necessary for backward compat, but system must NOT falsely claim they were auto-verified.

Suggested states:
- legacy_unverified
- auto
- provisional_pending_review
- provisional_conflict_pending_review
- candidate
- reviewer_approved
- reviewer_rejected

#### H. Add dry-run safety

All Stage 1A materialization commands default to dry-run. Writing requires explicit flags:
- `--enable-write`
- card allowlist
- `--print-diff`
- `--max-write-count`

Do NOT allow an accidental Stage 1A command to update all cards.

### 4. Reward Normalization Foundations

Do NOT build the full calculator scenario engine. Establish correct conceptual/typed boundaries.

#### A. Four layers separated

1. **Raw earning rule** — objective sourced fact (1.2% cashback; HK$5 earns 1 MR; HK$6 earns 1 mile)
2. **Objective conversion rule** — sourced program fact (X MR → Y Asia Miles; min transfer; fee; increment; promo bonus; effective dates)
3. **Subjective valuation assumption** — analytical (1 Asia Mile = HK$0.10; high case HK$0.16). NOT issuer facts.
4. **Derived effective return** — earning × conversion × valuation. Do NOT permanently store as unconditional card fact without explicit assumptions/scenario.

#### B. Typed ratio normalization

Do NOT normalize ratios by comparing numeric size. `if from >= to, assume from is spending` is invalid.

Direction must come from explicit unit roles.

Use typed structures:

```
spend: { amount: 6, currency: HKD }
reward: { amount: 1, currency: Asia Miles }
```

or:

```
from_reward: { amount: 1500, currency: MR }
to_reward: { amount: 540, currency: Asia Miles }
```

Examples that must preserve direction and unit types:
- HK$6 → 1 mile
- 1,500 MR → 540 Asia Miles
- HK$1 → 2 points

Equivalent display forms normalize to same math representation only when unit roles are known.

#### C. Objective vs subjective

Do NOT migrate historical `base_value_hkd` into a newly trusted default valuation without provenance. Mark them `legacy_unverified_valuation`.

For now:
- preserve legacy calculator behavior only where required
- clearly label estimated HKD values as assumptions
- do NOT present them as issuer rules
- design interface for future configurable Asia Miles valuation range
- do NOT build user valuation profiles in Stage 1A

### 5. HSBC Reward Audit — Design and Evidence Only

Do NOT hardcode 2.4% or 3.6% during Stage 1A.

Inspect existing repo data and current official evidence for:
- HSBC Premier Mastercard
- HSBC Gold Card (**note**: repo has `hsbc-red`, `hsbc-everymile-credit-card`, `hsbc-visa-signature-card`, `hsbc-premier-mastercard`. Confirm which "Gold Card" PM means. If not in repo, note as such.)
- HSBC Visa Signature

For each card identify:
1. unconditional base reward
2. selected-category bonus
3. eligible categories
4. category-selection requirement
5. registration/activation requirement
6. selection period
7. spending cap
8. reward cap
9. non-selected-category behavior
10. maximum optimized reward
11. whether 2.4% or 3.6% applies universally / only to selected / only under caps / only after registration / only for tiers

Return evidence showing whether PM's hypothesized rates are accurate.

Design (do NOT implement) future calculator scenarios:
- base
- user-selected category
- optimized category
- non-qualifying transaction

Implement full scenario engine ONLY IF the required code change is extremely small and isolated. Otherwise defer to Stage 3.

### 6. Persistent Rule Identity — Design Now, Implement in Stage 1B

Do NOT implement full identity/override migration in Stage 1A. Stage 1A focuses on deterministic fixes and canary output.

Design (for Stage 1B) with these requirements:

**A. Persistent identity**: Use immutable `rule_identity_id`. Do NOT rely only on materialized row UUID / card slug / fully derived logical key. Use immutable `card_id`. Identity must survive recrawl, re-materialization, row recreation, category correction, effective-date enrichment, source-priority changes, reviewer edits.

**B. Stable scope**: Include enough stable scope to avoid merging different rules (universal vs new-customer; permanent vs campaign; primary vs supplementary; default cashback vs selectable miles mode). Do NOT make every mutable extracted field part of identity. Do NOT make identity so broad that permanent and promotional rules merge.

**C. Safe migration**: Do NOT create duplicate identities then bind via unordered `LIMIT 1`. Preferred:
- one existing legacy rule receives one identity
- mark it `legacy_unreconciled`
- preserve original reward-rule ID in identity audit metadata
- do NOT auto-merge identities during migration
- reconciliation through explicit matcher/reviewer actions later

**D. Reversible merge and split**: Must NOT require DB restore. Design audit/event model:

```
rule_identity_events:
  event_type
  source_identity_ids
  target_identity_ids
  actor
  reason
  created_at
  reversed_by_event_id
```

Full merge/split UI may wait; data model must allow reversal + audit.

**E. Overrides**: Eventually bind to `rule_identity_id + field_path + version scope where needed`. Do NOT bind only to mutable materialized row IDs. Use field-specific comparison policies, NOT a universal 5% threshold.

### 7. Candidate vs Published Data

Keep discovery coverage separate from calculator-active rules.

**Exclusions**:
- Discovery: union all candidates
- Published: current official evidence OR two independent reliable sources OR reviewer approval
- Single low-authority third-party exclusion must NOT automatically affect calculator
- **Stage 1A**: do NOT re-evaluate all existing exclusions. Preserve current behavior. Defer to field-policy stage.

**Alternate reward modes**: Single third-party alt mode = candidate, NOT in calculator.

**Welcome offers**: Stage 1A must NOT materialize. Do NOT build temporary structure.

### 8. Canary Requirements

Only run: **Amex Explorer + Amex Blue Cash**. Do NOT full-DB sweep.

**Blue Cash expected**:
- active base-spend cashback rule = 1.2%
- NO active insurance-specific 1.2% rule
- incorrect mrmiles insurance claim retained as **rejected provenance**
- alternate HK$6=1 mile rule remains **inactive candidate** unless officially verified
- calculator uses base 1.2% for applicable transactions
- welcome-offer table remains untouched

**Explorer expected**:
- reward currency displays as Membership Rewards Points (MR)
- annual fee updates from stale HK$1,800 to supported current HK$2,200 only through explicit authority logic
- unresolved outlier claims remain visible
- field marked provisional/needs_review where appropriate
- no welcome-offer materialization

**Human-reviewed fixtures**: Do NOT use current claim counts as truth. For Explorer welcome, do NOT assert "exactly three envelopes" or "at least five components" until human-reviewed fixture exists. Blue Cash HK$500 + HK$100 usable later as first Stage 2 structural fixture.

### 9. Required Stage 1A Tests

1. object-array normalized comparison
2. formula-type grouping
3. reward-currency grouping
4. inferred-category blocking
5. Blue Cash insurance claim rejection
6. alternate-mode candidate gating
7. annual-fee classification (standard fee / waiver / supplementary fee / historical fee)
8. annual-fee provisional publication
9. legacy data defaulting to `legacy_unverified`
10. typed directional ratio normalization
11. reward-currency display
12. dry-run protections
13. card allowlist
14. max-write-count protection
15. before/after audit diff

### 10. Implementation Order

**Stage 1A**:
- aggregator fixes
- normalized structured comparison
- inferred-category gate
- alternate-mode candidate gate
- annual-fee classification and provisional publication
- reward-currency display
- legacy-unverified publication states
- dry-run tooling
- Explorer and Blue Cash canaries
- reward normalization audit
- HSBC evidence audit

**Stage 1B** (only after Stage 1A approval): persistent rule identities, deterministic legacy backfill, reviewer overrides, stale override detection, reversible identity merge/split events, durable review workflow.

**Stage 2**: welcome-offer envelope + flexible components; promotion channels; customer segments; effective dates + versions; reward programs; objective reward conversions; calculator conversion chain.

**Stage 3**: field-level authority engine; MoneyHero-assisted coverage discovery; source-specific trust policies; candidate vs published exclusions; expired campaigns; HSBC scenario-based optimized rewards; controlled issuer-level backfill.

### 11. Required Output After Implementation

Return:
1. Files changed
2. Database migrations changed
3. Explanation of each code change
4. Explorer before/after diff
5. Blue Cash before/after diff
6. Source claims rejected, retained, or converted to candidates
7. Review tasks created
8. Tests added and exact test results
9. Dry-run output
10. Write-run output for the two allowlisted cards
11. HSBC reward audit: verified base rate, verified optimized rate, conditions, caps, source evidence, whether 2.4% / 3.6% accurate
12. Amex reward normalization audit: raw MR earning rule, verified MR→Asia Miles conversion, effective dates, separation from HK$0.10–HK$0.16 valuation assumption
13. Remaining limitations
14. Recommendation on whether Stage 1B should begin

### 12. Blocking Rules

Do NOT:
- run full database
- materialize welcome offers
- build full valuation profiles
- hardcode HSBC 2.4% or 3.6%
- treat Asia Miles HKD value as issuer fact
- normalize ratios based on numeric size
- mark legacy data as `auto`
- auto-publish single-source alternate modes
- auto-publish inferred category rules from example language
- silently resolve material conflicts
- bind future overrides only to regenerated row IDs
- use nondeterministic `LIMIT 1` identity backfills

**Stop after delivering Stage 1A results and wait for approval before Stage 1B.**

---

## Suggested File Layout (implementer's discretion)

Directional guidance · not a hard constraint. Feel free to reshape.

- `drizzle/migrations/0014_publication_states.sql` — reward_rules.publish_authority + is_active_for_calculator + cards.annual_fee_publish_authority + review_tasks type widening
- `src/lib/normalize/` — numeric / percentage / date / typed-ratio normalization + tests
- `src/lib/normalize/structured-compare.ts` — the object-array deep compare (§3B)
- `src/lib/extraction/annual-fee-classify.ts` — cardholder_type + fee_kind + effective_scope classifier
- `src/lib/extraction/materializer/` — split existing monolith into dispatcher + per-claim-type writers
  - `dispatcher.ts`
  - `earn-rate-writer.ts` (with inferred-category + alt-mode gates)
  - `exclusion-writer.ts` (unchanged behavior · Stage 1A defer)
  - `annual-fee-writer.ts` (new)
  - `cap-stitch.ts` (existing logic moved)
- `src/lib/extraction/inferred-category-gate.ts` — deterministic pattern check (EN + ZH)
- `src/lib/extraction/alt-mode-gate.ts` — single-source alt-formula check
- `src/lib/extraction/prompt.ts` — bump to `p2-v4` · add anti-inclusion guard
- `src/lib/extraction/aggregator.ts` — `computeKeyDimension` earn_rate change + `valuesAgree` uses new structured-compare
- `src/lib/calculator/resolved-rule.ts` — `rewardCurrency: {slug, displayNameEn, displayNameZh, displayAbbreviation}` object
- 3 mapRow copies — return the new object
- `src/app/(admin)/calculator-test/CalculatorTestClient.tsx:853` — render display object
- `src/app/(admin)/review/**` — new `reject_claim(claim_id, reason, reviewer_email)` action
- `scripts/materialize-canary.ts` — new CLI with `--dry-run` default, `--enable-write`, `--card-slug allowlist`, `--max-write-count`, `--print-diff`
- `scripts/audit-diff.ts` — before/after snapshot per canary card
- `test/fixtures/blue-cash-stage-1a-expected.yaml`, `test/fixtures/explorer-stage-1a-expected.yaml` — human-reviewed (see §8)
- `docs/decisions.md` — append D24 (aggregator formula_type split + structured compare), D25 (annual_fee authority policy), D26 (inferred-category gate), D27 (alt-mode gate), D28 (publication states + legacy_unverified default)

## Non-goals for Stage 1A (explicit)

- Do NOT create `rule_identities` or `reviewer_overrides` tables · Stage 1B
- Do NOT create `welcome_offers` / `welcome_offer_components` · Stage 2
- Do NOT create `reward_programs` / `reward_conversions` / `currency_valuations` · Stage 2
- Do NOT touch existing xchk__ exclusion rules (behavior preserved)
- Do NOT touch existing multi-cap caps machinery (P17 stays intact)
- Do NOT touch YAML seed rules on cards outside the canary allowlist
- Do NOT re-run p3:run / p4:aggregate / p7:materialize on non-canary cards
- Do NOT bump PROMPT_VERSION beyond p2-v4 (Stage 2/3 may do further bumps)

## Known-safe idempotent restart points

If session interrupted mid-implementation, safe to resume from:
1. After migration 0014 applied · schema is queryable
2. After aggregator/valuesAgree/computeKeyDimension change · `pnpm test` should pass
3. After prompt v4 · re-run p3 on canary cards only
4. After materializer split · dry-run canary
5. After canary dry-run PM-verified · then --enable-write
