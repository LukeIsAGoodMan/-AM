import { eq, inArray, sql } from "drizzle-orm"
import type { DB } from "@/db/client"
import {
  cards,
  categories,
  issuers,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
  type RewardRule,
} from "@/db/schema/catalog"
import type { LoadedDataset } from "./loader"
import type { RuleEntry } from "./schemas"

// PRD §11.3. Full-sync semantics:
//   - Upsert issuers / currencies / categories / cards / sources by slug
//   - For each rule:
//       - new slug                     → insert
//       - existing slug, draft         → overwrite
//       - existing slug, approved,
//         no economic change           → overwrite (cosmetic: name, notes, confidence)
//       - existing slug, approved,
//         economic change              → REFUSE (caller must rename slug)
//   - For rules in DB but missing from YAML: mark as archived
//
// Economic = anything the calculator would observe differently. Listed below.

export type SyncReport = {
  inserted: number
  updated: number
  archived: number
  unchanged: number
  refusals: SyncRefusal[]
}

export type SyncRefusal = {
  ruleSlug: string
  changedFields: string[]
  message: string
}

// Fields the calculator observes. Differences here on an approved rule
// require an explicit slug rename — caller can't silently change reward math.
const ECONOMIC_RULE_FIELDS = [
  "ruleType",
  "rewardFormulaPayload",
  "rewardCurrencyId",
  "categoryId",
  "isOnline",
  "isOverseas",
  "isForeignCurrency",
  "requiresActivation",
  "requiresRegistration",
  "capAmountHkd",
  "capRewardAmount",
  "capPeriod",
  "capBasis",
  "appliesTo",
  "stackingPolicy",
  "exclusiveGroup",
  "priority",
  "effectiveStart",
  "effectiveEnd",
] as const

// Fields included in the unchanged/updated report. Superset of economic
// fields plus state/metadata fields that should bump the row's updatedAt.
const STATEFUL_RULE_FIELDS = [
  ...ECONOMIC_RULE_FIELDS,
  "status",
  "ruleName",
  "notes",
  "sourceId",
  "confidenceScore",
  "supersedesRuleId",
] as const

