# Known Limits

Things the MVP schema + calculator deliberately *don't* model. Each entry tracks the limit, the workaround (if any), and when we expect to fix it. Filed during the M0–M17 build so future reviewers don't waste time re-discovering them.

Roadmap-tracked items (G1–G4 in [roadmap.md "Known schema gaps"](./roadmap.md#known-schema-gaps-defer-to-phase-2-or-later)) are cross-linked but not duplicated.

---

## Calculator semantics

### L1 — Date range filter not yet implemented in step 2

`effective_start ≤ txn.date ≤ effective_end` is documented in [calculator-semantics §4.1](./calculator-semantics.md) but `calculate()` currently filters by `status='approved'` only. Rules expired in the DB are skipped only because they get `status='archived'` on YAML re-import.

**Workaround**: keep YAML aligned with current offers; re-import after expiry dates pass.
**Fix when**: a real card has overlapping rules with different effective windows that the calculator must disambiguate per txn.

### L2 — Caveat synthesis is presentation-only

`caveats.ts` is invoked by `/calculator-test` and `/projection-test` but not by the simulator's `Projection.caveats` output (which has its own narrower list). A future "explain a ranking" surface (Phase 3 Wallet Mode) should call `synthesizeCaveats()` directly.

**Workaround**: none needed today.
**Fix when**: a non-test page needs explanations.

### L3 — Reward valuation is "current rate, applied always"

A rule that produced miles in 2024 at 0.10 HKD/mile is valued at *today's* rate, not 2024's, when the historical txn is replayed. The calculator reads `rewardCurrencyValueHkd` once at mapping time.

**Workaround**: revalue all historic txns together when a currency's rate changes.
**Fix when**: Layer 6 v2 (Phase 4) or earlier if revaluation drift becomes user-visible. Requires `reward_currency_history` table tracking rate-by-date.

### L4 — Stacking and cap are not jointly updated within one txn

If two rules in the same `exclusive_group` share a `cap.usageKey`, calculator reads the same `capUsage` for both. But it does NOT advance `capUsage` after rule A so rule B sees A's consumption within the same `calculate()` call. The caller must advance state between txns. Documented in [calculator-semantics §9](./calculator-semantics.md).

**Workaround**: stacked rules that share a cap rarely both fire on the same txn (different categories). The simulator advances per-txn correctly.
**Fix when**: a real card requires within-txn cap progression (we haven't found one).

### L5 — `cap.basis ∈ { reward, transaction_count }` throws

See [roadmap G2](./roadmap.md#g2--cap-basis--reward-max-hkd-x-reward-per-period). HSBC Reward+ and some enJoy tiers cap reward (HKD 500/mo of cashback) rather than spending. We approximate as a spending cap today.

**Workaround**: convert `HKD-cap-on-reward / rate` into an equivalent spending cap in YAML. Over-credits at the boundary.
**Fix when**: source extraction (Phase 2) flags a card where the approximation produces material error.

### L6 — `first_n_transactions_bonus` formula not implemented

See [roadmap G4](./roadmap.md#g4--first_n_transactions_bonus-formula-variant). Reserved in the Zod enum, not handled in `applyFormula`.

**Workaround**: model as a regular bonus with a low cap (rough approximation — wrong if txn sizes vary).
**Fix when**: Citi Octopus or similar joins the approved set.

### L7 — Per-rule activation has no timestamp

See [roadmap G1](./roadmap.md#g1--registration--activation-time-window). `activatedRuleIds: string[]` is a boolean per rule; real banks require registration BEFORE the qualifying txn, not just at-some-point.

**Workaround**: callers treat "activated" as "activated at the start of the period being simulated."
**Fix when**: user-domain tables (Layer 7) land. The activation event has a timestamp at that point.

---

## Rules / cards we can't represent today

### L8 — Lucky-draw / sweepstake offers

Some HK cards' welcome offers include "every HKD 1000 spent = 1 entry into a HKD 10,000 lucky draw". This isn't a deterministic reward.

**Workaround**: omit from `welcome_offers.tiers`; note in `welcome_offers.notes` for human reference. Calculator doesn't see it.
**Fix when**: never, unless we add an expected-value column with explicit "this is an EV estimate" flag. Not currently planned.

### L9 — AlipayHK / wallet-binding +1% rider

Several cards give an extra 1% only when the txn was made via AlipayHK / WeChat Pay / Apple Pay. This requires a "payment channel" dimension that doesn't exist on `TransactionContext`.

**Workaround**: model as a regular rule with no channel condition. Over-credits txns made on plastic.
**Fix when**: a `paymentChannel: 'plastic' | 'apple_pay' | 'alipayhk' | 'wechatpay' | 'octopus_card' | ...` field is added to `TransactionContext` + the calculator gains a channel-match check. Phase 2 candidate.

### L10 — Spend tiers gated by *monthly minimum* (HSBC RewardCash multipliers)

HSBC's RewardCash tiers can be "1× base if you spent < HKD 4000 this month, 5× if ≥". This is a per-month aggregate condition, not a per-txn condition. The tiered_percent formula handles per-txn cumulative tiers but not "the tier I'm in depends on what I already spent this month."

**Workaround**: pick the dominant tier based on the user's typical month and model that. Over- or under-credits at month boundaries.
**Fix when**: a `min_period_spend_hkd` field is added to rules + the simulator surfaces "you're in tier X this month" in the projection. Probably Phase 2's responsibility.

### L11 — Co-branded card "earn at partner = special rate"

Cathay Mastercard at Cathay Pacific bookings = 5x miles instead of base. The current schema has `merchant_bonus` rule_type but the resolver doesn't model merchant-card affinity, so the rule fires whenever the category matches — which can over-credit competing OTAs that resolve to the same `travel_airline` category.

**Workaround**: tighten the rule to `categorySlug=travel_airline + isOnline=true` and accept some imprecision.
**Fix when**: `merchant_specific` category + a `merchantSlug` rule condition + resolver returns the merchant slug. Phase 2.

### L12 — Foreign-currency conversion fees

Some cards add a 1.95% FX fee for overseas txns; some waive it. This *reduces* the effective reward but isn't a `RewardFormula` —the calculator only adds, never subtracts. `qualitative_features.no_fx_fee` is a boolean today on the card, used only for narrative display.

**Workaround**: callers comparing overseas rewards across cards should mentally discount cards without `no_fx_fee`. Not surfaced in calculator output.
**Fix when**: net-reward modelling lands. Requires `fee` rule_type + sign in formula payload. Not currently planned.

### L13 — Annual fee waiver tied to spend

`fee_waiver` is reserved as a rule_type but not implemented end-to-end (no annual-cost subtraction in the projection). Today the projection's "total reward" doesn't net out the card's annual fee.

**Workaround**: read `card.annualFeeHkd` separately. The /projection-test page could subtract it inline.
**Fix when**: a "net value" mode lands in `/projection-test`. Small UI change once we commit to showing both.

---

## Ingestion / data pipeline

### L14 — One-source-per-rule limitation (single citation)

`reward_rules.source_id` is a scalar FK, so each rule cites exactly one source. Phase 2 introduces `reward_rule_sources` (m:n) so the multi-source extraction + cross-check flow can attach 2–3 sources per rule.

**Workaround**: pick the highest-priority source. Other sources go in `card.qualitative_features` or get omitted.
**Fix when**: Phase 2 P7 (auto-create reward_rule from approved claim cluster).

### L15 — `source_documents.url` accepts only one URL

A card's T&C might span a landing page + a PDF + an in-app screenshot. Today each becomes a separate `source_documents` row. Linking is the YAML reviewer's responsibility (slugs).

**Workaround**: one row per artifact, grouped by `card_id`.
**Fix when**: never, unless a real workflow demands grouping. Current model works.

### L16 — Edit-form changes don't write back to YAML

`/rules/[slug]/edit` and `/sources/[slug]/edit` write to the DB only. The next `pnpm import:data` reverts them. This is intentional (YAML is source of truth) but easy to forget.

**Workaround**: the edit-form Reminder panel says it. Also banner in /calculator-test could surface "DB is ahead of YAML" warning — TBD.
**Fix when**: never for MVP. Phase 4+ might offer a "diff and write back to YAML" flow.

### L17 — Source URL is not re-checked for liveness

We content-hash on first fetch (`source_documents.content_hash`) but don't re-fetch. If the bank silently updates the page, our extracted_text drifts from reality. Mitigation: re-run `pnpm extract:sources` periodically (manual).

**Workaround**: monthly manual re-extract.
**Fix when**: Phase 4 — re-crawl scheduler.

---

## Admin UI

### L18 — No authentication

`/cards/[slug]/edit`, `/rules/[slug]/edit`, `/sources/[slug]/edit` are unprotected. Internal tool — assume the URL is private. Don't deploy this to a public URL without adding basic auth (see README "If you want a permanent demo URL").

**Workaround**: keep the dev server local, or wrap with a reverse proxy.
**Fix when**: before any public deploy. Probably middleware-based basic auth.

### L19 — `/welcome-offers`, `/campaigns`, `/merchants` admin pages don't exist

Sidebar items exist with `ready: false`. Their underlying tables are populated and queryable via Drizzle Studio + the seed scripts. UI pages are deferred until a real workflow requires them.

**Workaround**: `pnpm db:studio` for ad-hoc browsing.
**Fix when**: post-MVP, when adding a third welcome offer or second campaign creates real friction.

### L20 — Comparison view ("Why this lost") only handles 2 cards

`/calculator-test` lets you pin two cards via the ↔ button. A 3-way compare or a "show all" rule-by-rule grid would be useful but isn't built.

**Workaround**: do two 2-way compares back-to-back.
**Fix when**: a stakeholder asks for it. Not yet.

---

## How this list changes

Append a new entry when:
- You hit a real card the schema can't model AND decide not to fix it now.
- You document a calculator behaviour that's intentionally approximate.
- You add a workaround for a missing field.

Remove an entry only when the underlying limitation is *actually* fixed (not just planned). If a fix lands, link to the commit / migration in the entry's "Fix when" section before deleting.
