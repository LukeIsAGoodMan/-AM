# Stage 1A — Amex Reward Normalization Audit (§4)

Demonstrates the four-layer separation (§4A) on Amex Explorer, and that the
HK$0.10–0.16 Asia Mile valuation is kept as an assumption, never an issuer
fact. Direction of every ratio comes from unit ROLES, never numeric size
(§4B — see `src/lib/normalize/ratio.ts`).

## Layer 1 — Raw earning rule (objective, sourced)

Amex Explorer earns **Membership Rewards (MR) points**. Evidence:

- base: *"Basic Membership Rewards points：3X Membership Rewards points"*
- 5X merchants (incl. Apple): *"5x積分 ($3.6/里)"*
- overseas + airline: *"10.75x積分 ($1.68/里)"* (per-quarter category caps HK$10,000)
- 6X tier: *"6X積分 (相當於 HK$3/里)"*

Typed as spend→reward (roles fixed by the field names, not the magnitudes):

```
spend  { amount: 5,  currency: HKD }   # HK$5 per 3X-point unit at base
reward { amount: N,  currency: amex_membership_rewards }
```

The `$X/里` figures ($3.6/mile, $1.68/mile, HK$6/mile) are **spend-per-mile**
(how much you spend to earn one mile once converted), i.e. a spend→reward
ratio — NOT the value of a mile. Preserving this direction is exactly the
§4B rule; `ratio.ts` never infers it from which number is larger.

## Layer 2 — Objective conversion rule (sourced program fact)

MR → Asia Miles, evidenced in the corpus:

- *"144,000 AE積分 (相當於 8,000 里數)"* → **144,000 MR → 8,000 Asia Miles** (≈ 18 MR : 1 mile as read by the extractor).
- welcome anchor: *"首3個月簽 HK$8,000，賺到 8,000 里數"*; *"簽賬上限 HK$192,000 (可兌換 64,000 里數)"*.

Typed as from→to (direction from roles):

```
from_reward { amount: 144000, currency: amex_membership_rewards }
to_reward   { amount: 8000,   currency: asia_miles }
```

⚠️ The exact ratio (this source reads ~18:1; the commonly-published AE HK rate
is 15:1) needs **official verification** before it becomes a published
conversion. Min-transfer / increments / fees / effective dates are NOT yet
captured — that is the Stage 2 `reward_conversions` model. Stage 1A does NOT
materialize a conversion.

## Layer 3 — Subjective valuation assumption (analytical, NOT issuer fact)

`1 Asia Mile = HK$0.10 (low) – HK$0.16 (high)`. This is a PM analytical
assumption. It must NEVER be stored as an issuer fact. The legacy
`reward_currencies.base_value_hkd` for miles is `legacy_unverified_valuation`
— preserved for backward-compat calculator behaviour but explicitly labelled
an assumption (§4C). Stage 1A does NOT build user valuation profiles; it only
reserves the interface for a future configurable Asia Miles range.

## Layer 4 — Derived effective return (scenario-dependent, NOT stored)

```
effective % = earning (Layer 1) × conversion (Layer 2) × valuation (Layer 3)
```

Example (5X merchant, $3.6/mile spend, 18:1 conversion already folded into the
$/mile figure, HK$0.10–0.16 valuation):

```
1 mile per HK$3.60 spend  ×  HK$0.10–0.16 per mile
  = HK$0.028 – 0.044 reward per HK$1  = 2.8% – 4.4% effective
```

This is a RANGE that depends on the valuation assumption and the spend
scenario. It is deliberately **not** persisted as an unconditional card fact
(§4A #4). The calculator keeps using legacy behaviour only where required; the
range is surfaced as an assumption, not a rule.

## Separation summary

| layer | example | stored as | authority |
|---|---|---|---|
| raw earning | 3X MR base / 5X merchants | earn_rate rule (MR currency) | objective, sourced |
| conversion | 144,000 MR → 8,000 miles | **not yet** (Stage 2) | objective, needs verify |
| valuation | 1 mile = HK$0.10–0.16 | assumption only | **subjective — never issuer fact** |
| effective return | 2.8–4.4% | **not stored** | derived per scenario |

Reward-currency display (§3F): Explorer's MR rules now surface as
**"American Express Membership Rewards (MR)"**, not the raw
`amex_membership_rewards` slug.
