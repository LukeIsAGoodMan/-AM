import { eq, and, inArray, asc } from "drizzle-orm"
import { db } from "@/db/client"
import {
  campaigns,
  cards,
  categories,
  issuers,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
} from "@/db/schema/catalog"
import { RewardFormulaSchema } from "@/lib/schemas/formula"
import type {
  ResolvedRule,
  ResolvedCap,
  StackingPolicy,
} from "@/lib/calculator/resolved-rule"

// Bundle every read the /calculator-test page needs into one server fetch.
// Page is force-dynamic, so each request rebuilds this — keeps the YAML →
// import:data → reload feedback loop tight (M15's edit-form pre-cursor).

export type CalcTestCard = {
  cardSlug: string
  cardNameEn: string
  cardNameZh: string | null
  issuerSlug: string
  issuerNameEn: string
  rules: ResolvedRule[]
}

export type CalcTestCategory = {
  slug: string
  nameEn: string
  nameZh: string | null
}

export type CalcTestCampaign = {
  id: string
  slug: string
  name: string
  cardSlug: string | null
  issuerSlug: string
  requiresRegistration: boolean
}

export type CalcTestSourceInfo = {
  slug: string
  title: string
  url: string | null
}

export type CalcTestData = {
  cards: CalcTestCard[]
  categories: CalcTestCategory[]
  campaigns: CalcTestCampaign[]
  sourcesById: Record<string, CalcTestSourceInfo>
}

export async function loadCalculatorTestData(): Promise<CalcTestData> {
  // Active cards with their issuer.
  const cardRows = await db
    .select({
      id: cards.id,
      slug: cards.slug,
      nameEn: cards.cardNameEn,
      nameZh: cards.cardNameZh,
      issuerSlug: issuers.slug,
      issuerNameEn: issuers.nameEn,
    })
    .from(cards)
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .where(eq(cards.status, "active"))
    .orderBy(asc(issuers.slug), asc(cards.slug))

  const cardIds = cardRows.map((c) => c.id)

  // All approved rules across those cards, one query.
  const ruleRows = cardIds.length === 0
    ? []
    : await db
        .select({
          r: rewardRules,
          categorySlug: categories.slug,
          currencySlug: rewardCurrencies.slug,
          currencyValueHkd: rewardCurrencies.baseValueHkd,
        })
        .from(rewardRules)
        .leftJoin(categories, eq(rewardRules.categoryId, categories.id))
        .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
        .where(
          and(
            inArray(rewardRules.cardId, cardIds),
            eq(rewardRules.status, "approved"),
          ),
        )

  const rulesByCardId = new Map<string, ResolvedRule[]>()
  for (const row of ruleRows) {
    const bucket = rulesByCardId.get(row.r.cardId) ?? []
    bucket.push(mapRow(row))
    rulesByCardId.set(row.r.cardId, bucket)
  }

  const cardsOut: CalcTestCard[] = cardRows.map((c) => ({
    cardSlug: c.slug,
    cardNameEn: c.nameEn,
    cardNameZh: c.nameZh,
    issuerSlug: c.issuerSlug,
    issuerNameEn: c.issuerNameEn,
    rules: rulesByCardId.get(c.id) ?? [],
  }))

  const categoryRows = await db
    .select({
      slug: categories.slug,
      nameEn: categories.nameEn,
      nameZh: categories.nameZh,
    })
    .from(categories)
    .orderBy(asc(categories.slug))

  const campaignRows = await db
    .select({
      id: campaigns.id,
      slug: campaigns.slug,
      name: campaigns.campaignName,
      cardSlug: cards.slug,
      issuerSlug: issuers.slug,
      requiresRegistration: campaigns.requiresRegistration,
    })
    .from(campaigns)
    .innerJoin(issuers, eq(campaigns.issuerId, issuers.id))
    .leftJoin(cards, eq(campaigns.cardId, cards.id))
    .where(eq(campaigns.status, "approved"))

  // Source lookup keyed by id so the breakdown can show source slug/title/url.
  const sourceRows = await db
    .select({
      id: sourceDocuments.id,
      slug: sourceDocuments.slug,
      title: sourceDocuments.title,
      url: sourceDocuments.url,
    })
    .from(sourceDocuments)
  const sourcesById: Record<string, CalcTestSourceInfo> = {}
  for (const s of sourceRows) {
    sourcesById[s.id] = { slug: s.slug, title: s.title, url: s.url }
  }

  return {
    cards: cardsOut,
    categories: categoryRows,
    campaigns: campaignRows,
    sourcesById,
  }
}

type Row = {
  r: typeof rewardRules.$inferSelect
  categorySlug: string | null
  currencySlug: string | null
  currencyValueHkd: string | null
}

// Mirrors mapRow in queries/resolved-rules.ts. Kept in sync by hand — small
// enough to be obvious if it drifts.
function mapRow(row: Row): ResolvedRule {
  const r = row.r
  const formula = RewardFormulaSchema.parse(r.rewardFormulaPayload)
  const cap: ResolvedCap | null =
    r.capBasis !== null
      ? {
          usageKey: r.slug,
          basis: r.capBasis as ResolvedCap["basis"],
          period: (r.capPeriod as ResolvedCap["period"]) ?? "transaction",
          amountHkd: r.capAmountHkd !== null ? Number(r.capAmountHkd) : null,
          rewardAmount:
            r.capRewardAmount !== null ? Number(r.capRewardAmount) : null,
        }
      : null
  return {
    ruleId: r.slug,
    ruleName: r.ruleName,
    ruleType: r.ruleType,
    status: r.status as ResolvedRule["status"],
    formula,
    rewardCurrencySlug: row.currencySlug ?? "hkd_cashback",
    rewardCurrencyValueHkd: row.currencyValueHkd
      ? Number(row.currencyValueHkd)
      : 1.0,
    categorySlug: row.categorySlug,
    isOnline: r.isOnline,
    isOverseas: r.isOverseas,
    isForeignCurrency: r.isForeignCurrency,
    requiresActivation: r.requiresActivation,
    requiresRegistration: r.requiresRegistration,
    requiresSelectedCategory: r.requiresSelectedCategory,
    campaignId: r.campaignId,
    accrualKey: r.slug,
    cap,
    appliesTo: r.appliesTo,
    stackingPolicy: r.stackingPolicy as StackingPolicy,
    exclusiveGroup: r.exclusiveGroup,
    priority: r.priority,
    sourceId: r.sourceId,
    confidenceScore: Number(r.confidenceScore),
  }
}
