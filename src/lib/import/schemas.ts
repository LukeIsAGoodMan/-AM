import { z } from "zod"
import { RewardFormulaSchema } from "@/lib/schemas/formula"

// PRD §11. YAML is the source of truth; import does full-sync per file.
// One Zod schema per file shape — validate() rejects malformed files before
// any DB writes happen.

// ---------- shared ----------

const StatusSchema = z.enum(["draft", "approved", "archived"])
const SlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_\-]+(__[a-z0-9_\-]+)*$/, {
    message: "slug must be lowercase letters, numbers, hyphen, underscore; segments joined by __",
  })

// ---------- issuers ----------

export const IssuerFileSchema = z.object({
  slug: SlugSchema,
  nameEn: z.string().min(1),
  nameZh: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  countryRegion: z.string().default("HK"),
  notes: z.string().optional(),
})
export type IssuerFile = z.infer<typeof IssuerFileSchema>

// ---------- reward currencies (all in one file) ----------

const RewardCurrencyEntrySchema = z.object({
  slug: SlugSchema,
  nameEn: z.string().min(1),
  nameZh: z.string().optional(),
  type: z.enum([
    "cashback",
    "miles",
    "points",
    "voucher",
    "statement_credit",
    "other",
  ]),
  baseValueHkd: z.number().positive(),
  valuationNote: z.string().optional(),
})

export const RewardCurrencyFileSchema = z.object({
  currencies: z.array(RewardCurrencyEntrySchema).min(1),
})
export type RewardCurrencyFile = z.infer<typeof RewardCurrencyFileSchema>

// ---------- categories (all in one file) ----------

const CategoryEntrySchema = z.object({
  slug: SlugSchema,
  nameEn: z.string().min(1),
  nameZh: z.string().optional(),
  parentSlug: SlugSchema.optional(),
  descriptionEn: z.string().optional(),
  descriptionZh: z.string().optional(),
  exampleMerchants: z.array(z.string()).optional(),
})

export const CategoryFileSchema = z.object({
  categories: z.array(CategoryEntrySchema).min(1),
})
export type CategoryFile = z.infer<typeof CategoryFileSchema>

// ---------- card (one file per card) ----------

const SourceEntrySchema = z.object({
  slug: SlugSchema,
  sourceType: z.enum([
    "official_page",
    "official_pdf_tc",
    "official_app_screenshot",
    "official_open_api",
    "competitor_page",
    "forum_post",
    "reddit_post",
    "lihkg_post",
    "user_submission",
    "manual_note",
  ]),
  sourcePriority: z.number().int().min(1).max(8),
  title: z.string().min(1),
  url: z.string().url().optional(),
  storagePath: z.string().optional(),
  language: z
    .enum(["en", "zh_hk", "zh_cn", "mixed", "unknown"])
    .default("unknown"),
  status: z.enum(["active", "archived", "needs_recheck"]).default("active"),
  notes: z.string().optional(),
})
export type SourceEntry = z.infer<typeof SourceEntrySchema>

const RuleCapSchema = z.object({
  amountHkd: z.number().positive().optional(),
  rewardAmount: z.number().positive().optional(),
  period: z.enum([
    "transaction",
    "day",
    "month",
    "quarter",
    "year",
    "campaign",
    "none",
  ]),
  basis: z.enum(["spending", "reward", "transaction_count"]),
  scope: z.enum(["this_rule", "shared_with_group", "card_total"]).optional(),
  sharedGroup: z.string().optional(),
})

const RuleEntrySchema = z.object({
  slug: SlugSchema,
  ruleName: z.string().min(1),
  ruleType: z.enum([
    "base_earn",
    "category_bonus",
    "selected_category_bonus",
    "online_bonus",
    "overseas_bonus",
    "foreign_currency_bonus",
    "merchant_bonus",
    "campaign_bonus",
    "exclusion",
    "fee_waiver",
    "other",
  ]),
  status: StatusSchema,
  rewardFormula: RewardFormulaSchema,
  rewardCurrencySlug: SlugSchema,

  // Conditions
  categorySlug: SlugSchema.optional(),
  isOnline: z.boolean().optional(),
  isOverseas: z.boolean().optional(),
  isForeignCurrency: z.boolean().optional(),

  // Activation gating
  requiresActivation: z.boolean().default(false),
  requiresRegistration: z.boolean().default(false),

  // M10: campaign attachment — calculator gates by activatedCampaignIds.
  campaignSlug: SlugSchema.optional(),

  // Cap
  cap: RuleCapSchema.optional(),

  // Stacking + exclusion
  appliesTo: z.array(z.string()).optional(),
  stackingPolicy: z
    .enum(["additive", "max_only_in_group", "replaces_base"])
    .default("additive"),
  exclusiveGroup: z.string().optional(),
  priority: z.number().int().default(100),

  // Temporal
  effectiveStart: z.string().optional(), // YYYY-MM-DD
  effectiveEnd: z.string().optional(),
  supersedesSlug: SlugSchema.optional(),

  // Provenance
  sourceSlug: SlugSchema,
  confidenceScore: z.number().min(0).max(1).default(0.5),

  notes: z.string().optional(),
})
export type RuleEntry = z.infer<typeof RuleEntrySchema>

