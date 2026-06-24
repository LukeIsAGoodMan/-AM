import { eq, sql } from "drizzle-orm"
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

export type RuleListRow = {
  id: string
  slug: string
  ruleName: string
  ruleType: string
  status: string
  rewardFormulaType: string
  rewardFormulaPayload: unknown
  rewardCurrencySlug: string | null
  cardSlug: string
  cardNameEn: string
  issuerSlug: string
  issuerNameEn: string
  categorySlug: string | null
  isOnline: boolean | null
  isOverseas: boolean | null
  isForeignCurrency: boolean | null
  requiresActivation: boolean
  requiresRegistration: boolean
  capAmountHkd: string | null
  capPeriod: string | null
  capBasis: string | null
  appliesTo: string[] | null
  stackingPolicy: string
  exclusiveGroup: string | null
  priority: number
  effectiveStart: string | null
  effectiveEnd: string | null
  confidenceScore: string
  sourceSlug: string | null
  campaignSlug: string | null
}

export async function listRules(): Promise<RuleListRow[]> {
  const rows = await db
    .select({
      id: rewardRules.id,
      slug: rewardRules.slug,
      ruleName: rewardRules.ruleName,
      ruleType: rewardRules.ruleType,
      status: rewardRules.status,
      rewardFormulaType: rewardRules.rewardFormulaType,
      rewardFormulaPayload: rewardRules.rewardFormulaPayload,
      rewardCurrencySlug: rewardCurrencies.slug,
      cardSlug: cards.slug,
      cardNameEn: cards.cardNameEn,
      issuerSlug: issuers.slug,
      issuerNameEn: issuers.nameEn,
      categorySlug: categories.slug,
      isOnline: rewardRules.isOnline,
      isOverseas: rewardRules.isOverseas,
      isForeignCurrency: rewardRules.isForeignCurrency,
      requiresActivation: rewardRules.requiresActivation,
      requiresRegistration: rewardRules.requiresRegistration,
      capAmountHkd: rewardRules.capAmountHkd,
      capPeriod: rewardRules.capPeriod,
      capBasis: rewardRules.capBasis,
      appliesTo: rewardRules.appliesTo,
      stackingPolicy: rewardRules.stackingPolicy,
      exclusiveGroup: rewardRules.exclusiveGroup,
      priority: rewardRules.priority,
      effectiveStart: rewardRules.effectiveStart,
      effectiveEnd: rewardRules.effectiveEnd,
      confidenceScore: rewardRules.confidenceScore,
      sourceSlug: sourceDocuments.slug,
      campaignSlug: campaigns.slug,
    })
    .from(rewardRules)
    .innerJoin(cards, eq(rewardRules.cardId, cards.id))
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .leftJoin(categories, eq(rewardRules.categoryId, categories.id))
    .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
    .leftJoin(sourceDocuments, eq(rewardRules.sourceId, sourceDocuments.id))
    .leftJoin(campaigns, eq(rewardRules.campaignId, campaigns.id))
    .orderBy(
      sql`CASE ${rewardRules.status}
        WHEN 'approved' THEN 0
        WHEN 'draft'    THEN 1
        WHEN 'archived' THEN 2
        ELSE 3 END`,
      cards.slug,
      sql`${rewardRules.priority} DESC`,
      rewardRules.slug,
    )

  return rows
}

export type RuleDetail = {
  rule: typeof rewardRules.$inferSelect
  card: typeof cards.$inferSelect
  issuer: typeof issuers.$inferSelect
  category: typeof categories.$inferSelect | null
  rewardCurrency: typeof rewardCurrencies.$inferSelect | null
  source: typeof sourceDocuments.$inferSelect | null
  campaign: typeof campaigns.$inferSelect | null
  supersedesRule: typeof rewardRules.$inferSelect | null
  supersededByRules: (typeof rewardRules.$inferSelect)[]
}

export async function getRuleDetail(slug: string): Promise<RuleDetail | null> {
  const found = await db
    .select()
    .from(rewardRules)
    .innerJoin(cards, eq(rewardRules.cardId, cards.id))
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .leftJoin(categories, eq(rewardRules.categoryId, categories.id))
    .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
    .leftJoin(sourceDocuments, eq(rewardRules.sourceId, sourceDocuments.id))
    .leftJoin(campaigns, eq(rewardRules.campaignId, campaigns.id))
    .where(eq(rewardRules.slug, slug))

  const row = found[0]
  if (!row) return null

  const [supersedesRule, supersededByRules] = await Promise.all([
    row.reward_rules.supersedesRuleId
      ? db
          .select()
          .from(rewardRules)
          .where(eq(rewardRules.id, row.reward_rules.supersedesRuleId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(rewardRules)
      .where(eq(rewardRules.supersedesRuleId, row.reward_rules.id)),
  ])

  return {
    rule: row.reward_rules,
    card: row.cards,
    issuer: row.issuers,
    category: row.categories,
    rewardCurrency: row.reward_currencies,
    source: row.source_documents,
    campaign: row.campaigns,
    supersedesRule,
    supersededByRules,
  }
}
