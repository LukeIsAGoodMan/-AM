# Stage 1A — HSBC Reward Audit (design + evidence only)

**No rate was hardcoded.** Per §5/§12 this is an evidence audit of existing
repo data + current claims; nothing about 2.4% / 3.6% was written into the DB.

## Cards in scope

| PM's name | In repo? | Repo slug |
|---|---|---|
| HSBC Premier Mastercard | yes | `hsbc-premier-mastercard` |
| HSBC Gold Card | **NO** | — (repo has red / everymile / visa-signature / premier-mastercard; there is no "Gold Card". PM likely means the Premier tier or a product we haven't ingested.) |
| HSBC Visa Signature | yes | `hsbc-visa-signature-card` |

## What the repo currently models (approved, active rules)

- **hsbc-red** — cashback. base 0.4%; online_local 4%; a merchant 8% bonus; Q3 campaign +2%. No registration/selected-category flags.
- **hsbc-everymile** — miles. base **HK$8 = 1 mile**; designated categories **HK$2 = 1 mile** (+ 0.4% variants); online HK$2 = 1 mile.
- **hsbc-premier-mastercard** — miles. base **HK$25 = 1 mile** only (+ exclusions). No category bonuses materialized.
- **hsbc-visa-signature-card** — 0.4% category bonuses × 3 + exclusions. **No base_earn rule** (data gap).

None of these is 2.4% or 3.6%.

## The 11-point breakdown + evidence

The 2.4% / 3.6% rates come from HSBC's **最紅自主獎賞 "Red Hot Rewards"** self-select program, NOT a base rate. Evidence from live claims:

- Visa Signature: *"Allocate an extra **2.4% RewardCash** to one spending category"*
- Visa Signature: *"合共：**3.6% 回贈 (9X 獎賞錢)**"* and *"只要識得玩「最紅自主獎賞」，本地食肆簽賬可享**高達 3.6%** 回贈 ($2.78/里)"*
- Visa Signature: *"automatically enjoy an exclusive **extra 1.2% RewardCash on all categories** of the Red Hot Rewards"*
- Visa Signature base (unbound): *"…只有 0.4% 回贈 ($25/里)"*
- Premier: *"基本簽賬得 **$25 = 1 Asia Miles**"* (base ≈0.4%-equiv)

| # | dimension | HSBC Visa Signature | HSBC Premier |
|---|---|---|---|
| 1 | unconditional base | **0.4%** ($25/mile) | **HK$25 = 1 mile** (≈0.4%-equiv) |
| 2 | selected-category bonus | +2.4% self-select (6X) + 1.2% VS-exclusive on Red Hot cats | +2.x% self-select (weakly evidenced) |
| 3 | eligible categories | Red Hot Rewards category list (dining/online/overseas/…) | Red Hot list |
| 4 | category-selection requirement | **yes** — self-select 1 category | yes |
| 5 | registration/activation | **yes** — must opt into 最紅自主獎賞 | yes |
| 6 | selection period | per program cycle (quarter/annual — verify) | verify |
| 7 | spending cap | RewardCash cap per selected category (verify) | verify |
| 8 | reward cap | yes (RewardCash cap) | yes |
| 9 | non-selected behaviour | falls back to 0.4% base | 0.4%-equiv base |
| 10 | max optimized | **3.6%** (9X) on the ONE selected local category | ~2.4% (PM hypothesis) |
| 11 | 2.4/3.6 universal? | **NO** — only the selected category, after registration, up to ("高達") | NO |

## Verdict on the PM hypothesis

- **Visa Signature 3.6% — directionally ACCURATE but conditional.** Verified in evidence as `0.4% base (1X) + 2.4% self-select (6X) + 1.2% VS-exclusive (on Red Hot cats) = 3.6% (9X)`, applying to **one self-selected local category** (e.g. dining) **after opting into Red Hot Rewards**, quoted as "高達 (up to)". It is NOT an unconditional base rate.
- **Premier 2.4% — PLAUSIBLE, weakly evidenced.** Premier's base is HK$25 = 1 mile (miles, not cashback); the 2.4% would be its RewardCash self-select optimized rate. Corpus evidence is thin (6 hits). Needs official verification.
- **"HSBC Gold Card"** is not in the repo — flagged for PM to confirm which product is meant.

This exactly matches §2D's caution: treat 2.4% / 3.6% as `optimized_selected_category_rate`, gated by registration + category selection + caps — **not** an unconditional base reward. Modelling the Red Hot Rewards self-select mechanism (a scenario engine) is deferred to **Stage 3** (§5) — the change is not "extremely small and isolated".

## Future calculator scenarios to design (NOT implemented — Stage 3)

- **base**: 0.4% / $25-mile on all spend.
- **user-selected category**: base + Red Hot self-select bonus on the chosen category.
- **optimized category**: the best achievable (3.6% VS / ~2.4% Premier) on one category, registered.
- **non-qualifying transaction**: 0.4% base only (e.g. Alipay/WeChat bind — evidenced at 0.4%).
