import { sql } from "drizzle-orm"
import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  date,
  integer,
  jsonb,
  boolean,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

// M2 additions vs M1:
//   - categories table (canonical taxonomy)
//   - source_documents.card_id (deferred from M1)
//   - reward_rules: category_id, is_online/is_overseas/is_foreign_currency,
//                   cap_amount_hkd, cap_period, cap_basis
//
// M3 additions:
//   - reward_rules: requires_activation, requires_registration
//   - Tier accrual is INSIDE reward_formula_payload (Zod tiered_percent /
//     tiered_points variants) — no DB column needed for accrual_period.
//
// M4 additions:
//   - reward_rules: applies_to text[] (exclusion scope), stacking_policy,
//                   exclusive_group, priority
//
// M5 additions:
//   - CHECK constraint: approved rules must have source_id
//
// M6 additions:
//   - reward_rules: effective_start, effective_end (date filtering for the
//                   calculator's step 2; supersedes flow uses effective_end)
//   - reward_rules: supersedes_rule_id (FK self) — new rule explicitly
//                   replaces an old one after an economic change in YAML
//
// M8 additions:
//   - source_documents: extracted_text, extraction_method, extraction_failed,
//                       content_hash, retrieved_at (forward-compat for Phase 2 RAG)
//   - source_chunks table: ~500-token slices of extracted_text;
//                          embedding column added in Phase 2 migration
//
// M9 additions:
//   - cards.qualitative_features jsonb — features the calculator can't
//     express but the future Q&A layer needs (no_fx_fee, lounge_visits,
//     highlights_zh, good_for tags, etc.). Per PRD §6.2.

