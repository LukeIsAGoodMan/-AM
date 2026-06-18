# PRD v3: HK Card Rewards — Foundation Layer + Forward-Compatible Architecture

## 0. Project Name

Working name: **HK Card Rewards (Ask Mike)** — internal codename `am`.

## 1. What This PRD Is and Is Not

This PRD is for the **foundation layer** of a long-term Hong Kong credit card rewards Q&A product.

The final product will answer questions like:
- "Which card should I use for HKD 3000 online?" (Wallet Mode)
- "Did I miss any reward on last month's spending?" (Wallet Mode — review)
- "Is this welcome offer worth it?" (Wallet Mode — projection)
- "I spend X on Y categories — which 2 cards should I open?" (Plan Mode)
- "Why didn't I get points on this transaction?" (Explain Mode)
- "Should I cancel this card?" (Advice Mode)

To answer the full question set, the eventual system needs **8 layers**. This PRD scopes only **Layer 2 and Layer 4**, but explicitly defines forward-compatible interfaces for Layers 3, 5, 6, 7 so that no Phase-1 decision blocks them.

**Critical framing**: The 4-week MVP is a **data model validation tool**, not a user product. Its purpose is to prove that:
1. The schema can represent real HK card rules without falling back to `custom_note` for more than ~10% of rules.
2. The calculator produces correct outputs for hand-verified test cases.
3. Bulk import is faster than form entry.
4. The architecture can evolve into the full product without rewrite.

If after Week 1 the schema cannot represent two real cards cleanly, **stop and redesign**. Do not power through.

---

## 2. Full Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 8: Agent Orchestration (LLM + tool use)                   │
│   - Routes questions to calc / RAG / sim / resolver             │
└────────────────────────────┬────────────────────────────────────┘
                             │
   ┌─────────────────────────┼───────────────────────────┐
   │                         │                           │
┌──▼─────────────┐  ┌────────▼─────────┐  ┌──────────────▼──┐
│ Layer 4:       │  │ Layer 3: RAG     │  │ Layer 6:        │
│ Calculator     │  │ over sources     │  │ Simulation      │
│ (deterministic)│  │ (explain, why,   │  │ engine          │
│                │  │  edge cases)     │  │ (Plan Mode)     │
└──┬─────────────┘  └────────┬─────────┘  └──────┬──────────┘
   │                         │                   │
   │                         │  ┌────────────────┘
   │                         │  │
┌──▼──────────────────┐  ┌───▼──▼─────────────────┐  ┌──────────────┐
│ Layer 2:            │  │ Layer 5:               │  │ Layer 7:     │
│ Structured rule DB  │  │ Merchant resolver      │  │ User domain  │
│ (cards, rules,      │  │ (name → category +     │  │ (owned cards,│
│  formulas, caps)    │  │  confidence + MCC)     │  │  txn history,│
│                     │  │                        │  │  profile)    │
└──┬──────────────────┘  └────────────────────────┘  └──────────────┘
   │