export async function sync(db: DB, dataset: LoadedDataset): Promise<SyncReport> {
  const report: SyncReport = {
    inserted: 0,
    updated: 0,
    archived: 0,
    unchanged: 0,
    refusals: [],
  }

  // ---- Issuers ----
  for (const i of dataset.issuers) {
    await upsertBySlug(
      db,
      () => db.select({ id: issuers.id }).from(issuers).where(eq(issuers.slug, i.slug)),
      () =>
        db
          .insert(issuers)
          .values({
            slug: i.slug,
            nameEn: i.nameEn,
            nameZh: i.nameZh,
            websiteUrl: i.websiteUrl,
            countryRegion: i.countryRegion,
            notes: i.notes,
          })
          .returning({ id: issuers.id }),
      () =>
        db
          .update(issuers)
          .set({
            nameEn: i.nameEn,
            nameZh: i.nameZh,
            websiteUrl: i.websiteUrl,
            countryRegion: i.countryRegion,
            notes: i.notes,
            updatedAt: new Date(),
          })
          .where(eq(issuers.slug, i.slug)),
    )
  }

  // ---- Currencies ----
  const currencyIdBySlug = new Map<string, string>()
  for (const c of dataset.currencies) {
    const id = await upsertBySlug(
      db,
      () =>
        db
          .select({ id: rewardCurrencies.id })
          .from(rewardCurrencies)
          .where(eq(rewardCurrencies.slug, c.slug)),
      () =>
        db
          .insert(rewardCurrencies)
          .values({
            slug: c.slug,
            nameEn: c.nameEn,
            nameZh: c.nameZh,
            type: c.type,
            baseValueHkd: c.baseValueHkd.toString(),
            valuationNote: c.valuationNote,
          })
          .returning({ id: rewardCurrencies.id }),
      () =>
        db
          .update(rewardCurrencies)
          .set({
            nameEn: c.nameEn,
            nameZh: c.nameZh,
            type: c.type,
            baseValueHkd: c.baseValueHkd.toString(),
            valuationNote: c.valuationNote,
            updatedAt: new Date(),
          })
          .where(eq(rewardCurrencies.slug, c.slug)),
    )
    currencyIdBySlug.set(c.slug, id)
  }

  // ---- Categories: two-pass for parent FKs ----
  const categoryIdBySlug = new Map<string, string>()
  for (const cat of dataset.categories) {
    const id = await upsertBySlug(
      db,
      () =>
        db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, cat.slug)),
      () =>
        db
          .insert(categories)
          .values({
            slug: cat.slug,
            nameEn: cat.nameEn,
            nameZh: cat.nameZh,
            descriptionEn: cat.descriptionEn,
            descriptionZh: cat.descriptionZh,
            exampleMerchants: cat.exampleMerchants,
          })
          .returning({ id: categories.id }),
      () =>
        db
          .update(categories)
          .set({
            nameEn: cat.nameEn,
            nameZh: cat.nameZh,
            descriptionEn: cat.descriptionEn,
            descriptionZh: cat.descriptionZh,
            exampleMerchants: cat.exampleMerchants,
            updatedAt: new Date(),
          })
          .where(eq(categories.slug, cat.slug)),
    )
    categoryIdBySlug.set(cat.slug, id)
  }
  for (const cat of dataset.categories) {
    if (!cat.parentSlug) continue
    const parentId = categoryIdBySlug.get(cat.parentSlug)
    if (!parentId) continue // cross-refs validator already caught this
    await db
      .update(categories)
      .set({ parentCategoryId: parentId })
      .where(eq(categories.slug, cat.slug))
  }

  // ---- Issuer slug → id (for cards) ----
  const issuerRows = await db.select({ id: issuers.id, slug: issuers.slug }).from(issuers)
  const issuerIdBySlug = new Map(issuerRows.map((r) => [r.slug, r.id] as const))

  // ---- Cards + sources + rules ----
  const yamlRuleSlugs = new Set<string>()

  for (const { data } of dataset.cardFiles) {
    const issuerId = issuerIdBySlug.get(data.issuerSlug)
    if (!issuerId) {
      throw new Error(`issuer not loaded for slug=${data.issuerSlug}`)
    }

    // Upsert card
    const cardId = await upsertBySlug(
      db,
      () => db.select({ id: cards.id }).from(cards).where(eq(cards.slug, data.card.slug)),
      () =>
        db
          .insert(cards)
          .values({
            issuerId,
            slug: data.card.slug,
            productFamily: data.card.productFamily,
            variantSlug: data.card.variantSlug,
            cardNameEn: data.card.cardNameEn,
            cardNameZh: data.card.cardNameZh,
            network: data.card.network,
            cardLevel: data.card.cardLevel,
            annualFeeHkd: data.card.annualFeeHkd?.toString(),
            status: data.card.status,
            officialUrl: data.card.officialUrl,
            notes: data.card.notes,
          })
          .returning({ id: cards.id }),
      () =>
        db
          .update(cards)
          .set({
            issuerId,
            productFamily: data.card.productFamily,
            variantSlug: data.card.variantSlug,
            cardNameEn: data.card.cardNameEn,
            cardNameZh: data.card.cardNameZh,
            network: data.card.network,
            cardLevel: data.card.cardLevel,
            annualFeeHkd: data.card.annualFeeHkd?.toString(),
            status: data.card.status,
            officialUrl: data.card.officialUrl,
            notes: data.card.notes,
            updatedAt: new Date(),
          })
          .where(eq(cards.slug, data.card.slug)),
    )

    // Upsert sources for this card
    const sourceIdBySlug = new Map<string, string>()
    for (const s of data.sources) {
      const id = await upsertBySlug(
        db,
        () =>
          db
            .select({ id: sourceDocuments.id })
            .from(sourceDocuments)
            .where(eq(sourceDocuments.slug, s.slug)),
        () =>
          db
            .insert(sourceDocuments)
            .values({
              slug: s.slug,
              issuerId,
              cardId,
              sourceType: s.sourceType,
              sourcePriority: s.sourcePriority,
              title: s.title,
              url: s.url,
              storagePath: s.storagePath,
              language: s.language,
              status: s.status,
              notes: s.notes,
            })
            .returning({ id: sourceDocuments.id }),
        () =>
          db
            .update(sourceDocuments)
            .set({
              issuerId,
              cardId,
              sourceType: s.sourceType,
              sourcePriority: s.sourcePriority,
              title: s.title,
              url: s.url,
              storagePath: s.storagePath,
              language: s.language,
              status: s.status,
              notes: s.notes,
              updatedAt: new Date(),
            })
            .where(eq(sourceDocuments.slug, s.slug)),
      )
      sourceIdBySlug.set(s.slug, id)
    }

    // Sync rules for this card
    for (const rule of data.rules) {
      yamlRuleSlugs.add(rule.slug)
      const verdict = await syncRule(
        db,
        rule,
        cardId,
        sourceIdBySlug,
        currencyIdBySlug,
        categoryIdBySlug,
      )
      if (verdict.refusal) {
        report.refusals.push(verdict.refusal)
      } else if (verdict.action === "inserted") {
        report.inserted++
      } else if (verdict.action === "updated") {
        report.updated++
      } else {
        report.unchanged++
      }
    }
  }

  // ---- Archive rules that disappeared from YAML ----
  // Only touch rules currently active (non-archived). Archived stays archived.
  const dbRules = await db
    .select({ id: rewardRules.id, slug: rewardRules.slug, status: rewardRules.status })
    .from(rewardRules)

  const toArchive = dbRules.filter(
    (r) => r.status !== "archived" && !yamlRuleSlugs.has(r.slug),
  )
  if (toArchive.length > 0) {
    await db
      .update(rewardRules)
      .set({ status: "archived", updatedAt: new Date() })
      .where(
        inArray(
          rewardRules.id,
          toArchive.map((r) => r.id),
        ),
      )
    report.archived = toArchive.length
  }

  return report
}

