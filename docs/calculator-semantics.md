# Calculator Semantics

This document is the source of truth for what `calculate()` does given an input transaction and a card's rules. Code must match this doc; when they disagree, fix the code (or update this doc with the *why*).

Companion to:
- [prd.md §8](./prd.md) — high-level algorithm description.
- Implementation lives in `src/lib/calculator/` (entry: `calculate.ts`).

Updated as of: **M7** (merchant resolver — category confidence in result).

---

## 1. Purpose

Given:
- A card (identified by `cardId`)
- A list of that card's `ResolvedRule`s
- One `TransactionContext`
- An optional `UserCardContext` (activations, cap usage)

Return a `RewardResult` containing:
- Total reward value in HKD
- Per-rule breakdown
- Confidence level (high / medium / low)
- Source IDs supporting the result
- Caveats (string list)

The calculator is **pure** and **deterministic**. No DB access, no LLM, no clock reads (other than what the caller passes in `txn.transactionDate`).

---

## 2. Inputs

### 2.1 `TransactionContext`

```ts
{
  amountHkd: number               // required, non-negative
  merchantName?: string           // resolved upstream by the caller
  categorySlug?: string           // canonical taxonomy slug
  categoryResolutionConfidence?: number  // M7 — from MerchantResolver
  currency?: string               // ISO code
  countryRegion?: "HK" | "MAINLAND_CHINA" | "MACAU" | "OVERSEAS" | "UNKNOWN"
  isOnline?: boolean
  isForeignCurrency?: boolean
  transactionDate: string         // ISO yyyy-mm-dd
}
```

If `categorySlug` is populated, it may have come from the merchant resolver (in which case `categoryResolutionConfidence` should also be set) OR from a trusted upstream source (user-confirmed, structured input) — in which case `categoryResolutionConfidence` is left undefined and the calculator treats it as 1.0.

**Derived fields the calculator computes internally**:

- `isOverseas := countryRegion !== "HK"` when `countryRegion` is supplied and not `"UNKNOWN"`. Otherwise `undefined`.

The calculator does NOT derive `isOnline` or `isForeignCurrency`; those must come from the caller (or, in M5+, from the merchant resolver / channel detector).

### 2.2 `UserCardContext` (optional)

```ts
{
  cardId: string
  selectedCategorySlugs?: string[]    // M5+ — for user-selected category bonus
  activatedCampaignIds?: string[]     // M10 — campaign opt-in
  activatedRuleIds?: string[]         // M3 — rule-level opt-in (activation/registration)
  capUsage?: Record<string, number>   // see §6
}
```

If absent, the calculator treats it as `{}` — no rules pre-activated, no caps used.

### 2.3 `ResolvedRule`

The seam between DB schema and calculator. Mapping from DB row to ResolvedRule happens outside the calculator (M6 onward — the YAML import + DB-load wrapper produces these). The calculator sees only `ResolvedRule`.

Key fields and their meaning:

| Field | Meaning |
|---|---|
| `status` | `draft` / `approved` / `archived`. Calculator uses **approved only**. |
| `formula` | Discriminated union (PRD §7). See §5. |
| `rewardCurrencySlug` | The currency this rule produces (e.g. `hkd_cashback`, `asia_miles`). |
| `rewardCurrencyValueHkd` | Multiplier: reward units → HKD. |
| `categorySlug` / `isOnline` / `isOverseas` / `isForeignCurrency` | Flattened conditions. `null` = "applies regardless of this dimension". |
| `requiresActivation` / `requiresRegistration` | Either flag set → rule is gated on `activatedRuleIds`. |
| `accrualKey` | Key into `capUsage` for tiered formulas to read "spend already accumulated this period". Defaults to `ruleId`. |
| `cap` | `null` if no hard cap; otherwise `{ usageKey, basis, period, amountHkd?, rewardAmount? }`. |
| `ruleType` | One of `base_earn`, `category_bonus`, `online_bonus`, `overseas_bonus`, `foreign_currency_bonus`, `merchant_bonus`, `campaign_bonus`, `exclusion`, `fee_waiver`, `other`. |
| `appliesTo` | For `exclusion` rules: the rule_types this exclusion disables. `null` otherwise. |
| `stackingPolicy` | `additive` (default) / `max_only_in_group` / `replaces_base`. |
| `exclusiveGroup` | Rules sharing a group key obey one policy together. `null` = each rule is its own group. |
| `priority` | Lower = iterated first (matters for `replaces_base`). Default 100. |
| `sourceId` | Required if `status === "approved"` (PRD §5 principle 1). |
| `confidenceScore` | 0..1 from the source claim. |

---

## 3. Outputs