┌──▼──────────────────────────────────────────────┐
│ Layer 1: Source ingestion                       │
│   Manual now → LLM extraction later             │
│   Stores: raw file + extracted_text + chunks    │
└─────────────────────────────────────────────────┘
```

**MVP scope (4 weeks):** Layer 1 (manual), Layer 2 (full), Layer 4 (full), Layer 5 (hardcoded stub with proper interface).

**Interface-only in MVP:** Layer 3 (store extracted_text + chunks, no embeddings yet), Layer 6 (skeleton + 1 test fixture), Layer 7 (separate schema namespace, no implementation).

**Out of MVP entirely:** Layer 8.

---

## 3. MVP Scope

### In scope

1. Drizzle schema with all entities listed in Section 6.
2. Zod schemas with discriminated unions for all formula types.
3. YAML bulk import + validate pipeline with **full-sync semantics** (Section 11).
4. Source document ingestion **including text extraction** (PDF → text, HTML → text). No embeddings yet.
5. Merchant resolver interface (Section 10), implemented as hardcoded lookup of ~50 common HK merchants.
6. Deterministic calculator with full semantics doc (Section 8).
7. Thin admin UI for browsing cards / rules / sources + a `/calculator-test` page.
8. Light edit forms for rules and sources.
9. 8–10 real HK cards modeled end-to-end.
10. 1–2 "adversarial" cards (Section 12) that stress-test the schema.
11. ≥20 transaction test fixtures with ≥10 hand-verified expected outputs.
12. Simulation engine skeleton (interface + 1 stub implementation).
13. User domain schema namespace (empty, but reserved).

### Out of scope

Chatbot, public Wallet/Plan Mode, browser extension, bank connections, OCR pipeline, LLM extraction, source claim review queue, publish version snapshot, multi-user review, RLS-based permissions, RAG/embedding infrastructure (text is extracted but not embedded), payment/subscription.

---

## 4. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js App Router | Single repo for admin + future user UI |
| Language | TypeScript strict | Required for Zod/Drizzle inference |
| ORM | Drizzle | Generates types from schema; migration story is cleaner than Supabase client for relations |
| DB | Postgres (local Docker → Supabase prod) | Both pgvector-ready for future RAG |
| Validation | Zod | Single source of truth for runtime + types |
| Forms | React Hook Form + Zod resolver | |
| Tables | TanStack Table | |
| UI | shadcn/ui + Tailwind | |
| Testing | Vitest | Calculator tests are critical |
| PDF extraction | `pdf-parse` (Node) | For Layer 1 text extraction |
| HTML extraction | `cheerio` + readability heuristics | |
| Deployment | Local first, Vercel later | |

Do not introduce: Supabase Auth (use a single-user hardcoded session for MVP), pgvector (not yet), LangChain (not needed for deterministic calc).

---

## 5. Core Principles

1. **Every approved rule must have a source.** Enforced at Zod + DB constraint level.
2. **Rules are append-only after approval.** Economic changes create new rows with `supersedes_rule_id`; old row gets `effective_end`.
3. **No free-form JSON for reward logic.** All formulas are Zod discriminated unions. `custom_note` is allowed but counted — if >10% of rules fall back to it, schema needs work.
4. **Calculator is deterministic.** Future LLM never computes rewards; it only explains, retrieves, and routes.
5. **YAML files are source of truth.** Import does full sync per file. DB is a queryable projection of YAML.
6. **Source documents store extracted text from day 1.** Even without embeddings, raw text is searchable and Q&A-ready later.
7. **Every Layer 2 decision must not block Layer 3/5/6/7.** When in doubt, add an interface seam.

---

## 6. Core Entities

### 6.1 Issuer

```ts
{
  issuer_id: uuid pk
  slug: text unique
  name_en: text
  name_zh: text
  website_url: text?
  country_region: text default 'HK'
  notes: text?
  created_at, updated_at
}
```

### 6.2 Card

```ts
{
  card_id: uuid pk
  issuer_id: fk
  product_family: text       // 'HSBC Red', 'Citi Cash Back', etc.
  variant_slug: text         // 'red-visa', 'red-mastercard', null if no variants
  slug: text unique          // 'hsbc-red-visa' or 'hsbc-red'
  card_name_en: text
  card_name_zh: text
  network: text              // Visa / Mastercard / Amex / UnionPay
  card_level: text
  annual_fee_hkd: numeric?
  annual_fee_waiver_note: text?
  income_requirement_hkd: numeric?
  reward_program_id: fk?     // → reward_programs
  official_url: text?
  application_url: text?
  status: text               // draft / active / discontinued / archived

  // NEW vs v2: qualitative features for future Q&A / comparison
  qualitative_features: jsonb default '{}'
  // {
  //   "no_fx_fee": true,
  //   "lounge_visits_per_year": 6,
  //   "good_for": ["overseas_travel", "miles"],
  //   "highlights_en": ["No FX fee", "Priority Pass 6x/yr"],
  //   "highlights_zh": ["免外幣交易費", ...]
  // }

  last_verified_at: timestamptz?
  notes: text?
  created_at, updated_at
}
```

Rules attach to `card_id`, but YAML import supports `applies_to_product_family: <slug>` to fan out to all variants — see Section 11.

### 6.3 Reward Currency (re-introduced from v1)

Centralized valuation. v2 dropped this; it must come back for cross-card ranking.

```ts
{
  currency_id: uuid pk
  slug: text unique          // 'hkd_cashback', 'asia_miles', 'hsbc_reward_cash'
  name_en: text
  name_zh: text
  type: text                 // cashback / miles / points / voucher / statement_credit
  base_value_hkd: numeric    // current canonical valuation, e.g. 0.10 for asia_miles
  valuation_low_hkd: numeric?
  valuation_high_hkd: numeric?
  valuation_note: text?
  effective_start: date
  effective_end: date?       // valuations can change too
  created_at, updated_at
}
```

### 6.4 Reward Program

```ts
{
  program_id: uuid pk
  issuer_id: fk
  slug: text unique
  name_en, name_zh
  reward_currency_id: fk
  conversion_notes: text?
  created_at, updated_at
}
```

### 6.5 Category

```ts
{
  category_id: uuid pk
  slug: text unique
  name_en, name_zh
  parent_category_id: fk?
  description_en, description_zh
  example_merchants: text[]    // e.g. ['PARKnSHOP', 'Wellcome'] for supermarket
  created_at, updated_at
}
```

Canonical categories: see canonical list in §6.5 appendix (general_local, general_overseas, dining_local, dining_overseas, online_local, online_overseas, travel_general, travel_airline, travel_hotel, travel_ota, supermarket, grocery, department_store, transport, public_transport, taxi_ride_hailing, fuel, education, insurance, tax_government, utilities, telecom, healthcare, beauty_health, entertainment, streaming_subscription, ewallet_topup, octopus, rent, mainland_china, macau, overseas_fx, merchant_specific, excluded, unknown).

### 6.6 Source Document

```ts
{
  source_id: uuid pk
  slug: text unique
  issuer_id: fk
  card_id: fk?               // null if issuer-wide source
  source_type: text          // see list below
  source_priority: int       // 1-8 per priority list

  title: text
  url: text?
  storage_path: text?        // for uploaded files
  language: text

  // NEW vs v2: forward-compatible for Layer 3 (RAG)
  extracted_text: text?      // populated by ingestion pipeline
  extraction_method: text?   // 'pdf-parse' / 'html-readability' / 'manual' / null
  extraction_failed: boolean default false

  effective_start: date?
  effective_end: date?
  retrieved_at: timestamptz?
  content_hash: text?
  status: text               // active / archived / needs_recheck
  notes: text?
  created_at, updated_at
}
```

Source types: `official_page` / `official_pdf_tc` / `official_app_screenshot` / `official_open_api` / `competitor_page` / `forum_post` / `reddit_post` / `lihkg_post` / `user_submission` / `manual_note`.

Source priority: 1 = official T&C PDF, 2 = official bank webpage, 3 = official app screenshot, 4 = bank Open API, 5 = competitor site, 6 = forum / Reddit / LIHKG, 7 = user submission, 8 = manual note.

Separate table for future chunking:

```ts
source_chunks {
  chunk_id: uuid pk
  source_id: fk
  chunk_index: int
  text: text
  // embedding: vector(1536)  -- added in Layer 3 phase, not now
  metadata: jsonb            // page number, section heading, etc.
}
```

Chunks are populated by the ingestion pipeline at import time. No embeddings yet.

### 6.7 Reward Rule

This is the most-changed entity. The fields below explicitly fix the stacking / exclusion / tier-period issues from v2.

```ts
{
  rule_id: uuid pk
  card_id: fk

  rule_name: text
  rule_type: text             // base_earn / category_bonus / online_bonus / overseas_bonus /
                              // foreign_currency_bonus / merchant_bonus / campaign_bonus /
                              // exclusion / fee_waiver / other
  category_id: fk?
  campaign_id: fk?

  status: text                // draft / approved / archived
  confidence_score: numeric   // 0..1

  // --- Reward shape (typed payload) ---
  reward_formula_type: text   // discriminator
  reward_formula_payload: jsonb // validated by Zod RewardFormulaSchema
  reward_currency_id: fk?     // which currency this rule produces

  // --- Flattened conditions (queryable) ---
  is_online: boolean?         // null = applies regardless
  is_overseas: boolean?
  is_foreign_currency: boolean?
  transaction_region: text?   // 'HK' | 'MAINLAND_CHINA' | 'MACAU' | 'OVERSEAS' | null
  currency: text?             // ISO code or null

  requires_activation: boolean default false
  requires_registration: boolean default false
  requires_selected_category: boolean default false

  // --- Extended conditions (typed payload) ---
  condition_payload: jsonb default '{}'  // validated by RuleConditionExtensionSchema

  // --- Caps ---
  cap_amount_hkd: numeric?
  cap_reward_amount: numeric?        // in reward_currency units
  cap_period: text?                  // transaction / day / month / quarter / year / campaign / none
  cap_basis: text?                   // spending / reward / transaction_count
  cap_scope: text?                   // 'this_rule' / 'shared_with_group' / 'card_total'
  cap_shared_group: text?            // if cap_scope = shared_with_group

  // --- Minimum spend gating ---
  min_spend_hkd: numeric?
  min_spend_period: text?            // month / statement_cycle / campaign

  // --- Stacking (NEW vs v2) ---
  stacking_policy: text              // 'additive' / 'max_only_in_group' / 'replaces_base'
  exclusive_group: text?             // rules in same group obey stacking_policy together
  applies_to: text[]?                // for exclusions: which rule_types this excludes
                                      // e.g. ['category_bonus', 'campaign_bonus'] means
                                      // base_earn still applies

  priority: int default 100

  // --- Temporal ---
  effective_start: date?
  effective_end: date?
  supersedes_rule_id: fk?

  // --- Provenance ---
  source_id: fk                       // required for status=approved
  notes: text?
  created_at, updated_at
}
```

**Constraint (DB + Zod):** if `status = 'approved'`, `source_id IS NOT NULL`.

### 6.8 Welcome Offer (own schema, NOT reused from RewardFormula)

```ts
{
  welcome_offer_id: uuid pk
  card_id: fk
  offer_name: text
  offer_type: text                    // cashback / miles / points / gift / voucher / fee_waiver

  // Tiered goals (NEW vs v2)
  tiers: jsonb                        // validated by WelcomeOfferTiersSchema
  // [{ min_spend_hkd, within_days, reward: { type, amount, currency_id } }, ...]

  estimated_value_hkd: numeric        // for UI sorting / display
  estimation_note: text?

  application_channel: text           // online / app / branch / referral / any
  new_customer_only: boolean default false
  existing_customer_restriction_note: text?
  annual_fee_required: boolean default false
  requires_apply_with_code: text?     // referral code if any

  effective_start: date?
  effective_end: date?
  status: text                        // draft / approved / archived
  confidence_score: numeric
  source_id: fk
  notes: text?
  created_at, updated_at
}
```

Zod schema:

```ts
const WelcomeOfferTiersSchema = z.array(z.object({
  min_spend_hkd: z.number().nonnegative(),
  within_days: z.number().int().positive(),
  reward: z.discriminatedUnion("type", [
    z.object({ type: z.literal("cashback_hkd"), amount: z.number() }),
    z.object({ type: z.literal("miles"), amount: z.number(), currency_slug: z.string() }),
    z.object({ type: z.literal("points"), amount: z.number(), currency_slug: z.string() }),
    z.object({ type: z.literal("gift"), description: z.string(), estimated_hkd: z.number() }),
    z.object({ type: z.literal("fee_waiver"), years: z.number() }),
  ]),
  is_additive: z.boolean(),  // does this tier stack on previous tiers' rewards?
}))
```

### 6.9 Campaign

```ts
{
  campaign_id: uuid pk
  issuer_id: fk
  card_id: fk?                        // null if applies across cards
  campaign_name: text
  campaign_type: text
  requires_registration: boolean
  registration_channel: text?
  registration_deadline: date?
  effective_start: date
  effective_end: date
  status: text                        // draft / approved / archived
  source_id: fk
  notes: text?
  created_at, updated_at
}
```

Campaign-specific rules live in `reward_rules` with `rule_type='campaign_bonus'` and `campaign_id` set.

### 6.10 Merchant Datapoint

Real-world or community evidence about how a merchant is coded / rewarded. Does NOT overwrite official rules; serves as evidence for merchant resolver confidence.

```ts
{
  merchant_datapoint_id: uuid pk
  merchant_name: text
  merchant_aliases: text[]
  website_url: text?
  country_region: text?
  online_or_offline: text              // online / offline / both / unknown

  canonical_category_id: fk?
  issuer_id: fk?
  card_id: fk?

  possible_mcc: text?
  bank_specific_category: text?

  transaction_date: date?
  transaction_amount_hkd: numeric?
  posted_description: text?

  expected_reward_note: text?
  actual_reward_note: text?
  reward_received: boolean?

  source_type: text                    // official / user_submission / forum / reddit / lihkg / manual / other
  source_id: fk?
  confidence_score: numeric
  status: text                         // draft / approved / archived
  notes: text?
  created_at, updated_at
}
```

### 6.11 Merchant (NEW — for resolver)

Distinct from datapoint: this is a canonical merchant record.

```ts
{
  merchant_id: uuid pk
  slug: text unique
  canonical_name: text
  aliases: text[]
  default_category_id: fk             // best-guess category, used by resolver
  default_category_confidence: numeric
  website_url: text?
  is_online: boolean?
  country_region: text?
  notes: text?
  created_at, updated_at
}
```

Seeded with ~50 common HK merchants: PARKnSHOP, Wellcome, ParknShop, OpenRice, Foodpanda, Klook, Trip.com, Octopus, etc.

### 6.12 User Domain (RESERVED, EMPTY)

Create the schema namespace `user_` but **do not implement**. This forces physical separation.

```ts
// user_owned_cards
// user_transactions
// user_profile
// user_card_caps_state
```

Drizzle file `db/schema/user.ts` exists with table stubs and a comment: `// Layer 7 — do not implement until catalog is stable.`