// ---------- welcome offers (embedded in card files) ----------

// PRD §6.8 — tiered welcome offer. Each tier defines a spending goal +
// reward; isAdditive=true means hitting this tier adds on top of previous
// tiers' rewards (vs replaces them).
const WelcomeOfferTierSchema = z.object({
  minSpendHkd: z.number().nonnegative(),
  withinDays: z.number().int().positive(),
  reward: z.discriminatedUnion("type", [
    z.object({ type: z.literal("cashback_hkd"), amount: z.number() }),
    z.object({
      type: z.literal("miles"),
      amount: z.number(),
      currencySlug: SlugSchema,
    }),
    z.object({
      type: z.literal("points"),
      amount: z.number(),
      currencySlug: SlugSchema,
    }),
    z.object({
      type: z.literal("gift"),
      description: z.string(),
      estimatedHkd: z.number(),
    }),
    z.object({ type: z.literal("fee_waiver"), years: z.number() }),
  ]),
  isAdditive: z.boolean().default(true),
})
export const WelcomeOfferTiersSchema = z.array(WelcomeOfferTierSchema).min(1)

const WelcomeOfferEntrySchema = z.object({
  slug: SlugSchema,
  offerName: z.string().min(1),
  offerType: z.enum([
    "cashback",
    "miles",
    "points",
    "gift",
    "voucher",
    "fee_waiver",
    "other",
  ]),
  tiers: WelcomeOfferTiersSchema,
  estimatedValueHkd: z.number().nonnegative().optional(),
  estimationNote: z.string().optional(),
  applicationChannel: z
    .enum(["online", "app", "branch", "referral", "any", "unknown"])
    .default("unknown"),
  newCustomerOnly: z.boolean().default(false),
  existingCustomerRestrictionNote: z.string().optional(),
  annualFeeRequired: z.boolean().default(false),
  requiresApplyWithCode: z.string().optional(),
  effectiveStart: z.string().optional(),
  effectiveEnd: z.string().optional(),
  status: StatusSchema,
  confidenceScore: z.number().min(0).max(1).default(0.5),
  sourceSlug: SlugSchema,
  notes: z.string().optional(),
})
export type WelcomeOfferEntry = z.infer<typeof WelcomeOfferEntrySchema>

const CardMetaSchema = z.object({
  slug: SlugSchema,
  productFamily: z.string().optional(),
  variantSlug: SlugSchema.optional(),
  cardNameEn: z.string().min(1),
  cardNameZh: z.string().optional(),
  network: z.string().optional(),
  cardLevel: z.string().optional(),
  annualFeeHkd: z.number().optional(),
  status: z.enum(["draft", "active", "discontinued", "archived"]).default("draft"),
  officialUrl: z.string().url().optional(),
  notes: z.string().optional(),
  // M9: free-form features. No structural validation in MVP — Phase 2 may
  // tighten if a Q&A schema emerges (e.g. typed lounge programs).
  qualitativeFeatures: z.record(z.string(), z.unknown()).optional(),
})

export const CardFileSchema = z.object({
  issuerSlug: SlugSchema,
  card: CardMetaSchema,
  sources: z.array(SourceEntrySchema).default([]),
  rules: z.array(RuleEntrySchema).default([]),
  welcomeOffers: z.array(WelcomeOfferEntrySchema).default([]),
})
export type CardFile = z.infer<typeof CardFileSchema>

// ---------- campaign (one file per campaign) ----------

export const CampaignFileSchema = z.object({
  slug: SlugSchema,
  issuerSlug: SlugSchema,
  cardSlug: SlugSchema.optional(), // null = applies across issuer's cards
  campaignName: z.string().min(1),
  campaignType: z.enum([
    "online",
    "dining",
    "overseas",
    "merchant",
    "app_registration",
    "general",
    "other",
  ]),
  requiresRegistration: z.boolean().default(false),
  registrationChannel: z
    .enum(["app", "website", "sms", "none", "unknown"])
    .optional(),
  registrationDeadline: z.string().optional(),
  effectiveStart: z.string(),
  effectiveEnd: z.string(),
  status: StatusSchema,
  sourceSlug: SlugSchema.optional(),
  notes: z.string().optional(),
})
export type CampaignFile = z.infer<typeof CampaignFileSchema>

