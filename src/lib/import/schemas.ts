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
})

export const CardFileSchema = z.object({
  issuerSlug: SlugSchema,
  card: CardMetaSchema,
  sources: z.array(SourceEntrySchema).default([]),
  rules: z.array(RuleEntrySchema).default([]),
})
export type CardFile = z.infer<typeof CardFileSchema>