export const issuers = pgTable("issuers", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  websiteUrl: text("website_url"),
  countryRegion: text("country_region").default("HK").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const rewardCurrencies = pgTable("reward_currencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  type: text("type").notNull(),
  baseValueHkd: numeric("base_value_hkd", { precision: 12, scale: 6 }).notNull(),
  valuationNote: text("valuation_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  parentCategoryId: uuid("parent_category_id").references(
    (): AnyPgColumn => categories.id,
    { onDelete: "set null" },
  ),
  descriptionEn: text("description_en"),
  descriptionZh: text("description_zh"),
  exampleMerchants: text("example_merchants").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const sourceDocuments = pgTable("source_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  issuerId: uuid("issuer_id").references(() => issuers.id, {
    onDelete: "set null",
  }),
  cardId: uuid("card_id").references((): AnyPgColumn => cards.id, {
    onDelete: "set null",
  }),
  sourceType: text("source_type").notNull(),
  sourcePriority: integer("source_priority").default(5).notNull(),
  title: text("title").notNull(),
  url: text("url"),
  storagePath: text("storage_path"),
  language: text("language").default("unknown").notNull(),
  status: text("status").default("active").notNull(),
  notes: text("notes"),

  // M8: extraction state — populated by extract:sources / import.
  // null extracted_text + extraction_failed=false = "not yet attempted".
  // null extracted_text + extraction_failed=true  = "tried, failed (see notes)".
  extractedText: text("extracted_text"),
  extractionMethod: text("extraction_method"), // 'pdf-parse' / 'html-cheerio' / 'manual' / null
  extractionFailed: boolean("extraction_failed").default(false).notNull(),
  extractionError: text("extraction_error"),
  contentHash: text("content_hash"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const sourceChunks = pgTable("source_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  // embedding vector(1536) — added in Phase 2 migration when pgvector lands
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  issuerId: uuid("issuer_id")
    .notNull()
    .references(() => issuers.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  productFamily: text("product_family"),
  variantSlug: text("variant_slug"),
  cardNameEn: text("card_name_en").notNull(),
  cardNameZh: text("card_name_zh"),
  network: text("network"),
  cardLevel: text("card_level"),
  annualFeeHkd: numeric("annual_fee_hkd", { precision: 12, scale: 2 }),
  status: text("status").default("draft").notNull(),
  officialUrl: text("official_url"),
  notes: text("notes"),
  // M9: jsonb features the calculator can't model but Q&A / comparison needs.
  // Shape examples:
  //   { no_fx_fee: true, lounge_visits_per_year: 6,
  //     good_for: ["travel","miles"],
  //     highlights_en: ["No FX fee", "Priority Pass 6x/yr"],
  //     highlights_zh: ["免外幣交易費", ...] }
  qualitativeFeatures: jsonb("qualitative_features").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const rewardRules = pgTable("reward_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  ruleName: text("rule_name").notNull(),
  ruleType: text("rule_type").notNull(),
  status: text("status").default("draft").notNull(),

  // Reward shape
  rewardFormulaType: text("reward_formula_type").notNull(),
  rewardFormulaPayload: jsonb("reward_formula_payload").notNull(),
  rewardCurrencyId: uuid("reward_currency_id").references(
    () => rewardCurrencies.id,
    { onDelete: "set null" },
  ),

  // M2: flattened conditions (PRD §5 principle 4 — queryable, not buried in JSON)
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  isOnline: boolean("is_online"),
  isOverseas: boolean("is_overseas"),
  isForeignCurrency: boolean("is_foreign_currency"),

  // M3: opt-in gating. Calculator skips the rule unless the user has
  // included the rule_id in user_context.activatedRuleIds.
  requiresActivation: boolean("requires_activation").default(false).notNull(),
  requiresRegistration: boolean("requires_registration")
    .default(false)
    .notNull(),

  // M4: stacking + exclusion (PRD §8.2 steps 4 + 5).
  // - applies_to: for rule_type='exclusion', the list of OTHER rule_types
  //   this exclusion disables. base_earn NOT in the list means base still earns.
  // - stacking_policy: how this rule interacts with others in the same
  //   exclusive_group. 'additive' is the safe default.
  // - exclusive_group: rules sharing a group key obey the policy together.
  appliesTo: text("applies_to").array(),
  stackingPolicy: text("stacking_policy").default("additive").notNull(),
  exclusiveGroup: text("exclusive_group"),
  priority: integer("priority").default(100).notNull(),

  // M2: caps (single-rule scope; M4 adds cap_scope + cap_shared_group for stacking)
  capAmountHkd: numeric("cap_amount_hkd", { precision: 14, scale: 2 }),
  capRewardAmount: numeric("cap_reward_amount", { precision: 14, scale: 4 }),
  capPeriod: text("cap_period"), // transaction / day / month / quarter / year / campaign / none
  capBasis: text("cap_basis"), // spending / reward / transaction_count

  // M6: temporal — calculator filters on these in step 2 (date range).
  effectiveStart: date("effective_start"),
  effectiveEnd: date("effective_end"),

  // M6: supersedes chain — economic change in YAML must declare which rule
  // is being replaced; old rule keeps its row with effective_end set.
  supersedesRuleId: uuid("supersedes_rule_id").references(
    (): AnyPgColumn => rewardRules.id,
    { onDelete: "set null" },
  ),

  // Provenance
  sourceId: uuid("source_id").references(() => sourceDocuments.id, {
    onDelete: "restrict",
  }),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 })
    .default("0.500")
    .notNull(),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  // PRD §5 principle 1: every approved rule must have a source.
  // Calculator semantics §7 invariant 1.
  check(
    "reward_rules_approved_must_have_source",
    sql`${table.status} <> 'approved' OR ${table.sourceId} IS NOT NULL`,
  ),
])

export type SourceChunk = typeof sourceChunks.$inferSelect
export type NewSourceChunk = typeof sourceChunks.$inferInsert

export type Issuer = typeof issuers.$inferSelect
export type NewIssuer = typeof issuers.$inferInsert
export type RewardCurrency = typeof rewardCurrencies.$inferSelect
export type NewRewardCurrency = typeof rewardCurrencies.$inferInsert
export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
export type SourceDocument = typeof sourceDocuments.$inferSelect
export type NewSourceDocument = typeof sourceDocuments.$inferInsert
export type Card = typeof cards.$inferSelect
export type NewCard = typeof cards.$inferInsert
export type RewardRule = typeof rewardRules.$inferSelect
export type NewRewardRule = typeof rewardRules.$inferInsert
