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

// M4 seed: 4 issuers, 2 currencies, 30+ categories, 4 sources, 4 cards, 7 rules.
//   Citi Cash Back     (M1) — flat 1.2% base earn
//   HSBC Red           (M2) — 0.4% base + 4% online_local capped at HKD 100k/yr
//   Hang Seng MPOWER   (M3) — tiered_percent monthly:
//                             [0, 4000) @ 0.4%, [4000, ∞) @ 5%
//                             requires_registration=true
//   Citi PremierMiles  (M4) — points_per_hkd base (HK$8/mile) +
//                             FX bonus (HK$8/mile additional on FX, additive) +
//                             tax exclusion (applies_to bonuses, NOT base_earn)
//
// Roadmap M3 named HSBC EveryMile; real EveryMile is category-based
// (HK$4/HK$8 = 1 mile by online/overseas), not monthly tier. MPOWER is
// the closer stress fit. All cards are simplifications of real products.
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

  const asiaMiles = await upsertById(
    () =>
      db
        .select({ id: rewardCurrencies.id })
        .from(rewardCurrencies)
        .where(eq(rewardCurrencies.slug, "asia_miles")),
    () =>
      db
        .insert(rewardCurrencies)
        .values({
          slug: "asia_miles",
          nameEn: "Asia Miles",
          nameZh: "亞洲萬里通",
          type: "miles",
          baseValueHkd: "0.100000",
          valuationNote:
            "1 mile ≈ HKD 0.10 — conservative estimate; long-haul J redemptions can yield 0.15–0.25.",
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

  // ---------- Citi PremierMiles (M4 adversarial: exclusion + stacking) ----------

  const citiPmCategoryTaxId = categoryIds.get("tax_government")
  if (!citiPmCategoryTaxId) {
    throw new Error("tax_government category not seeded")
  }

  const citiPm = await upsertById(
    () =>
      db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.slug, "citi-premiermiles")),
    () =>
      db
        .insert(cards)
        .values({
          issuerId: citi,
          slug: "citi-premiermiles",
          productFamily: "Citi PremierMiles",
          cardNameEn: "Citi PremierMiles Card",
          cardNameZh: "Citi PremierMiles 信用卡",
          network: "Visa",
          cardLevel: "platinum",
          status: "active",
          officialUrl:
            "https://www.citibank.com.hk/english/credit-cards/premiermiles-card/index.htm",
          notes:
            "M4 simplification — base 1 mile / HK$8 + additive FX bonus + tax exclusion (bonuses only). Real card has cap on miles bonus and AsiaMiles redemption rules; added in M9.",
        })
        .returning({ id: cards.id }),
  )

  const citiPmSource = await upsertById(
    () =>
      db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.slug, "citi-premiermiles-official-page")),
    () =>
      db
        .insert(sourceDocuments)
        .values({
          slug: "citi-premiermiles-official-page",
          issuerId: citi,
          cardId: citiPm,
          sourceType: "official_page",
          sourcePriority: 2,
          title: "Citi PremierMiles Card — official product page",
          url: "https://www.citibank.com.hk/english/credit-cards/premiermiles-card/index.htm",
          language: "mixed",
          status: "active",
          notes:
            "M4 placeholder source. Replace with real T&C PDF in M9.",
        })
        .returning({ id: sourceDocuments.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "citi-premiermiles__base_earn")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: citiPm,
          slug: "citi-premiermiles__base_earn",
          ruleName: "Base earn (HK$8 = 1 mile)",
          ruleType: "base_earn",
          status: "approved",
          rewardFormulaType: "points_per_hkd",
          rewardFormulaPayload: {
            type: "points_per_hkd",
            points: 1,
            perHkd: 8,
            currencySlug: "asia_miles",
          },
          rewardCurrencyId: asiaMiles,
          sourceId: citiPmSource,
          confidenceScore: "0.900",
          priority: 100,
        })
        .returning({ id: rewardRules.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "citi-premiermiles__fx_bonus")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: citiPm,
          slug: "citi-premiermiles__fx_bonus",
          ruleName: "Foreign currency bonus (additive)",
          ruleType: "foreign_currency_bonus",
          status: "approved",
          rewardFormulaType: "points_per_hkd",
          rewardFormulaPayload: {
            type: "points_per_hkd",
            points: 1,
            perHkd: 8,
            currencySlug: "asia_miles",
          },
          rewardCurrencyId: asiaMiles,
          isForeignCurrency: true,
          sourceId: citiPmSource,
          confidenceScore: "0.850",
          stackingPolicy: "additive",
          priority: 90,
          notes:
            "Additive on top of base earn — FX txn earns 1/8 (base) + 1/8 (FX) = 1/4 mile per HKD effective rate.",
        })
        .returning({ id: rewardRules.id }),
  )

  await upsertById(
    () =>
      db
        .select({ id: rewardRules.id })
        .from(rewardRules)
        .where(eq(rewardRules.slug, "citi-premiermiles__tax_exclusion")),
    () =>
      db
        .insert(rewardRules)
        .values({
          cardId: citiPm,
          slug: "citi-premiermiles__tax_exclusion",
          ruleName: "Tax / government — bonus excluded",
          ruleType: "exclusion",
          status: "approved",
          rewardFormulaType: "no_reward",
          rewardFormulaPayload: {
            type: "no_reward",
            reason: "Tax / government category does not earn bonus miles.",
          },
          rewardCurrencyId: asiaMiles,
          categoryId: citiPmCategoryTaxId,
          appliesTo: [
            "category_bonus",
            "online_bonus",
            "overseas_bonus",
            "foreign_currency_bonus",
            "campaign_bonus",
            "merchant_bonus",
          ],
          sourceId: citiPmSource,
          confidenceScore: "0.850",
          priority: 50,
          notes:
            "base_earn deliberately NOT in applies_to: tax payments still earn the basic 1/8 mile per HKD — PRD §8.4 canonical case.",
        })
        .returning({ id: rewardRules.id }),
  )

  return {
    citiCashBackId: citiCashBack,
    hsbcRedId: hsbcRed,
    hangSengMpowerId: hsMpower,
    citiPmId: citiPm,
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