### 3.1 `RewardResult`

```ts
{
  cardId: string
  rewardValueHkd: number                  // sum of breakdown.rewardHkd
  breakdown: RewardBreakdownItem[]
  confidence: "high" | "medium" | "low"
  confidenceScore: number                 // 0..1
  caveats: string[]                       // M5+ populated
  sourceIds: string[]                     // unique, supporting sources
}
```

### 3.2 `RewardBreakdownItem`

One per rule that survived all filters and contributed non-zero reward.

```ts
{
  ruleId: string
  ruleName: string
  ruleType: string
  rewardCurrencySlug: string
  rewardUnits: number          // in rule's currency (miles, points, HKD)
  rewardHkd: number            // = rewardUnits * rule.rewardCurrencyValueHkd
  sourceId: string | null
  confidenceScore: number
}
```

Exclusion rules NEVER appear in breakdown. Rules whose formula evaluated to 0 reward units after caps are also suppressed.

---

## 4. Algorithm

The calculator implements PRD §8.2 in 8 sequential steps. Status legend: ✅ implemented, 🚧 partial, ⏳ deferred to a later milestone.

```
Step 1  Merchant resolver        ✅ caller does it; passes confidence on txn
Step 2  Filter approved + date   🚧 status filter ✅; date range filter ⏳ next
Step 3  Match conditions         ✅
Step 3b Activation gate          ✅
Step 4  Exclusions               ✅
Step 5  Stacking                 ✅
Step 6  Hard cap                 ✅ (basis='spending' only; 'reward'/'transaction_count' throw)
Step 6b Tiered accrual feed      ✅
Step 7  HKD conversion           ✅
Step 8  Confidence aggregation   ✅ folds in categoryResolutionConfidence
```

### 4.1 Step 2 — Status filter

Drop any rule where `status !== "approved"`. (Date-range filter `effective_start ≤ txn.date ≤ effective_end` arrives in M5.)

### 4.2 Step 3 — Match conditions

A rule applies to a transaction iff every non-null condition on the rule matches the corresponding (possibly-derived) value on the transaction.

| Rule field | Match rule |
|---|---|
| `rule.categorySlug` | non-null → require `txn.categorySlug === rule.categorySlug` |
| `rule.isOnline` | non-null → require `txn.isOnline === rule.isOnline` |
| `rule.isOverseas` | non-null → require `deriveIsOverseas(txn) === rule.isOverseas` |
| `rule.isForeignCurrency` | non-null → require `txn.isForeignCurrency === rule.isForeignCurrency` |

Critical principle: **unknown txn value does NOT satisfy a non-null rule requirement**. If a rule says `isOnline=true` and the caller didn't tell us whether the transaction is online, we skip the bonus. Under-credit beats over-credit.

`deriveIsOverseas(txn)` returns `undefined` if `txn.countryRegion` is missing or `"UNKNOWN"`, else `(countryRegion !== "HK")`.

### 4.3 Step 3b — Activation gate

After matching, if `rule.requiresActivation || rule.requiresRegistration`, the rule is skipped unless `rule.ruleId ∈ activatedRuleIds`.

Both flags have the same calculator behavior; the distinction is semantic (data layer telling you "activation of card" vs "registration for a bonus campaign").

### 4.4 Step 4 — Exclusions

After matching + activation:

1. Partition matched rules into `{ exclusions, regulars }` by `ruleType === "exclusion"`.
2. Build a `disabled: Set<ruleId>` by iterating exclusions:
   - For each exclusion `ex` with non-empty `appliesTo`:
     - For each regular `c`: if `c.ruleType ∈ ex.appliesTo`, add `c.ruleId` to `disabled`.
3. Drop all exclusions (they never produce reward).
4. Keep regulars whose ruleId is not in `disabled`.

**PRD §8.4 canonical case**: tax exclusion with `categorySlug='tax_government'` and `appliesTo=['category_bonus', 'online_bonus', 'overseas_bonus', 'foreign_currency_bonus', 'campaign_bonus', 'merchant_bonus']`. Note `base_earn` is intentionally NOT in `appliesTo`, so tax payments still earn base.

Misconfigured exclusion (`appliesTo` is `null` or empty array) → skipped silently by the calculator. Catching this is the import/seed layer's job (M6 onward — `validate:data` flags exclusion rules without `appliesTo`).

### 4.5 Step 5 — Stacking

For each surviving candidate, compute its reward value (steps 6, 6b, 7), producing a `ResolvedCandidate`. Then group and resolve:

1. Group candidates by `exclusiveGroup ?? "__rule__" + ruleId`. Rules without an explicit group form a singleton group.
2. Order groups by ascending minimum-priority-within-group. (Ties: stable order.)
3. For each group in order, apply its policy (taken from the first candidate in the group; all candidates in a group must share the same policy):

