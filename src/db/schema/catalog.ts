import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core"

// M1 minimum: enough to model 1 card with 1 simple_percent rule, source-backed.
// M2 will add: category_id, is_online, cap_* fields.
// M3 will add: tier accrual + requires_registration.
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
  type: text("type").notNull(), // cashback / miles / points / voucher / statement_credit
  baseValueHkd: numeric("base_value_hkd", { precision: 12, scale: 6 }).notNull(),
  valuationNote: text("valuation_note"),
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
  // cardId added in M2 to avoid circular ref issues right now
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

  // Reward shape — payload validated against RewardFormulaSchema (Zod) in app code.
  // M1: only simple_percent variant is supported.
  rewardFormulaType: text("reward_formula_type").notNull(),
  rewardFormulaPayload: jsonb("reward_formula_payload").notNull(),
  rewardCurrencyId: uuid("reward_currency_id").references(
    () => rewardCurrencies.id,
    { onDelete: "set null" },
  ),

  // Provenance — required for status='approved' (enforced in app code; DB check added later).
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
export type SourceDocument = typeof sourceDocuments.$inferSelect
export type NewSourceDocument = typeof sourceDocuments.$inferInsert
export type Card = typeof cards.$inferSelect
export type NewCard = typeof cards.$inferInsert
export type RewardRule = typeof rewardRules.$inferSelect
export type NewRewardRule = typeof rewardRules.$inferInsert
