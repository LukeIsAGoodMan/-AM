import { eq } from "drizzle-orm"
import type { DB } from "./client"
import {
  cards,
  issuers,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
} from "./schema/catalog"

// M1 seed: 1 issuer, 1 currency, 1 source, 1 card, 1 rule.
// Idempotent — re-running is safe; on slug conflict we look up the existing row.
// YAML-driven import replaces this script in M6.

export async function seed(db: DB) {
  const citi = await upsertById(
    () =>
      db.select({ id: issuers.id }).from(issuers).where(eq(issuers.slug, "citi")),
    () =>
      db
        .insert(issuers)
        .values({
          slug: "citi",
          nameEn: "Citi",
          nameZh: "花旗",
          websiteUrl: "https://www.citibank.com.hk",
        })
        .returning({ id: issuers.id }),
  )

  const hkdCashback = await upsertById(
    () =>
      db
        .select({ id: rewardCurrencies.id })
        .from(rewardCurrencies)
        .where(eq(rewardCurrencies.slug, "hkd_cashback")),
    () =>
      db
        .insert(rewardCurrencies)
        .values({
          slug: "hkd_cashback",
          nameEn: "HKD Cashback",
          nameZh: "港幣現金回贈",
          type: "cashback",
          baseValueHkd: "1.000000",
          valuationNote: "1 unit = HKD 1.00",
        })
        .returning({ id: rewardCurrencies.id }),
  )

  const citiCashBackSource = await upsertById(
    () =>
      db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.slug, "citi-cash-back-official-page")),
    () =>
      db
        .insert(sourceDocuments)
        .values({
          slug: "citi-cash-back-official-page",
          issuerId: citi,
          sourceType: "official_page",
          sourcePriority: 2,
          title: "Citi Cash Back Card — official product page",
          url: "https://www.citibank.com.hk/english/credit-cards/cash-back-card/index.htm",
          language: "mixed",
          status: "active",
          notes:
            "M1 placeholder source. Replace with real T&C PDF in M2/M9.",
        })
        .returning({ id: sourceDocuments.id }),
  )

  const citiCashBack = await upsertById(
    () =>
      db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.slug, "citi-cash-back")),
    () =>
      db
        .insert(cards)
        .values({
          issuerId: citi,
          slug: "citi-cash-back",
          productFamily: "Citi Cash Back",
          cardNameEn: "Citi Cash Back Card",
          cardNameZh: "Citi 現金回贈信用卡",
          network: "Visa",
          cardLevel: "platinum",
          status: "active",
          officialUrl:
            "https://www.citibank.com.hk/english/credit-cards/cash-back-card/index.htm",
          notes:
            "M1 simplification: modeled as flat 1.2% base earn. Real card has tiered rates added in M2/M3.",
        })
        .returning({ id: cards.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "citi-cash-back__base_earn")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: citiCashBack,
          slug: "citi-cash-back__base_earn",
          ruleName: "Base earn",
          ruleType: "base_earn",
          status: "approved",
          rewardFormulaType: "simple_percent",
          rewardFormulaPayload: { type: "simple_percent", rate: 0.012 },
          rewardCurrencyId: hkdCashback,
          sourceId: citiCashBackSource,
          confidenceScore: "0.900",
          notes:
            "M1 simplification. Real rate varies by category; modeled as flat 1.2% to validate pipeline.",
        })
        .returning({ id: rewardRules.id }),
  )

  return {
    issuerId: citi,
    rewardCurrencyId: hkdCashback,
    sourceId: citiCashBackSource,
    cardId: citiCashBack,
  }
}

async function upsertById(
  lookup: () => Promise<{ id: string }[]>,
  insert: () => Promise<{ id: string }[]>,
): Promise<string> {
  const found = await lookup()
  if (found[0]) return found[0].id
  const inserted = await insert()
  if (!inserted[0]) {
    throw new Error("upsertById: insert returned no rows")
  }
  return inserted[0].id
}