| Policy | Behavior |
|---|---|
| `additive` | Append all group candidates to selected. |
| `max_only_in_group` | Append only the candidate with the highest `rewardHkd`. Tiebreak: lower `priority` wins. |
| `replaces_base` | Drop all `base_earn` candidates currently in selected, then append this group's candidates. |

`replaces_base` depends on iteration order — base earn must already be in selected when the replacer group runs. That's why we sort groups by priority and put base_earn at priority 100 (high number = late) and replacers at higher numbers still (e.g., 150). Cards that need a replacer must set its priority above base_earn's.

### 4.6 Step 6 — Hard cap

When `rule.cap` is non-null and `cap.basis === "spending"` and `cap.amountHkd !== null`:

```
used      = capUsage[cap.usageKey] ?? 0
remaining = max(0, cap.amountHkd - used)
eligibleSpend = min(txn.amountHkd, remaining)
```

If `remaining === 0`, the rule contributes 0 reward.

`cap.basis ∈ { "reward", "transaction_count" }` throws today — added when a real card demands them (probably in M9 or via Phase 2).

`cap.period` is informational. The caller is responsible for keying `capUsage` such that the period's already-accrued spend is reflected. Convention: when the rule's cap or accrual is monthly, the caller should key with `<ruleId>__<YYYY-MM>` — so when the month rolls over, lookups naturally start at 0 again.

### 4.7 Step 6b — Tiered accrual feed

For `tiered_percent` and `tiered_points` formulas, the calculator passes `accrualUsedHkd = capUsage[rule.accrualKey] ?? 0` to `applyFormula`. `accrualKey` defaults to `ruleId` but may be a shared group key for M4+ grouped tiers.

The tier walk:

```
cursor    = accrualUsedHkd
remaining = eligibleSpend     // after hard cap from step 6, if any
reward    = 0
for tier in tiers:
  if remaining <= 0: break
  tierTop   = tier.maxAmountHkd ?? +Inf
  if cursor >= tierTop: continue
  tierStart = max(cursor, tier.minAmountHkd)
  spendInTier = min(remaining, tierTop - tierStart)
  if spendInTier <= 0: continue
  reward    += tierRate(tier, spendInTier)       // = spendInTier * tier.rate
                                                  //   or (spendInTier / tier.perHkd) * tier.points
  remaining -= spendInTier
  cursor     = tierStart + spendInTier
```

Cross-period reset is the **caller's** responsibility — the caller passes `accrualUsedHkd = 0` when a new accrual period begins.

### 4.8 Step 7 — HKD conversion

```
rewardHkd = rewardUnits * rule.rewardCurrencyValueHkd
```

`rewardCurrencyValueHkd` comes from `reward_currencies.base_value_hkd` at mapping time. Examples:
- `hkd_cashback`: 1.0
- `asia_miles`: 0.10 (M4 conservative estimate)
- `hsbc_reward_cash`: 1.0 (when added)
- `citi_points`: TBD