// ---- per-rule sync ----

type RuleVerdict =
  | { action: "inserted" | "updated" | "unchanged"; refusal?: undefined }
  | { action: "refused"; refusal: SyncRefusal }

async function syncRule(
  db: DB,
  yamlRule: RuleEntry,
  cardId: string,
  sourceIdBySlug: Map<string, string>,
  currencyIdBySlug: Map<string, string>,
  categoryIdBySlug: Map<string, string>,
): Promise<RuleVerdict> {
  const sourceId = sourceIdBySlug.get(yamlRule.sourceSlug)
  if (!sourceId) {
    throw new Error(`sourceSlug=${yamlRule.sourceSlug} not in this card's sources`)
  }
  const rewardCurrencyId = currencyIdBySlug.get(yamlRule.rewardCurrencySlug)
  if (!rewardCurrencyId) {
    throw new Error(`unknown currency ${yamlRule.rewardCurrencySlug}`)
  }
  const categoryId = yamlRule.categorySlug
    ? categoryIdBySlug.get(yamlRule.categorySlug)
    : undefined

  let supersedesRuleId: string | undefined
  if (yamlRule.supersedesSlug) {
    const target = await db
      .select({ id: rewardRules.id })
      .from(rewardRules)
      .where(eq(rewardRules.slug, yamlRule.supersedesSlug))
    if (target[0]) supersedesRuleId = target[0].id
  }

  const insertValues = {
    cardId,
    slug: yamlRule.slug,
    ruleName: yamlRule.ruleName,
    ruleType: yamlRule.ruleType,
    status: yamlRule.status,
    rewardFormulaType: yamlRule.rewardFormula.type,
    rewardFormulaPayload: yamlRule.rewardFormula,
    rewardCurrencyId,
    categoryId,
    isOnline: yamlRule.isOnline ?? null,
    isOverseas: yamlRule.isOverseas ?? null,
    isForeignCurrency: yamlRule.isForeignCurrency ?? null,
    requiresActivation: yamlRule.requiresActivation,
    requiresRegistration: yamlRule.requiresRegistration,
    capAmountHkd: yamlRule.cap?.amountHkd?.toString(),
    capRewardAmount: yamlRule.cap?.rewardAmount?.toString(),
    capPeriod: yamlRule.cap?.period,
    capBasis: yamlRule.cap?.basis,
    appliesTo: yamlRule.appliesTo,
    stackingPolicy: yamlRule.stackingPolicy,
    exclusiveGroup: yamlRule.exclusiveGroup,
    priority: yamlRule.priority,
    effectiveStart: yamlRule.effectiveStart,
    effectiveEnd: yamlRule.effectiveEnd,
    supersedesRuleId,
    sourceId,
    confidenceScore: yamlRule.confidenceScore.toFixed(3),
    notes: yamlRule.notes,
  }

  const existing = await db
    .select()
    .from(rewardRules)
    .where(eq(rewardRules.slug, yamlRule.slug))

  if (!existing[0]) {
    await db.insert(rewardRules).values(insertValues)
    return { action: "inserted" }
  }

  const dbRule = existing[0]

  // Build the "would-be" comparable row and compare economic fields.
  const wouldBe: Partial<RewardRule> = {
    ...insertValues,
    capAmountHkd: insertValues.capAmountHkd ?? null,
    capRewardAmount: insertValues.capRewardAmount ?? null,
    capPeriod: insertValues.capPeriod ?? null,
    capBasis: insertValues.capBasis ?? null,
    appliesTo: insertValues.appliesTo ?? null,
    exclusiveGroup: insertValues.exclusiveGroup ?? null,
    effectiveStart: insertValues.effectiveStart ?? null,
    effectiveEnd: insertValues.effectiveEnd ?? null,
    supersedesRuleId: insertValues.supersedesRuleId ?? null,
    categoryId: insertValues.categoryId ?? null,
  }

  const economicChanges = ECONOMIC_RULE_FIELDS.filter(
    (f) => !valuesEqual(dbRule[f], wouldBe[f]),
  )

  if (economicChanges.length > 0 && dbRule.status === "approved") {
    return {
      action: "refused",
      refusal: {
        ruleSlug: yamlRule.slug,
        changedFields: [...economicChanges],
        message: `Rule '${yamlRule.slug}' is approved and has economic changes (${economicChanges.join(", ")}). Rename the slug (e.g. add __v2 suffix) and add supersedesSlug=${yamlRule.slug} to the new rule. Draft rules can be edited in place.`,
      },
    }
  }

  const anyChanges = STATEFUL_RULE_FIELDS.filter(
    (f) => !valuesEqual(dbRule[f], wouldBe[f]),
  )
  if (anyChanges.length === 0) {
    return { action: "unchanged" }
  }

  await db
    .update(rewardRules)
    .set({ ...insertValues, updatedAt: new Date() })
    .where(eq(rewardRules.slug, yamlRule.slug))

  return { action: "updated" }
}

