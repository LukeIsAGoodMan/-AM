import { eq, sql, inArray, asc } from "drizzle-orm"
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
import {
  crossCheckGroups,
  rewardRuleSources,
  sourceClaims,
} from "@/db/schema/extraction"

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

export type RuleProvenanceClaim = {
  claimId: string
  extractedTextSnippet: string
  structuredPayload: unknown
  confidence: string
  extractedBy: string
  reviewerNote: string | null
  source: {
    id: string
    slug: string
    title: string
    sourcePriority: number
    url: string | null
  }
}

export type RuleProvenance = {
  // The cross_check_group whose materialization produced this rule.
  // null when reward_rule_sources rows exist but none of them ties
  // back to a group (e.g., manual provenance entry).
  group: {
    id: string
    claimType: string
    keyDimension: string
    status: string
    aggregateConfidence: string
    canonicalPayload: unknown
    contradictingClaimIds: string[]
  } | null
  // One entry per supporting source (deduped on source_id by the
  // materializer's m:n join row layout).
  supportingClaims: RuleProvenanceClaim[]
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
  // P10 — populated when reward_rule_sources rows exist for this rule
  // (the P7 materializer writes them). null for hand-curated YAML rules.
  provenance: RuleProvenance | null
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

  const [supersedesRule, supersededByRules, provenance] = await Promise.all([
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
    loadProvenance(row.reward_rules.id),
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
    provenance,
  }
}

// Load the cross-check provenance for a rule: the group it was
// materialized from + every supporting claim (with source meta). Returns
// null for hand-curated YAML rules (no reward_rule_sources rows). One
// round trip for the join rows + one for the claims + one for the
// group: three queries even for the worst case of a 10-source rule.
async function loadProvenance(ruleId: string): Promise<RuleProvenance | null> {
  const joinRows = await db
    .select({ supportingClaimId: rewardRuleSources.supportingClaimId })
    .from(rewardRuleSources)
    .where(eq(rewardRuleSources.ruleId, ruleId))
  if (joinRows.length === 0) return null

  // supportingClaimId is nullable on the schema, but P7's materializer
  // always sets it. Filter for safety so a future manual provenance row
  // without a claim doesn't crash the page.
  const claimIds = joinRows
    .map((j) => j.supportingClaimId)
    .filter((id): id is string => id !== null)
  if (claimIds.length === 0) {
    return { group: null, supportingClaims: [] }
  }

  const claimRows = await db
    .select({
      claim: sourceClaims,
      source: sourceDocuments,
    })
    .from(sourceClaims)
    .innerJoin(sourceDocuments, eq(sourceClaims.sourceId, sourceDocuments.id))
    .where(inArray(sourceClaims.id, claimIds))
    .orderBy(asc(sourceDocuments.sourcePriority), asc(sourceClaims.createdAt))

  // All claims in a materialization come from the same cross_check_group
  // (P7 materializes one group at a time). Read the group from the first
  // claim's pointer, then trust the rest match.
  const firstGroupId = claimRows[0]?.claim.crossCheckGroupId ?? null
  const groupRow = firstGroupId
    ? (
        await db
          .select()
          .from(crossCheckGroups)
          .where(eq(crossCheckGroups.id, firstGroupId))
          .limit(1)
      )[0]
    : null

  return {
    group: groupRow
      ? {
          id: groupRow.id,
          claimType: groupRow.claimType,
          keyDimension: groupRow.keyDimension,
          status: groupRow.status,
          aggregateConfidence: groupRow.aggregateConfidence,
          canonicalPayload: groupRow.canonicalPayload,
          contradictingClaimIds: groupRow.contradictingClaimIds,
        }
      : null,
    supportingClaims: claimRows.map((r) => ({
      claimId: r.claim.id,
      extractedTextSnippet: r.claim.extractedTextSnippet,
      structuredPayload: r.claim.structuredPayload,
      confidence: r.claim.confidenceScore,
      extractedBy: r.claim.extractedBy,
      reviewerNote: r.claim.reviewerNote,
      source: {
        id: r.source.id,
        slug: r.source.slug,
        title: r.source.title,
        sourcePriority: r.source.sourcePriority,
        url: r.source.url,
      },
    })),
  }
}