---

## 7. Reward Formula Schema (Fixed)

```ts
export const RewardFormulaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simple_percent"),
    rate: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("points_per_hkd"),
    points: z.number().min(0),
    perHkd: z.number().positive(),
    currency_slug: z.string(),
  }),
  z.object({
    type: z.literal("miles_per_hkd"),
    miles: z.number().min(0),
    perHkd: z.number().positive(),
    currency_slug: z.string(),
  }),
  z.object({
    type: z.literal("tiered_percent"),
    // FIX: tiers need a reset period
    accrual_period: z.enum(["month", "quarter", "year", "campaign", "lifetime"]),
    tiers: z.array(z.object({
      min_amount_hkd: z.number().min(0),
      max_amount_hkd: z.number().min(0).nullable(),
      rate: z.number().min(0).max(1),
    })),
  }),
  z.object({
    type: z.literal("tiered_points"),
    accrual_period: z.enum(["month", "quarter", "year", "campaign", "lifetime"]),
    currency_slug: z.string(),
    tiers: z.array(z.object({
      min_amount_hkd: z.number().min(0),
      max_amount_hkd: z.number().min(0).nullable(),
      points: z.number().min(0),
      per_hkd: z.number().positive(),
    })),
  }),
  z.object({
    type: z.literal("fixed_bonus"),
    amount: z.number(),
    currency_slug: z.string(),
  }),
  z.object({
    type: z.literal("first_n_transactions_bonus"),
    n: z.number().int().positive(),
    period: z.enum(["month", "statement_cycle", "campaign"]),
    bonus_rate: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("no_reward"),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("custom_note"),
    note: z.string(),
    estimated_value_hkd_per_hkd_spend: z.number().optional(),
  }),
])
```