Currency revaluations are handled by editing the row and re-running the seed/import. Time-travel valuation (rewards earned in 2025 at 0.10 must still be valued at 0.10 even if today's value is 0.08) is a Layer 6 / Phase 2 concern — not in MVP.

### 4.9 Step 8 — Confidence aggregation

```
ruleMinConf =
  1.0                              if breakdown is empty
  min(b.confidenceScore for b in breakdown)  otherwise

categoryConf = txn.categoryResolutionConfidence ?? 1.0
confidenceScore = min(ruleMinConf, categoryConf)

confidenceLevel =
  "high"   if confidenceScore >= 0.85
  "medium" if confidenceScore >= 0.60
  "low"    otherwise
```

When the caller resolved the category via `MerchantResolver` and got back a low confidence (e.g., 0.3 for the unknown-merchant fallback), that bound dominates the final result — even a 0.95-confidence rule's reward is reported with overall confidence `low`. This is intentional: if we're unsure what category the txn is, we're unsure the rule even applies.

---

## 5. Reward formulas (current variants)

| Type | Payload | applyFormula behavior |
|---|---|---|
| `simple_percent` | `{ rate }` | `amountHkd × rate` |
| `points_per_hkd` | `{ points, perHkd, currencySlug }` | `(amountHkd / perHkd) × points` |
| `tiered_percent` | `{ accrualPeriod, tiers[] }` | Tier walk (§4.7) using `rate`. |
| `tiered_points` | `{ accrualPeriod, currencySlug, tiers[] }` | Tier walk using `points / perHkd` per tier. |
| `no_reward` | `{ reason? }` | Returns 0 — used by exclusion rules' formula. |

Future variants (PRD §7): `fixed_bonus`, `first_n_transactions_bonus`, `custom_note`. Add when a real card requires them.

---

## 6. `capUsage` keying convention

`capUsage` is a flat `Record<string, number>`. Keys are produced by the caller; the calculator just reads.

Conventions adopted in MVP:

- **Single-rule cap, single period**: key = `rule.cap.usageKey` (which defaults to `rule.ruleId`). Caller has to figure out "spent under this rule this period" externally.
- **Tiered accrual, no hard cap**: key = `rule.accrualKey` (= `rule.ruleId` by default).
- **Period rollover**: caller scopes keys by period suffix, e.g. `hang-seng-mpower__tiered_monthly__2026-06`. When July begins, the lookup naturally returns `undefined → 0`.
- **Shared cap across rules (M4+)**: a group of rules share `rule.cap.usageKey = "some-group-key"`. Calculator reads once per rule but the underlying number reflects the group.

The wrapper that loads rules from DB + computes period-scoped keys is built in M5 (date range filter) and refined in Phase 2 (real user txn history). The pure calculator never invents keys.

---

## 7. Invariants

These hold by construction. If you break one, you have a bug.

1. **Approved rules without a source** must not exist. Enforced at Zod + DB constraint (M5 will add DB CHECK constraint).
2. **Exclusion rules never appear in `breakdown`**.
3. **`rewardHkd === rewardUnits × rewardCurrencyValueHkd`** exactly for every breakdown item (no rounding inside the calculator).
4. **`sum(breakdown.rewardHkd) === rewardValueHkd`** exactly.
5. **`confidenceScore` is the minimum** over all contributing breakdown items, or `1.0` when breakdown is empty.
6. **Calculator is deterministic** — same inputs always produce the same output.
7. **Calculator never reads the wall clock**. Time comes from `txn.transactionDate`.
8. **`sourceIds` is unique and non-null** — only sources that supported at least one selected rule appear.

---

## 8. Edge cases

| Case | Behavior |
|---|---|
| No rules supplied | `rewardValueHkd=0`, empty breakdown, confidence `high` (no uncertainty). |
| `amountHkd === 0` | Every rule yields 0 → empty breakdown, confidence `high`. |
| Rule with `null` on every condition + no cap | Applies to every transaction. (Citi Cash Back M1 base earn is exactly this.) |
| Multiple exclusions matching | Their `appliesTo` sets are unioned in effect (`disabled = ∪ appliesTo`). |
| Exclusion targets itself (`exclusion` ∈ `appliesTo`) | Ignored — exclusion rules are removed before disabling logic checks anyway. |
| `max_only_in_group` with one candidate | Returns that candidate unchanged. |
| `replaces_base` group ordering | Higher `priority` (larger number) iterated later → base earn is replaced. Set replacer priority > base earn's priority. |
| Cap fully consumed (`remaining === 0`) | Rule contributes 0, no breakdown entry. |
| `cap.amountHkd === null` with `basis="spending"` | Cap is treated as absent (no limit). |
| `tier.maxAmountHkd === null` | Open-ended top — applies to all remaining spend. |
| `confidenceScore` of a single contributing rule is 0.59 | Result confidence = `"low"`. |

---

## 9. What is NOT in the calculator (deferred)

- **Merchant resolver** (`merchantName → categorySlug`) — M5/M7.
- **Date-range filter** (`effective_start ≤ txn.date ≤ effective_end`) — M5.
- **`cap.basis ∈ { reward, transaction_count }`** — added when a real card needs them.
- **Caveat synthesis** (e.g., "this merchant's category is uncertain", "rule is approaching cap") — M14 when the calculator-test page renders them.
- **Stacking against caps** — if multiple rules share a `cap.usageKey`, only the read happens correctly today; the calculator does NOT update `capUsage` between rules in the same calculation. That responsibility lives outside the calculator (the caller advances cap state in user_card_caps_state).
- **Reward valuation time-travel** — historical txn at historical valuation. Layer 6 / Phase 2.
- **Multi-card ranking** — `rankCards` is a thin wrapper that calls `calculate` per card and sorts. Lives in M14 (calculator test page).

---

## 10. How this doc changes

Whenever you change calculator behavior:

1. Update the relevant section here.
2. If a new step is added, update §4 + the step legend.
3. If a new formula variant lands, update §5.
4. If a new cap key convention appears, update §6.
5. Append an entry to [decisions.md](./decisions.md) explaining the *why*.

If code disagrees with this doc and you're not sure who's right: trust this doc until you can articulate why it should change.
