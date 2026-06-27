import { sql, desc, eq } from "drizzle-orm"
import { db } from "@/db/client"
import {
  campaigns,
  cards,
  categories,
  issuers,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
  welcomeOffers,
} from "@/db/schema/catalog"
import {
  crossCheckGroups,
  extractionRuns,
  reviewTasks,
  sourceClaims,
} from "@/db/schema/extraction"

// Counts + ratios for /dashboard. The custom_note ratio is the load-bearing
// schema-health metric (PRD §5 principle 4 / roadmap M9 checkpoint): a
// rising ratio means the schema is failing to model real cards and the
// reviewer is reaching for the escape hatch.

export type DashboardData = {
  catalogCounts: {
    issuers: number
    activeCards: number
    draftCards: number
    totalCards: number
    approvedRules: number
    totalRules: number
    archivedRules: number
    approvedWelcomeOffers: number
    activeCampaigns: number
    activeSources: number
    extractedSources: number
    categories: number
    currencies: number
  }
  customNote: {
    approvedTotal: number
    customNoteCount: number
    ratioPct: number
  }
  rulesByType: { ruleType: string; count: number }[]
  rulesByStatus: { status: string; count: number }[]
  cardsByIssuer: { issuerSlug: string; total: number; active: number }[]
  recentlyUpdatedRules: {
    slug: string
    ruleName: string
    cardSlug: string
    status: string
    updatedAt: Date
  }[]
  // Phase 2 extraction telemetry (PRD §22.10 #5 — operator should see
  // what extraction costs + how big the review backlog is at a glance).
  extraction: {
    totalRuns: number
    succeededRuns: number
    failedRuns: number
    totalClaimsEmitted: number
    totalCostUsdCents: number
    avgLatencyMs: number
  }
  reviewQueue: {
    openTasks: number
    openConflicts: number
    openSingleSource: number
    openAgreedToConfirm: number
    resolvedTasks: number
    dismissedTasks: number
  }
  crossCheck: {
    totalGroups: number
    agreedGroups: number
    singleSourceGroups: number
    conflictGroups: number
    materializedRules: number
    // (slug, rule_count) for the top-5 cards by P7-materialized rule count.
    // Surfaces "which cards has the cross-check pipe produced the most
    // for so far" — directional read on Phase 2 coverage.
    topCardsByMaterializedRules: { cardSlug: string; ruleCount: number }[]
  }
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [
    issuerCount,
    cardCounts,
    ruleCounts,
    welcomeCount,
    campaignCount,
    sourceCounts,
    categoryCount,
    currencyCount,
    customNote,
    rulesByType,
    rulesByStatus,
    cardsByIssuer,
    recentlyUpdatedRules,
    extractionAgg,
    reviewAgg,
    crossCheckAgg,
    topMaterialized,
  ] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)::int` }).from(issuers),
    db
      .select({
        active: sql<number>`COUNT(*) FILTER (WHERE ${cards.status}='active')::int`,
        draft: sql<number>`COUNT(*) FILTER (WHERE ${cards.status}='draft')::int`,
        total: sql<number>`COUNT(*)::int`,
      })
      .from(cards),
    db
      .select({
        approved: sql<number>`COUNT(*) FILTER (WHERE ${rewardRules.status}='approved')::int`,
        archived: sql<number>`COUNT(*) FILTER (WHERE ${rewardRules.status}='archived')::int`,
        total: sql<number>`COUNT(*)::int`,
      })
      .from(rewardRules),
    db
      .select({
        n: sql<number>`COUNT(*) FILTER (WHERE ${welcomeOffers.status}='approved')::int`,
      })
      .from(welcomeOffers),
    db
      .select({
        n: sql<number>`COUNT(*) FILTER (WHERE ${campaigns.status}='approved')::int`,
      })
      .from(campaigns),
    db
      .select({
        active: sql<number>`COUNT(*) FILTER (WHERE ${sourceDocuments.status}='active')::int`,
        extracted: sql<number>`COUNT(*) FILTER (WHERE ${sourceDocuments.extractedText} IS NOT NULL)::int`,
      })
      .from(sourceDocuments),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(categories),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(rewardCurrencies),
    db
      .select({
        approvedTotal: sql<number>`COUNT(*) FILTER (WHERE ${rewardRules.status}='approved')::int`,
        customNoteCount: sql<number>`COUNT(*) FILTER (WHERE ${rewardRules.status}='approved' AND ${rewardRules.rewardFormulaType}='custom_note')::int`,
      })
      .from(rewardRules),
    db
      .select({
        ruleType: rewardRules.ruleType,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(rewardRules)
      .where(sql`${rewardRules.status} = 'approved'`)
      .groupBy(rewardRules.ruleType)
      .orderBy(desc(sql<number>`COUNT(*)`)),
    db
      .select({
        status: rewardRules.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(rewardRules)
      .groupBy(rewardRules.status)
      .orderBy(desc(sql<number>`COUNT(*)`)),
    db
      .select({
        issuerSlug: issuers.slug,
        total: sql<number>`COUNT(*)::int`,
        active: sql<number>`COUNT(*) FILTER (WHERE ${cards.status}='active')::int`,
      })
      .from(cards)
      .innerJoin(issuers, sql`${cards.issuerId} = ${issuers.id}`)
      .groupBy(issuers.slug)
      .orderBy(desc(sql<number>`COUNT(*)`)),
    db
      .select({
        slug: rewardRules.slug,
        ruleName: rewardRules.ruleName,
        cardSlug: cards.slug,
        status: rewardRules.status,
        updatedAt: rewardRules.updatedAt,
      })
      .from(rewardRules)
      .innerJoin(cards, sql`${rewardRules.cardId} = ${cards.id}`)
      .orderBy(desc(rewardRules.updatedAt))
      .limit(10),
    // Phase 2 — extraction_runs aggregates. COUNT FILTER + SUM in one
    // pass instead of three separate queries.
    db
      .select({
        totalRuns: sql<number>`COUNT(*)::int`,
        succeededRuns: sql<number>`COUNT(*) FILTER (WHERE ${extractionRuns.status}='succeeded')::int`,
        failedRuns: sql<number>`COUNT(*) FILTER (WHERE ${extractionRuns.status}='failed')::int`,
        totalClaimsEmitted: sql<number>`COALESCE(SUM(${extractionRuns.claimsEmitted}), 0)::int`,
        totalCostUsdCents: sql<number>`COALESCE(SUM(${extractionRuns.costUsdCents}), 0)::int`,
        avgLatencyMs: sql<number>`COALESCE(AVG(${extractionRuns.latencyMs}), 0)::int`,
      })
      .from(extractionRuns),
    // review_tasks bucketing by status × group verdict. Mirrors the
    // /review queue's header subtitle so the dashboard tells the same
    // story without forcing a tab-switch.
    db
      .select({
        openTasks: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='open')::int`,
        openConflicts: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='open' AND ${reviewTasks.taskType}='conflict_resolution')::int`,
        openSingleSource: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='open' AND ${reviewTasks.taskType}='claim_review')::int`,
        openAgreedToConfirm: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='open' AND ${reviewTasks.taskType}='cross_check_confirmation')::int`,
        resolvedTasks: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='resolved')::int`,
        dismissedTasks: sql<number>`COUNT(*) FILTER (WHERE ${reviewTasks.status}='dismissed')::int`,
      })
      .from(reviewTasks),
    // cross_check_groups verdict distribution + materialized-count.
    db
      .select({
        totalGroups: sql<number>`COUNT(*)::int`,
        agreedGroups: sql<number>`COUNT(*) FILTER (WHERE ${crossCheckGroups.status}='agreed')::int`,
        singleSourceGroups: sql<number>`COUNT(*) FILTER (WHERE ${crossCheckGroups.status}='single_source')::int`,
        conflictGroups: sql<number>`COUNT(*) FILTER (WHERE ${crossCheckGroups.status}='conflict')::int`,
        materializedRules: sql<number>`COUNT(*) FILTER (WHERE ${crossCheckGroups.approvedRuleId} IS NOT NULL)::int`,
      })
      .from(crossCheckGroups),
    // Per-card materialized-rule count, top 5 by descending count. Joins
    // to cards for the slug. Uses the xchk__ slug prefix as the
    // materialization marker (matches D16's slug convention).
    db
      .select({
        cardSlug: cards.slug,
        ruleCount: sql<number>`COUNT(*)::int`,
      })
      .from(rewardRules)
      .innerJoin(cards, eq(rewardRules.cardId, cards.id))
      .where(sql`${rewardRules.slug} LIKE 'xchk__%'`)
      .groupBy(cards.slug)
      .orderBy(desc(sql<number>`COUNT(*)`))
      .limit(5),
  ])

  const c = cardCounts[0]!
  const r = ruleCounts[0]!
  const cn = customNote[0]!
  const ratioPct =
    cn.approvedTotal === 0 ? 0 : (cn.customNoteCount / cn.approvedTotal) * 100

  return {
    catalogCounts: {
      issuers: issuerCount[0]!.n,
      activeCards: c.active,
      draftCards: c.draft,
      totalCards: c.total,
      approvedRules: r.approved,
      archivedRules: r.archived,
      totalRules: r.total,
      approvedWelcomeOffers: welcomeCount[0]!.n,
      activeCampaigns: campaignCount[0]!.n,
      activeSources: sourceCounts[0]!.active,
      extractedSources: sourceCounts[0]!.extracted,
      categories: categoryCount[0]!.n,
      currencies: currencyCount[0]!.n,
    },
    customNote: {
      approvedTotal: cn.approvedTotal,
      customNoteCount: cn.customNoteCount,
      ratioPct,
    },
    rulesByType,
    rulesByStatus,
    cardsByIssuer,
    recentlyUpdatedRules,
    extraction: extractionAgg[0]!,
    reviewQueue: reviewAgg[0]!,
    crossCheck: {
      ...crossCheckAgg[0]!,
      topCardsByMaterializedRules: topMaterialized,
    },
  }
}

// Reference unused imports introduced for Phase 2 telemetry — used in
// the bucketed COUNT FILTER clauses above.
void sourceClaims
