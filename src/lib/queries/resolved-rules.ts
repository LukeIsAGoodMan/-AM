import { eq, and } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  categories,
  rewardCurrencies,
  rewardRules,
} from "@/db/schema/catalog"
import { RewardFormulaSchema } from "@/lib/schemas/formula"
import {
  buildRewardCurrencyDisplay,
  parseCapsJson,
  type ResolvedRule,
  type StackingPolicy,
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
      currencyNameEn: rewardCurrencies.nameEn,
      currencyNameZh: rewardCurrencies.nameZh,
    })
    .from(rewardRules)
    .leftJoin(categories, eq(rewardRules.categoryId, categories.id))
    .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
    .where(
      and(
        eq(rewardRules.cardId, card[0].id),
        eq(rewardRules.status, "approved"),
        // P18 (D28): candidate / alt-mode / rejected rules are visible in
        // /rules but must NOT earn in the calculator.
        eq(rewardRules.isActiveForCalculator, true),
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
        currencyNameEn: rewardCurrencies.nameEn,
        currencyNameZh: rewardCurrencies.nameZh,
      })
      .from(rewardRules)
      .leftJoin(categories, eq(rewardRules.categoryId, categories.id))
      .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
      .where(
        and(
          eq(rewardRules.cardId, c.id),
          eq(rewardRules.status, "approved"),
          eq(rewardRules.isActiveForCalculator, true),
        ),
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
  currencyNameEn: string | null
  currencyNameZh: string | null
}

function mapRow(row: Row): ResolvedRule {
  const r = row.r
  // jsonb is unknown at TS level — validate via the same Zod schema that
  // gated the import. If a row in DB is malformed, fail loud here rather
  // than silently miscompute.
  const formula = RewardFormulaSchema.parse(r.rewardFormulaPayload)

  // D19: a points_per_hkd rule with NULL reward_currency_id can only happen
  // if the row was inserted without going through syncer's currency check
  // (i.e. the P7 materializer bug that landed miles rules with a null FK).
  // Fallbacking to hkd_cashback + 1.0 HKD/mile silently inflates rewards
  // ~10×. Refuse to serve — force the fix upstream.
  if (formula.type === "points_per_hkd" && row.currencyValueHkd === null) {
    throw new Error(
      `Rule '${r.slug}' is points_per_hkd but reward_currency_id is NULL. ` +
        `This means the payload's currencySlug isn't in reward_currencies. ` +
        `Refusing to load — see D19.`,
    )
  }

  // P17 (D23): caps is a jsonb array — a rule may carry N concurrent caps
  // (category-specific + card-wide is the common pair). parseCapsJson
  // validates shape and drops malformed entries.
  const caps = parseCapsJson(r.caps, r.slug)

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
    rewardCurrency: buildRewardCurrencyDisplay(
      row.currencySlug ?? "hkd_cashback",
      row.currencyNameEn,
      row.currencyNameZh,
    ),
    categorySlug: row.categorySlug,
    isOnline: r.isOnline,
    isOverseas: r.isOverseas,
    isForeignCurrency: r.isForeignCurrency,
    requiresActivation: r.requiresActivation,
    requiresRegistration: r.requiresRegistration,
    requiresSelectedCategory: r.requiresSelectedCategory,
    campaignId: r.campaignId,
    accrualKey: r.slug,
    caps,
    appliesTo: r.appliesTo,
    stackingPolicy: r.stackingPolicy as StackingPolicy,
    exclusiveGroup: r.exclusiveGroup,
    priority: r.priority,
    sourceId: r.sourceId,
    confidenceScore: Number(r.confidenceScore),
  }
}