// Loose equality used to detect economic change.
//
// Postgres numeric columns return strings from the pg driver ("100000.00"),
// while YAML-side values are numbers (100000) or shorter strings ("100000").
// jsonb columns return objects but may have keys in a different order than
// the Zod-validated input. Both quirks are normalized here.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false

  if (looksNumeric(a) && looksNumeric(b)) {
    return Number(a) === Number(b)
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => valuesEqual(x, b[i]))
  }

  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>).sort()
    const bk = Object.keys(b as Record<string, unknown>).sort()
    if (ak.length !== bk.length) return false
    if (!ak.every((k, i) => k === bk[i])) return false
    return ak.every((k) =>
      valuesEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  }

  return a === b
}

function looksNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v)
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v)
  return false
}

// ---- upsert helper ----

async function upsertBySlug(
  _db: DB,
  lookup: () => Promise<{ id: string }[]>,
  insert: () => Promise<{ id: string }[]>,
  update: () => Promise<unknown>,
): Promise<string> {
  const found = await lookup()
  if (found[0]) {
    await update()
    return found[0].id
  }
  const inserted = await insert()
  if (!inserted[0]) {
    throw new Error("upsertBySlug: insert returned no rows")
  }
  return inserted[0].id
}

// Re-export to support a `pnpm db:reset && pnpm import:data` style flow in tests.
export { sql }
