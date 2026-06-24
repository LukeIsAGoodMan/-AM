import { eq, sql, desc } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  issuers,
  rewardRules,
  sourceDocuments,
  welcomeOffers,
} from "@/db/schema/catalog"

// Server-side query helpers used by the admin pages. Kept thin — pages
// stay declarative; complex joins / aggregations live here so the same
// shape can power /calculator-test later.

export type CardListRow = {
  id: string
  slug: string
  cardNameEn: string
  cardNameZh: string | null
  issuerSlug: string
  issuerNameEn: string
  network: string | null
  status: string
  annualFeeHkd: string | null
  ruleCount: number
  approvedRuleCount: number
  sourceCount: number
}

export async function listCards(): Promise<CardListRow[]> {
  const ruleCountsByCard = db.$with("rule_counts").as(
    db
      .select({
        cardId: rewardRules.cardId,
        ruleTotal: sql<number>`COUNT(*)::int`.as("rule_total"),
        ruleApproved: sql<number>`COUNT(*) FILTER (WHERE ${rewardRules.status} = 'approved')::int`.as("rule_approved"),
      })
      .from(rewardRules)
      .groupBy(rewardRules.cardId),
  )
  const sourceCountsByCard = db.$with("source_counts").as(
    db
      .select({
        cardId: sourceDocuments.cardId,
        sourceTotal: sql<number>`COUNT(*)::int`.as("source_total"),
      })
      .from(sourceDocuments)
      .groupBy(sourceDocuments.cardId),
  )

  const rows = await db
    .with(ruleCountsByCard, sourceCountsByCard)
    .select({
      id: cards.id,
      slug: cards.slug,
      cardNameEn: cards.cardNameEn,
      cardNameZh: cards.cardNameZh,
      issuerSlug: issuers.slug,
      issuerNameEn: issuers.nameEn,
      network: cards.network,
      status: cards.status,
      annualFeeHkd: cards.annualFeeHkd,
      ruleCount: sql<number>`COALESCE(${ruleCountsByCard.ruleTotal}, 0)::int`,
      approvedRuleCount: sql<number>`COALESCE(${ruleCountsByCard.ruleApproved}, 0)::int`,
      sourceCount: sql<number>`COALESCE(${sourceCountsByCard.sourceTotal}, 0)::int`,
    })
    .from(cards)
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .leftJoin(ruleCountsByCard, eq(ruleCountsByCard.cardId, cards.id))
    .leftJoin(sourceCountsByCard, eq(sourceCountsByCard.cardId, cards.id))
    .orderBy(cards.status, issuers.slug, cards.slug)

  return rows.map((r) => ({
    ...r,
    annualFeeHkd: r.annualFeeHkd ?? null,
  }))
}

export type CardDetail = {
  card: typeof cards.$inferSelect
  issuer: typeof issuers.$inferSelect
  rules: (typeof rewardRules.$inferSelect)[]
  sources: (typeof sourceDocuments.$inferSelect)[]
  welcomeOffersList: (typeof welcomeOffers.$inferSelect)[]
}

export async function getCardDetail(slug: string): Promise<CardDetail | null> {
  const found = await db
    .select()
    .from(cards)
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .where(eq(cards.slug, slug))
  const row = found[0]
  if (!row) return null

  const cardId = row.cards.id

  const [rulesList, sourcesList, welcomeList] = await Promise.all([
    db
      .select()
      .from(rewardRules)
      .where(eq(rewardRules.cardId, cardId))
      .orderBy(rewardRules.status, desc(rewardRules.priority), rewardRules.slug),
    db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.cardId, cardId))
      .orderBy(sourceDocuments.sourcePriority, sourceDocuments.slug),
    db
      .select()
      .from(welcomeOffers)
      .where(eq(welcomeOffers.cardId, cardId))
      .orderBy(welcomeOffers.status, welcomeOffers.slug),
  ])

  return {
    card: row.cards,
    issuer: row.issuers,
    rules: rulesList,
    sources: sourcesList,
    welcomeOffersList: welcomeList,
  }
}