**Audit rule:** if `>10%` of approved rules have `custom_note`, the schema needs new variants. Track this metric on `/dashboard`.

---

## 8. Calculator Semantics (NEW — Must Be Written Before Implementation)

This section is the most important new addition vs v2. Without an explicit semantics doc, calculator behavior is undefined and Week 2 will be lost re-arguing edge cases.

### 8.1 Inputs

```ts
type TransactionContext = {
  amount_hkd: number
  merchant_name?: string
  category_slug?: string          // resolved by Layer 5 if not provided
  currency?: string
  country_region?: "HK" | "MAINLAND_CHINA" | "MACAU" | "OVERSEAS" | "UNKNOWN"
  is_online?: boolean
  is_foreign_currency?: boolean
  transaction_date: string         // ISO
}

type UserCardContext = {
  card_id: string
  selected_category_slugs?: string[]
  activated_campaign_ids?: string[]
  cap_usage?: Record<string, number>  // key = rule_id or cap_shared_group, value = used_hkd or used_reward_units
}
```

### 8.2 Algorithm (pseudocode)

```
calculate(card, txn, user_ctx):
  # 1. Resolve category if missing
  if txn.category_slug is null:
    res = merchant_resolver.resolve(txn.merchant_name, card.id)
    txn.category_slug = res.category_slug
    category_confidence = res.confidence
  else:
    category_confidence = 1.0

  # 2. Load applicable rules
  rules = load_approved_rules(card.id)
              .filter(r => r.effective_start <= txn.date)
              .filter(r => r.effective_end is null or r.effective_end >= txn.date)

  # 3. Resolve each rule to a candidate
  candidates = []
  for r in rules:
    if not matches(r, txn, user_ctx):    # checks is_online, category, currency, etc.
      continue
    if r.requires_activation and r.id not in user_ctx.activated_campaign_ids:
      continue
    if r.requires_selected_category and r.category not in user_ctx.selected_category_slugs:
      continue
    if r.min_spend_hkd is not null:
      if not gates_met(r, user_ctx):
        continue

    reward_units = apply_formula(r.formula, txn, user_ctx.cap_usage)
    candidates.append(ResolvedRule(r, reward_units))

  # 4. Apply exclusions
  exclusions = candidates.filter(c => c.rule_type == "exclusion")
  for ex in exclusions:
    for c in candidates:
      if c.rule_type in ex.applies_to:
        c.disabled = true
        c.disable_reason = ex.rule_name
  candidates = candidates.filter(c => not c.disabled and c.rule_type != "exclusion")

  # 5. Resolve stacking groups
  groups = group_by(candidates, c => c.exclusive_group or c.rule_id)
  selected = []
  for group_id, group_candidates in groups:
    policy = group_candidates[0].stacking_policy
    if policy == "max_only_in_group":
      selected.append(max(group_candidates, by=hkd_value))
    elif policy == "additive":
      selected.extend(group_candidates)
    elif policy == "replaces_base":
      selected = [c for c in selected if c.rule_type != "base_earn"]
      selected.extend(group_candidates)

  # 6. Apply caps
  for c in selected:
    c.reward_units = apply_cap(c, user_ctx.cap_usage)

  # 7. Convert to HKD-equivalent
  total_hkd = 0
  breakdown = []
  for c in selected:
    hkd_value = c.reward_units * currency_value_hkd(c.currency_id, txn.date)
    total_hkd += hkd_value
    breakdown.append({...c, hkd_value})

  # 8. Confidence
  rule_conf = min(c.confidence_score for c in selected) if selected else 1.0
  overall_conf = min(rule_conf, category_confidence)
  level = "high" if overall_conf >= 0.85 else "medium" if overall_conf >= 0.6 else "low"

  return RewardResult(
    reward_value_hkd=total_hkd,
    breakdown=breakdown,
    confidence=level,
    confidence_score=overall_conf,
    caveats=collect_caveats(selected, category_confidence),
    source_ids=unique([c.source_id for c in selected])
  )
```

### 8.3 Confidence level mapping (explicit)

| overall_conf | level | UI badge |
|---|---|---|
| ≥ 0.85 | high | green |
| 0.60–0.85 | medium | yellow |
| < 0.60 | low | red |

`overall_conf = min(min_rule_confidence, category_resolution_confidence)`.

### 8.4 Exclusion scope examples

