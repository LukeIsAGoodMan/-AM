import { eq, and } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  categories,
  rewardCurrencies,
  rewardRules,
} from "@/db/schema/catalog"
import { RewardFormulaSchema } from "@/lib/schemas/formula"
import type {
  ResolvedRule,
  ResolvedCap,
  StackingPolicy,
} from "@/lib/calculator/resolved-rule"

// Maps approved reward_rules rows for a card into the ResolvedRule shape
// the pure calculator consumes. This is M14 plumbing — used now by the
// diagnostic script + later by /calculator-test.

export async function loadResolvedRulesForCard(
  cardSlug: string,
): Promise<{
  cardId: string
  cardNameEn: string
  rules: ResolvedRule[]
} | null> {
  const card = await db
    .select({
      id: cards.id,
      nameEn: cards.cardNameEn,
    })
    .from(cards)
    .where(eq(cards.slug, cardSlug))
  if (!card[0]) return null

  const rows = await db
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
        eq(rewardRules.cardId, card[0].id),
        eq(rewardRules.status, "approved"),
      ),
    )

  const resolved = rows.map((row) => mapRow(row))
  return { cardId: card[0].id, cardNameEn: card[0].nameEn, rules: resolved }
}

export async function loadResolvedRulesForAllActiveCards(): Promise<
  { cardId: string; cardSlug: string; cardNameEn: string; rules: ResolvedRule[] }[]
> {
  const activeCards = await db
    .select({ id: cards.id, slug: cards.slug, nameEn: cards.cardNameEn })
    .from(cards)
    .where(eq(cards.status, "active"))

  const out: {
    cardId: string
    cardSlug: string
    cardNameEn: string
    rules: ResolvedRule[]
  }[] = []
  for (const c of activeCards) {
    const rows = await db
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
        and(eq(rewardRules.cardId, c.id), eq(rewardRules.status, "approved")),
      )
    out.push({
      cardId: c.id,
      cardSlug: c.slug,
      cardNameEn: c.nameEn,
      rules: rows.map((row) => mapRow(row)),
    })
  }
  return out
}

type Row = {
  r: typeof rewardRules.$inferSelect
  categorySlug: string | null
  currencySlug: string | null
  currencyValueHkd: string | null
}

function mapRow(row: Row): ResolvedRule {
  const r = row.r
  // jsonb is unknown at TS level — validate via the same Zod schema that
  // gated the import. If a row in DB is malformed, fail loud here rather
  // than silently miscompute.
  const formula = RewardFormulaSchema.parse(r.rewardFormulaPayload)

  const cap: ResolvedCap | null =
    r.capBasis !== null
      ? {
          usageKey: r.slug,
          basis: r.capBasis as ResolvedCap["basis"],
          period:
            (r.capPeriod as ResolvedCap["period"]) ?? "transaction",
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
