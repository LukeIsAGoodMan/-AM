import { sql, desc } from "drizzle-orm"
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
  }
}