```yaml
# Tax payment: no bonus, but base earn still applies
- rule_name: Tax payment — no bonus
  rule_type: exclusion
  category_slug: tax_government
  applies_to: [category_bonus, campaign_bonus, online_bonus, overseas_bonus]
  # base_earn NOT listed → base earn still applies

# E-wallet topup: completely excluded
- rule_name: E-wallet topup — fully excluded
  rule_type: exclusion
  category_slug: ewallet_topup
  applies_to: [base_earn, category_bonus, campaign_bonus, online_bonus, overseas_bonus]
```

### 8.5 ResolvedRule intermediate representation

Calculator does NOT operate directly on DB rows. Internally:

```ts
type ResolvedRule = {
  source_rule_id: string
  rule_type: RuleType
  reward_currency_slug: string
  reward_units_before_cap: number
  cap_used_after: number
  stacking_policy: StackingPolicy
  exclusive_group?: string
  source_id: string
  confidence_score: number
}
```

This is the seam between Layer 2 (schema) and Layer 4 (compute). When schema changes in Phase 2, only `Rule → ResolvedRule` transformation changes; calculator stays.

---

## 9. Merchant Resolver (Layer 5 — Interface + Stub)

```ts
// lib/resolver/types.ts
export type MerchantResolution = {
  category_slug: string
  confidence: number          // 0..1
  candidate_mccs: string[]
  matched_merchant_id?: string
  source_ids: string[]
  fallback_used: boolean      // true if we hit 'unknown' default
}

export interface MerchantResolver {
  resolve(name: string, cardId?: string): Promise<MerchantResolution>
}
```

**Phase-1 implementation:** `HardcodedMerchantResolver`. Reads `merchants` table; if not matched, returns `{ category_slug: "unknown", confidence: 0.3, fallback_used: true }`.

**Phase-2 implementation (not in MVP):** `EmbeddingMerchantResolver` — pgvector lookup against merchant name embeddings.

Calculator is injected with `MerchantResolver`. Swapping implementations does not touch calculator code.

---

## 10. Source Text Extraction (Layer 1 Forward-Compatible)

At source document creation time, the import pipeline:

1. If `source_type` ∈ `{official_pdf_tc}` and `storage_path` present → run `pdf-parse`, store output in `extracted_text`.
2. If `source_type` ∈ `{official_page, competitor_page, forum_post, reddit_post, lihkg_post}` and `url` present → fetch HTML, run `cheerio` + readability extraction, store in `extracted_text`.
3. If `source_type` = `official_app_screenshot` → set `extraction_failed=true`, leave `extracted_text=null`. (Future: OCR.)
4. Chunk `extracted_text` into ~500-token segments, write to `source_chunks`.
5. Compute `content_hash` for de-dup.

**Why now and not later:** if you skip extraction in MVP, every source needs to be re-fetched in 3 months when you build Layer 3. Some URLs will be dead, PDFs may have moved. Capture content at ingestion time.

**Embeddings are NOT computed in MVP.** Add a separate `source_chunks.embedding vector(1536)` column in a later migration.

---

## 11. YAML Import Semantics (Explicit Full-Sync)

### 11.1 File layout

```
data/
  issuers/
    hsbc.yaml
    citi.yaml
  reward_currencies/
    base.yaml
  categories/
    base.yaml
  merchants/
    base.yaml
  cards/
    hsbc-red.yaml
    citi-cash-back.yaml
  campaigns/
    2026-q3-hsbc-online-bonus.yaml
  test_fixtures/
    transactions.yaml
    expected_results.yaml
```

### 11.2 Per-card file = full card snapshot

Each `cards/<slug>.yaml` declares the **complete** state of one card: card metadata, sources, rules, welcome offers. The card file is the source of truth.

### 11.3 Sync semantics

On `pnpm import:data`:

