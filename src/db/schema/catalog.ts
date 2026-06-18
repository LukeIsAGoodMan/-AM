import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  integer,
  jsonb,
  boolean,
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
// M4 will add: applies_to, stacking_policy, exclusive_group.

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
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
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

  // M2: caps (single-rule scope; M4 adds cap_scope + cap_shared_group for stacking)
  capAmountHkd: numeric("cap_amount_hkd", { precision: 14, scale: 2 }),
  capRewardAmount: numeric("cap_reward_amount", { precision: 14, scale: 4 }),
  capPeriod: text("cap_period"), // transaction / day / month / quarter / year / campaign / none
  capBasis: text("cap_basis"), // spending / reward / transaction_count

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
})

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
