import { asc, eq, and } from "drizzle-orm"
import { db } from "@/db/client"
import {
  campaigns,
  cards,
  categories,
  rewardCurrencies,
  sourceDocuments,
} from "@/db/schema/catalog"

// Lookup data the edit forms need so the user can pick FK targets by slug.
// Sources are scoped to the rule's card (per import rules, a rule's source
// must belong to the same card OR the issuer — we expand both); campaigns
// are scoped to the card + the card's issuer.

export async function loadRuleEditLookups(ruleCardSlug: string): Promise<{
  currencies: { slug: string; nameEn: string }[]
  categories: { slug: string; nameEn: string }[]
  sources: { slug: string; title: string }[]
  campaigns: { slug: string; name: string }[]
}> {
  const card = (
    await db
      .select({ id: cards.id, issuerId: cards.issuerId })
      .from(cards)
      .where(eq(cards.slug, ruleCardSlug))
  )[0]
  if (!card) {
    return { currencies: [], categories: [], sources: [], campaigns: [] }
  }

  const [currencies, categoryRows, sources, campaignRows] = await Promise.all([
    db
      .select({ slug: rewardCurrencies.slug, nameEn: rewardCurrencies.nameEn })
      .from(rewardCurrencies)
      .orderBy(asc(rewardCurrencies.slug)),
    db
      .select({ slug: categories.slug, nameEn: categories.nameEn })
      .from(categories)
      .orderBy(asc(categories.slug)),
    db
      .select({ slug: sourceDocuments.slug, title: sourceDocuments.title })
      .from(sourceDocuments)
      .where(
        // Sources may be card-scoped OR issuer-scoped (per M8 model).
        // Either kind is a valid citation for a rule under this card.
        and(eq(sourceDocuments.cardId, card.id)),
      )
      .orderBy(asc(sourceDocuments.slug)),
    db
      .select({ slug: campaigns.slug, name: campaigns.campaignName })
      .from(campaigns)
      .where(eq(campaigns.issuerId, card.issuerId))
      .orderBy(asc(campaigns.slug)),
  ])

  return {
    currencies,
    categories: categoryRows,
    sources,
    campaigns: campaignRows,
  }
}