1. **Upsert** issuers, currencies, categories, merchants by slug.
2. For each card YAML:
   - Upsert card.
   - Upsert each source (by `slug`).
   - For each rule in the YAML:
     - If a rule with same `slug` exists in DB and is **approved** and its formula/conditions differ economically → **refuse import** and require an explicit `supersedes: <old-rule-slug>` declaration in YAML. Old rule gets `effective_end = today`, new rule inserts with `supersedes_rule_id` set.
     - If a rule with same `slug` exists and is **draft** → overwrite.
     - If a rule with same `slug` does NOT exist → insert.
   - For rules **in DB but missing from YAML**: mark as `archived` (don't delete — preserve history).
   - Same logic for welcome offers, campaigns.

### 11.4 Variant fan-out

```yaml
card:
  product_family: hsbc-red
  variants:
    - slug: hsbc-red-visa
      network: Visa
    - slug: hsbc-red-mastercard
      network: Mastercard

rules:
  - rule_name: Base earn
    applies_to_variants: all   # or [hsbc-red-visa]
    ...
```

Import expands `applies_to_variants: all` into one rule row per variant. Rule slug is `<base-rule-slug>__<variant-slug>` for uniqueness.

### 11.5 Validate / import / test commands

```
pnpm validate:data    # Zod-validate all YAML, check refs, no DB writes
pnpm import:data      # full-sync into DB
pnpm test:calculator  # run fixtures against current DB state
```

`validate:data` is the **pre-commit gate**: CI fails if YAML is invalid.

---

## 12. Test Fixtures (Including Adversarial Cards)

### 12.1 Required adversarial cards in Week 1

These cards stress the schema:

- **HSBC EveryMile** — monthly tier reset + registration + cap → tests `tiered_percent` + `accrual_period` + `requires_registration`.
- **Citi PremierMiles** — overseas FX bonus + tax exclusion of bonus only (base still earns) → tests `applies_to` exclusion scope.
- **DBS Eminent / Black** — has campaign-style bonuses that change quarterly → tests `campaign_id` and `effective_end` flow.

If any of these three cannot be modeled by end of Week 1, **stop and redesign**. Do not move to Week 2.

### 12.2 Transaction fixtures (≥20)

```yaml
- name: "Tax payment — base earn only"
  amount_hkd: 10000
  category_slug: tax_government
  # Expected: cards that have 'applies_to=[bonus only]' exclusion still earn base 0.4%

- name: "Octopus topup"
  amount_hkd: 500
  category_slug: octopus

- name: "Foreign currency online (USD)"
  amount_hkd: 4000
  currency: USD
  is_online: true
  is_foreign_currency: true

- name: "Tiered overflow (HKD 25000 dining, monthly tier)"
  amount_hkd: 25000
  category_slug: dining_local
  # Expected: card with monthly tier resets, partial at high rate + remainder at base

- name: "Stacked: campaign + category bonus"
  amount_hkd: 2000
  category_slug: online_local
  # Expected: depending on stacking_policy, either max(campaign, category) or both

- name: "Mainland China UnionPay"
  amount_hkd: 3000
  country_region: MAINLAND_CHINA

- name: "Klook (merchant-specific bonus card)"
  amount_hkd: 5000
  merchant_name: Klook
  # Tests merchant_resolver + merchant_bonus rule type

- name: "Unknown merchant (resolver fallback)"
  amount_hkd: 1500
  merchant_name: "Some random shop"
  # Tests: confidence drops to low when category resolution fails
```

### 12.3 Hand-verified expected outputs

For each fixture × each card in the 8–10 seed set, write expected reward (best-effort) in `expected_results.yaml`. Mark each as:
- `verified` (you read the T&C yourself and confirmed)
- `derived` (the calculator computed it; you spot-checked)
- `uncertain` (you're not sure but want to track)

Goal: ≥50 `verified` cells across the matrix by end of Week 4.

---

## 13. Simulation Engine Skeleton (Layer 6 — Interface Only)

```ts
// lib/simulation/types.ts
export type SpendingProfile = {
  monthly_by_category: Record<string, number>  // category_slug → HKD
  travel_per_year_hkd?: number
  fx_share?: number                             // 0..1
}

export type ProjectionInputs = {
  card_id: string
  profile: SpendingProfile
  months_ahead: number
  include_welcome_offer: boolean
  user_context?: UserCardContext
}

export type Projection = {
  card_id: string
  total_reward_value_hkd: number
  per_month_hkd: number[]
  welcome_offer_contribution_hkd: number
  caveats: string[]
}

export interface SimulationEngine {
  project(input: ProjectionInputs): Promise<Projection>
}
```

**Phase-1 implementation:** A stub that:
1. For each month, builds N synthetic transactions per category (1 transaction per category at the monthly amount).
2. Calls `calculator.calculate()` for each.
3. Sums.
4. Adds welcome_offer estimated_value_hkd if applicable.

This is enough to power one demo: "If I spend like this for a year on Citi Cash Back, I get HKD ~X." Crude but proves the layer plugs in.

---

## 14. Thin Admin UI

Pages:

- `/dashboard` — counts + custom_note ratio metric + recently-imported time
- `/cards` — list + detail (incl. linked rules, sources, welcome offers)
- `/rules` — list (filterable by everything in Section 6.7) + detail + light edit form
- `/sources` — list + detail (show extracted_text preview)
- `/welcome-offers` — list
- `/campaigns` — list
- `/merchants` — list (for editing merchant resolver data)
- `/calculator-test` — **primary demo page**
- `/projection-test` — simulation engine demo (Week 4)

`/calculator-test` requirements:
- Manual transaction input OR pick fixture
- Select cards (multi)
- Run → show ranking with: reward HKD, breakdown, source links, caveats, confidence badge, "why this card lost" comparison view

---

## 15. Future Layer Interfaces (Already Reserved)

### Layer 3 (RAG over sources)
- `source_chunks` table exists from Day 1 with text but no embeddings.
- A future migration adds `embedding vector(1536)` + builds index.
- Interface to be added: `SourceSearcher.search(question: string, filters: { card_id?, issuer_id? }): SearchResult[]`.

### Phase 2 (Multi-source extraction + cross-check)
- See §22 for the full design.
- MVP reserves `db/schema/extraction.ts` as an empty namespace so Phase 2's migrations land cleanly.

### Layer 5 (Merchant Resolver)
- `MerchantResolver` interface live from Day 1, hardcoded impl.
- Swap to embedding-based impl later without touching calculator.

### Layer 6 (Simulation)
- `SimulationEngine` interface live from Day 1, stub impl.
- Refined in Plan Mode phase.

### Layer 7 (User domain)
- Empty schema namespace `db/schema/user.ts` reserved.
- No FK from `cards`/`rules` to user tables — physical isolation.

### Layer 8 (Agent)
- Not designed yet. Mental model: agent calls tools `{calculate, rank, project, search_sources, resolve_merchant, lookup_card}`. Each tool is a thin wrapper over the layers above.

---

## 16. Implementation Plan (4 Weeks + Hard Checkpoints)

See `roadmap.md` for the milestone-level breakdown. Summary:

- **Week 1**: Schema + Calculator semantics + 2 adversarial cards. Hard checkpoint at end of Week 1.
- **Week 2**: Bulk import + 6 more cards + source extraction. Hard checkpoint at end of Week 2.
- **Week 3**: Thin admin UI + edit forms.
- **Week 4**: Calculator test page + simulation skeleton + cleanup.

---

## 17. Acceptance Criteria

MVP is done when:

1. 8–10 real HK cards in YAML, imported, browsable in admin.
2. ≥15 verified calculator test outputs passing.
3. `custom_note` used in ≤10% of approved rules.
4. Calculator handles: tax exclusion (base still earns), tiered monthly reset, online bonus stacking, foreign currency bonus, merchant-specific bonus, campaign bonus with registration.
5. Source documents have `extracted_text` populated for all PDF/HTML sources.
6. Merchant resolver returns category for ~50 common HK merchants; fallback "unknown" works.
7. `/calculator-test` produces ranked output with breakdown, source links, confidence badge.
8. `/projection-test` produces a 12-month HKD reward estimate for one card given a profile.
9. Approved rules without `source_id` are rejected by Zod and by DB constraint.
10. Re-importing a modified YAML triggers `supersedes_rule_id` on economic changes.
11. Schema namespace `user_` exists but empty.
12. Interface contracts for `MerchantResolver`, `SimulationEngine`, `SourceSearcher` (the last as a typed stub) all checked into `lib/`.

---

## 18. Schema Decisions Log (Living Doc)

`docs/decisions.md` should record:

- Why `applies_to` was added to exclusion rules (was: PRD v2's `exclusion_scope=bonus_only` was insufficient).
- Why welcome offers got their own schema (not RewardFormula).
- Why `accrual_period` was added to tiered formulas.
- Why `reward_currencies` was re-introduced (cross-card ranking needs canonical valuation).
- Why source text is extracted at ingestion (avoid re-fetching dead URLs later).
- Why merchant resolver is an interface from Day 1 (calculator must work without categorySlug in TransactionContext).
- Why user domain is physically isolated (catalog evolution must not break user data).

Every future schema change appends an entry.

---

## 19. Out-of-MVP but Pre-Designed

These features have **interface stubs** in MVP code but no implementation:

- `SourceSearcher` — Layer 3 RAG
- `EmbeddingMerchantResolver` — Layer 5 v2
- Real `SimulationEngine` — Layer 6 v2
- All `user_*` tables — Layer 7
- Agent orchestrator — Layer 8

The MVP code compiles against these interfaces. Adding implementations later requires no changes to calculator, schema, or admin UI.

---

## 20. The Demo That Proves MVP

```
1. Import 10 cards from YAML
2. Visit /dashboard → see 10 cards, custom_note ratio 6%
3. Visit /cards/hsbc-everymile → see card, rules, sources, welcome offer
4. Click source → see extracted PDF text preview
5. Visit /calculator-test
6. Enter: "Klook, HKD 5000, online, HKD currency, 2026-06-15"
   → merchant_resolver auto-fills category_slug = travel_ota
   → Rank: Card A (HKD 250, breakdown shown, sources linked, confidence high)
            Card B (HKD 200)
            Card C (HKD 150, but flagged "low confidence — Klook merchant category uncertain")
7. Enter same transaction with merchant "Unknown Shop XYZ"
   → resolver falls back, confidence drops, badge shows "low"
8. Visit /projection-test
   → Enter profile: HKD 8000/mo dining, HKD 4000/mo online, HKD 2000/mo overseas
   → Pick HSBC EveryMile + welcome offer
   → Projection: HKD ~4800 in 12 months (welcome HKD 800 + ongoing HKD 4000)
9. Edit a rule via admin → save → re-run calculator → output reflects edit
```

If this demo works, MVP is done and Layer 3/5/6/7 can begin.

---

## 21. Final Note to Builder

Do not skip Section 8 (calculator semantics doc). Most schema issues in v2 came from not having one. Write it first, code it second.

Do not skip the Week 1 hard checkpoint. The cost of a schema redesign is much lower in Week 1 than in Week 3.

When in doubt between "build it now" and "stub the interface": stub the interface.

---

## 22. Phase 2: Multi-Source Extraction + Cross-Check (Post-MVP)

### 22.1 Why Phase 2 exists

Hand-curated YAML scales to ~25 cards comfortably and ~50 with effort. HK has ~70–150 cards in active use depending on how variants are counted. To reach the long tail without compromising accuracy, MVP's hand-curated foundation needs a complementary **extraction + cross-check pipeline**.

The product thesis still stands: **the moat is accuracy**. Phase 2 does not sacrifice that. It builds infrastructure so that bulk coverage *cannot* enter the approved rule set without source-backed evidence and (when sources disagree) human resolution.

### 22.2 Design principles

Three new principles layered on top of PRD §5:

1. **Multi-source by default.** Every claim about a card rule is anchored to a specific source. The same rule may be supported by multiple claims from multiple sources.
2. **Cross-check before approve.** When multiple sources speak to the same rule, the system compares them. Agreement → high confidence. Disagreement → conflict review task.
3. **LLM extracts; humans approve.** LLMs are first-class extractors, never first-class approvers. An LLM-extracted claim enters `status='draft'` and is invisible to the calculator until a human approves it.

### 22.3 Source landscape (priorities from PRD §6.6, expanded)

```
Priority 1 — Official T&C PDF                  (truth, when readable)
Priority 2 — Official bank webpage             (truth, current)
Priority 3 — Official app screenshot           (truth, but OCR-fragile)
Priority 4 — Bank Open API                     (truth, machine-readable)
Priority 5 — Competitor / aggregator           (MoneyHero, MoneySmart, 小斯, 里先生)
Priority 6 — Forum / Reddit / LIHKG            (current, anecdotal)
Priority 7 — User submission                   (rare but valuable)
Priority 8 — Manual note                       (last resort)
```

Phase 2 ingests *systematically* from priorities 2, 5, 6 (web), with priority 1 supplemented manually when PDFs require OCR.

### 22.4 Workflow

```
                ┌─────────────────────────────────────┐
                │  Scanner: per-card source crawl     │
                │  (official + 2-3 competitors +      │
                │   1-2 forum threads)                │
                └─────────────────┬───────────────────┘
                                  │
                                  ▼
                ┌─────────────────────────────────────┐
                │ source_documents (extracted_text +  │
                │ source_chunks — already in MVP)     │
                └─────────────────┬───────────────────┘
                                  │
                  ┌───────────────┴──────────────┐
                  ▼                              ▼
        ┌──────────────────┐         ┌──────────────────┐
        │ LLM extractor    │         │ Manual extractor │
        │ (schema-guided)  │         │ (for PDFs)       │
        └────────┬─────────┘         └────────┬─────────┘
                 │                            │
                 └──────────────┬─────────────┘
                                ▼
                ┌─────────────────────────────────────┐
                │ source_claims (one row per source   │
                │ per claim, status=pending_review)   │
                └─────────────────┬───────────────────┘
                                  │
                                  ▼
                ┌─────────────────────────────────────┐
                │ Cross-check aggregator              │
                │  groups claims by (card, claim_type,│
                │  category) → cross_check_groups     │
                └─────────────────┬───────────────────┘
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
            [agreed: ≥2     [single: only    [conflict: sources
             sources agree]  1 source]        disagree on value]
                  │               │               │
                  ▼               ▼               ▼
            review_task     review_task     review_task
            (confirm)       (needs corro-   (conflict_resolution,
                            boration)        priority=high)
                  │               │               │
                  └───────────────┴───────────────┘
                                  │
                                  ▼
                ┌─────────────────────────────────────┐
                │ Approved → reward_rules             │
                │ (with all supporting source_ids)    │
                └─────────────────────────────────────┘
```

### 22.5 New entities (reserved in MVP, implemented in Phase 2)

#### `source_claims`

A single structured assertion extracted from one source. Multiple claims can describe the same rule (e.g., HSBC website says 4% online, MoneyHero says 4% online, LIHKG thread says 4% online → three claims, one canonical rule).

```ts
{
  claim_id: uuid pk
  source_id: fk → source_documents
  card_id: fk
  claim_type: text                    // earn_rate / cap / exclusion / welcome_offer / category_definition / annual_fee / eligibility
  structured_payload: jsonb           // shape matches reward_rules.reward_formula_payload + flattened conditions
  extracted_text_snippet: text        // the actual quote from the source
  extraction_run_id: fk?              // null if manual
  extracted_by: text                  // 'manual' | 'claude-opus-4-7-2026-06' | 'gpt-x' | 'parser-v1'
  confidence_score: numeric           // extractor's self-reported confidence
  status: text                        // draft / pending_review / approved / rejected / superseded
  cross_check_group_id: fk?
  reviewer_note: text?
  reviewed_by: uuid?
  reviewed_at: timestamptz?
  created_at, updated_at
}
```

#### `extraction_runs`

One row per extraction job (a single LLM call or batch). Lets you replay history when a prompt or model changes.

```ts
{
  run_id: uuid pk
  source_id: fk
  model_id: text                      // 'claude-opus-4-7' / 'gpt-x' / 'parser:hsbc-tc-v1'
  prompt_version: text                // versioned prompt id
  input_hash: text                    // hash of (chunk + prompt) — for dedup
  claims_emitted: int
  cost_usd_cents: int?
  started_at, finished_at
  status: text                        // succeeded / failed / partial
  error: text?
  created_at
}
```

#### `cross_check_groups`

One row per (card_id, claim_type, key_dimension) cluster. Holds the cross-check verdict.

```ts
{
  group_id: uuid pk
  card_id: fk
  claim_type: text
  key_dimension: text                 // e.g. 'category_slug=online_local' or 'rule_type=base_earn'
  status: text                        // agreed / single_source / conflict / superseded
  canonical_payload: jsonb?           // the agreed value (null if conflict unresolved)
  aggregate_confidence: numeric
  supporting_claim_ids: uuid[]        // claims that contribute
  contradicting_claim_ids: uuid[]     // claims that disagree
  approved_rule_id: fk?               // the reward_rule this group eventually became
  created_at, updated_at
}
```

#### `review_tasks` (already designed in v1 PRD §6.11)

Re-introduce. Phase 2 makes heavy use of:
- `task_type='claim_review'` (single claim approve/reject)
- `task_type='conflict_resolution'` (multiple sources disagree)
- `task_type='cross_check_confirmation'` (agreement found, confirm canonical value)

### 22.6 Cross-check semantics

For each `(card_id, claim_type, key_dimension)`:

1. Group all pending claims.
2. Compute `canonical_payload` candidates:
   - **Numeric values (rate, cap, miles_per_hkd)**: median if within ±5%, else flag conflict.
   - **Categorical values (category_slug, currency_slug)**: most-common-wins if ≥2/3 agree, else conflict.
   - **Boolean flags (requires_activation)**: any `true` from priority ≤4 wins (banks know best when registration is required); conflict only if priorities 1–2 disagree.
3. Compute `aggregate_confidence`:
   ```
   weight(claim) = source_priority_weight × claim.confidence_score
   weights: P1=1.0, P2=0.9, P3=0.8, P4=0.95, P5=0.5, P6=0.3, P7=0.2, P8=0.1
   aggregate = weighted_avg(supporting_claims)
   ```
4. Status:
   - `agreed` if ≥2 supporting claims from priority ≤5 and no contradiction.
   - `single_source` if only 1 source.
   - `conflict` otherwise. Auto-create `conflict_resolution` review task.

### 22.7 Approval path

A `cross_check_group` becomes a `reward_rule` only when:
1. Status is `agreed` or `single_source`.
2. A reviewer approves (or auto-approve if status=`agreed` AND aggregate_confidence ≥ 0.9 AND all supporting sources are priority ≤2 — opt-in per-issuer setting).
3. The resulting `reward_rule.source_id` is set to the highest-priority supporting source. All other supporting source_ids are stored in `reward_rule_sources` join table (new entity, simple slug+id mapping).

### 22.8 Phase 2 schema namespace

Mirror the MVP isolation pattern:

```
src/db/schema/
  catalog.ts      // Layer 2 — populated in MVP
  user.ts         // Layer 7 — RESERVED in MVP
  extraction.ts   // Phase 2 — RESERVED, empty in MVP
```

`extraction.ts` ships in MVP as `export {}` — no tables, no foreign keys. Phase 2's first commit is the migration adding source_claims / extraction_runs / cross_check_groups / review_tasks / reward_rule_sources.

### 22.9 What Phase 2 does NOT do

- It does not build a chatbot, Wallet Mode, or Plan Mode (Phase 3+).
- It does not run automatic crawlers (a manual "fetch this URL into a source_document" command suffices).
- It does not OCR app screenshots (still future).
- It does not weight forum/Reddit/LIHKG as much as official — the priority system handles that.

### 22.10 Phase 2 success criteria

Phase 2 is done when:
1. ≥25 cards are `approved` end-to-end (up from MVP's 8–10).
2. ≥10 additional cards reach `single_source` or `conflict` status (in review queue).
3. The Phase 2 demo flow runs: open `/sources/<some-pdf>` → click "Extract" → LLM emits N claims → each visible in `/review` → reviewer approves → claims become reward_rules → calculator output updates within seconds.
4. At least one real conflict has been detected and resolved through the UI.
5. The `extraction_runs` table records cost + latency so the operator knows what extraction costs.
