import { eq, and, inArray, asc } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  categories,
  issuers,
  rewardCurrencies,
  rewardRules,
  welcomeOffers,
} from "@/db/schema/catalog"
import { RewardFormulaSchema } from "@/lib/schemas/formula"
import type {
  ResolvedRule,
  ResolvedCap,
  StackingPolicy,
} from "@/lib/calculator/resolved-rule"
import type { ResolvedWelcomeOffer } from "@/lib/simulation/types"

// One server fetch backs the /projection-test page. Mirrors the calculator-
// test query but bolts on each card's approved welcome offers so the
// simulator can add their estimatedValueHkd one-shot.

export type ProjectionTestCard = {
  cardSlug: string
  cardNameEn: string
  cardNameZh: string | null
  issuerSlug: string
  issuerNameEn: string
  rules: ResolvedRule[]
  welcomeOffers: ResolvedWelcomeOffer[]
}

export type ProjectionTestCategory = {
  slug: string
  nameEn: string
  nameZh: string | null
}

export type ProjectionTestData = {
  cards: ProjectionTestCard[]
  categories: ProjectionTestCategory[]
}

export async function loadProjectionTestData(): Promise<ProjectionTestData> {
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

  const welcomeRows = cardIds.length === 0
    ? []
    : await db
        .select({
          cardId: welcomeOffers.cardId,
          id: welcomeOffers.id,
          slug: welcomeOffers.slug,
          offerName: welcomeOffers.offerName,
          estimatedValueHkd: welcomeOffers.estimatedValueHkd,
        })
        .from(welcomeOffers)
        .where(
          and(
            inArray(welcomeOffers.cardId, cardIds),
            eq(welcomeOffers.status, "approved"),
          ),
        )

  const welcomesByCardId = new Map<string, ResolvedWelcomeOffer[]>()
  for (const w of welcomeRows) {
    // Skip offers with no estimated value — the simulator can't price them.
    if (w.estimatedValueHkd === null) continue
    const bucket = welcomesByCardId.get(w.cardId) ?? []
    bucket.push({
      offerId: w.id,
      offerName: w.offerName,
      estimatedValueHkd: Number(w.estimatedValueHkd),
    })
    welcomesByCardId.set(w.cardId, bucket)
  }

  const cardsOut: ProjectionTestCard[] = cardRows.map((c) => ({
    cardSlug: c.slug,
    cardNameEn: c.nameEn,
    cardNameZh: c.nameZh,
    issuerSlug: c.issuerSlug,
    issuerNameEn: c.issuerNameEn,
    rules: rulesByCardId.get(c.id) ?? [],
    welcomeOffers: welcomesByCardId.get(c.id) ?? [],
  }))

  const categoryRows = await db
    .select({
      slug: categories.slug,
      nameEn: categories.nameEn,
      nameZh: categories.nameZh,
    })
    .from(categories)
    .orderBy(asc(categories.slug))

  return { cards: cardsOut, categories: categoryRows }
}

type Row = {
  r: typeof rewardRules.$inferSelect
  categorySlug: string | null
  currencySlug: string | null
  currencyValueHkd: string | null
}

// Mirrors mapRow in calculator-test.ts / resolved-rules.ts. Hand-kept in sync.
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
