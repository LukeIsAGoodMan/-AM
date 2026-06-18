import { eq } from "drizzle-orm"
import type { DB } from "./client"
import {
  cards,
  issuers,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
} from "./schema/catalog"
import { seedCategories } from "./seed-categories"

// M3 seed: 3 issuers, 1 currency, 30+ categories, 3 sources, 3 cards, 4 rules.
//   Citi Cash Back  (M1) — flat 1.2% base earn
//   HSBC Red        (M2) — 0.4% base + 4% online_local capped at HKD 100k/yr
//   Hang Seng MPOWER(M3) — tiered_percent monthly:
//                          [0, 4000) @ 0.4%, [4000, ∞) @ 5%
//                          requires_registration=true
//
// Roadmap M3 named HSBC EveryMile; real EveryMile is category-based
// (HK$4/HK$8 = 1 mile by online/overseas), not monthly tier. MPOWER is
// the closer stress fit. Both are simplifications of real products.
//
// Idempotent — re-running is safe.
// YAML-driven import replaces this script in M6.

export async function seed(db: DB) {
  const categoryIds = await seedCategories(db)

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

  // ---------- Citi Cash Back (M1) ----------

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
            "M1 simplification: modeled as flat 1.2% base earn. Real card has tiered rates added in M3.",
        })
        .returning({ id: cards.id }),
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
          cardId: citiCashBack,
          sourceType: "official_page",
          sourcePriority: 2,
          title: "Citi Cash Back Card — official product page",
          url: "https://www.citibank.com.hk/english/credit-cards/cash-back-card/index.htm",
          language: "mixed",
          status: "active",
          notes:
            "M1 placeholder source. Replace with real T&C PDF in M9.",
        })
        .returning({ id: sourceDocuments.id }),
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

  // ---------- HSBC Red (M2) ----------

  const hsbc = await upsertById(
    () =>
      db.select({ id: issuers.id }).from(issuers).where(eq(issuers.slug, "hsbc")),
    () =>
      db
        .insert(issuers)
        .values({
          slug: "hsbc",
          nameEn: "HSBC",
          nameZh: "滙豐",
          websiteUrl: "https://www.hsbc.com.hk",
        })
        .returning({ id: issuers.id }),
  )

  const hsbcRed = await upsertById(
    () =>
      db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red")),
    () =>
      db
        .insert(cards)
        .values({
          issuerId: hsbc,
          slug: "hsbc-red",
          productFamily: "HSBC Red",
          cardNameEn: "HSBC Red Credit Card",
          cardNameZh: "HSBC Red 信用卡",
          network: "Visa",
          cardLevel: "platinum",
          status: "active",
          officialUrl:
            "https://www.hsbc.com.hk/credit-cards/products/red/",
          notes:
            "M2 modeling: 0.4% base + 4% online_local up to HKD 100k/yr eligible spend. Real exclusions added in M4.",
        })
        .returning({ id: cards.id }),
  )

  const hsbcRedSource = await upsertById(
    () =>
      db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.slug, "hsbc-red-official-page")),
    () =>
      db
        .insert(sourceDocuments)
        .values({
          slug: "hsbc-red-official-page",
          issuerId: hsbc,
          cardId: hsbcRed,
          sourceType: "official_page",
          sourcePriority: 2,
          title: "HSBC Red Credit Card — official product page",
          url: "https://www.hsbc.com.hk/credit-cards/products/red/",
          language: "mixed",
          status: "active",
          notes:
            "M2 placeholder source. Replace with real T&C PDF in M9.",
        })
        .returning({ id: sourceDocuments.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "hsbc-red__base_earn")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: hsbcRed,
          slug: "hsbc-red__base_earn",
          ruleName: "Base earn (0.4%)",
          ruleType: "base_earn",
          status: "approved",
          rewardFormulaType: "simple_percent",
          rewardFormulaPayload: { type: "simple_percent", rate: 0.004 },
          rewardCurrencyId: hkdCashback,
          sourceId: hsbcRedSource,
          confidenceScore: "0.900",
        })
        .returning({ id: rewardRules.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "hsbc-red__online_local_bonus")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: hsbcRed,
          slug: "hsbc-red__online_local_bonus",
          ruleName: "Online local 4% bonus",
          ruleType: "online_bonus",
          status: "approved",
          rewardFormulaType: "simple_percent",
          rewardFormulaPayload: { type: "simple_percent", rate: 0.04 },
          rewardCurrencyId: hkdCashback,
          categoryId: categoryIds.get("online_local"),
          isOnline: true,
          isOverseas: false,
          capAmountHkd: "100000.00",
          capPeriod: "year",
          capBasis: "spending",
          sourceId: hsbcRedSource,
          confidenceScore: "0.850",
          notes:
            "Tax / e-wallet topup exclusions arrive in M4 (exclusion rules with applies_to).",
        })
        .returning({ id: rewardRules.id }),
  )

  // ---------- Hang Seng MPOWER (M3 adversarial: monthly tiered) ----------

  const hangSeng = await upsertById(
    () =>
      db
        .select({ id: issuers.id })
        .from(issuers)
        .where(eq(issuers.slug, "hang-seng")),
    () =>
      db
        .insert(issuers)
        .values({
          slug: "hang-seng",
          nameEn: "Hang Seng",
          nameZh: "恒生",
          websiteUrl: "https://www.hangseng.com",
        })
        .returning({ id: issuers.id }),
  )

  const hsMpower = await upsertById(
    () =>
      db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.slug, "hang-seng-mpower")),
    () =>
      db
        .insert(cards)
        .values({
          issuerId: hangSeng,
          slug: "hang-seng-mpower",
          productFamily: "Hang Seng MPOWER",
          cardNameEn: "Hang Seng MPOWER Card",
          cardNameZh: "恒生 MPOWER 信用卡",
          network: "Mastercard",
          cardLevel: "platinum",
          status: "active",
          officialUrl: "https://www.hangseng.com/en-hk/credit-cards/all-cards/mpower/",
          notes:
            "M3 simplification — 2-tier monthly rebate (0.4% / 5%). Real card has category overlays and a separate max-rebate cap; both added in M4/M9.",
        })
        .returning({ id: cards.id }),
  )

  const hsMpowerSource = await upsertById(
    () =>
      db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.slug, "hang-seng-mpower-official-page")),
    () =>
      db
        .insert(sourceDocuments)
        .values({
          slug: "hang-seng-mpower-official-page",
          issuerId: hangSeng,
          cardId: hsMpower,
          sourceType: "official_page",
          sourcePriority: 2,
          title: "Hang Seng MPOWER Card — official product page",
          url: "https://www.hangseng.com/en-hk/credit-cards/all-cards/mpower/",
          language: "mixed",
          status: "active",
          notes:
            "M3 placeholder source. Replace with real T&C PDF in M9.",
        })
        .returning({ id: sourceDocuments.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "hang-seng-mpower__tiered_monthly")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: hsMpower,
          slug: "hang-seng-mpower__tiered_monthly",
          ruleName: "MPOWER monthly tiered rebate",
          ruleType: "category_bonus",
          status: "approved",
          rewardFormulaType: "tiered_percent",
          rewardFormulaPayload: {
            type: "tiered_percent",
            accrualPeriod: "month",
            tiers: [
              { minAmountHkd: 0, maxAmountHkd: 4000, rate: 0.004 },
              { minAmountHkd: 4000, maxAmountHkd: null, rate: 0.05 },
            ],
          },
          rewardCurrencyId: hkdCashback,
          requiresRegistration: true,
          sourceId: hsMpowerSource,
          confidenceScore: "0.800",
          notes:
            "Tier resets every calendar month — caller passes capUsage keyed by '<ruleId>__<YYYY-MM>' to keep periods isolated.",
        })
        .returning({ id: rewardRules.id }),
  )

  return {
    citiCashBackId: citiCashBack,
    hsbcRedId: hsbcRed,
    hangSengMpowerId: hsMpower,
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
