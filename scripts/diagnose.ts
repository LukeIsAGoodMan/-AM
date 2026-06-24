// End-to-end diagnostic: load every approved rule from the live DB, map to
// ResolvedRule, and run the pure calculator across canonical scenarios.
// Prints top-5 rankings per scenario so a human can eyeball whether the
// system holds together after a schema/data change.
//
// Use: pnpm diagnose

import { loadResolvedRulesForAllActiveCards } from "@/lib/queries/resolved-rules"
import { calculate } from "@/lib/calculator/calculate"
import { HardcodedMerchantResolver } from "@/lib/resolver/hardcoded"
import type { TransactionContext } from "@/lib/schemas/transaction"
import type { UserCardContext } from "@/lib/calculator/calculate"

const TXN_DATE = "2026-06-24"

type Scenario = {
  name: string
  description: string
  txn: TransactionContext
  userContexts?: Record<string, UserCardContext>
  // Card slugs we expect to appear in the top-5; if any are missing
  // we mark the scenario as a regression.
  expectInTop5: string[]
}

async function main() {
  const cards = await loadResolvedRulesForAllActiveCards()
  console.log(`Loaded ${cards.length} active cards from DB.\n`)

  const resolver = new HardcodedMerchantResolver()

  const scenarios: Scenario[] = [
    {
      name: "Klook HKD 5000 (online, local)",
      description:
        "Caller passes merchantName only; resolver finds travel_ota. " +
        "Expect Citi PremierMiles / SC Cathay / HSBC EveryMile in top-5.",
      txn: await resolveTxn(resolver, {
        amountHkd: 5000,
        merchantName: "Klook",
        isOnline: true,
        countryRegion: "HK",
        isForeignCurrency: false,
        transactionDate: TXN_DATE,
      }),
      expectInTop5: [
        "citi-premiermiles",
        "standard-chartered-cathay-mastercard",
      ],
    },
    {
      name: "General overseas FX HKD 5000",
      description: "User's original concern — EveryMile must show in top-5.",
      txn: {
        amountHkd: 5000,
        categorySlug: "general_overseas",
        countryRegion: "OVERSEAS",
        isOnline: false,
        isForeignCurrency: true,
        transactionDate: TXN_DATE,
      },
      expectInTop5: [
        "hsbc-everymile-credit-card",
        "citi-premiermiles",
        "standard-chartered-cathay-mastercard",
      ],
    },
    {
      name: "HSBC Red online HKD 3000, NO Q3 campaign registered",
      description:
        "Standard online bonus only — campaign rule must be gated out.",
      txn: {
        amountHkd: 3000,
        categorySlug: "online_local",
        isOnline: true,
        isForeignCurrency: false,
        countryRegion: "HK",
        transactionDate: TXN_DATE,
      },
      expectInTop5: ["hsbc-red"],
    },
    {
      name: "HSBC Red online HKD 3000, Q3 campaign REGISTERED",
      description: "Campaign 2% stacks on top — HSBC Red gets +60 HKD.",
      txn: {
        amountHkd: 3000,
        categorySlug: "online_local",
        isOnline: true,
        isForeignCurrency: false,
        countryRegion: "HK",
        transactionDate: TXN_DATE,
      },
      userContexts: {
        "hsbc-red": {
          cardId: "hsbc-red",
          activatedCampaignIds: await campaignIdsForSlug([
            "hsbc-red-2026-q3-online-extra",
          ]),
        },
      },
      expectInTop5: ["hsbc-red"],
    },
    {
      name: "Tax HKD 10000 (PRD §8.4 canonical case)",
      description:
        "Bonus rules excluded; base earns only. PremierMiles / EveryMile " +
        "should still earn at HK$8 = 1 mile base.",
      txn: {
        amountHkd: 10000,
        categorySlug: "tax_government",
        isOnline: true,
        isForeignCurrency: false,
        countryRegion: "HK",
        transactionDate: TXN_DATE,
      },
      // Multiple cards earn here — we expect at least one of the cards
      // whose base earn isn't excluded.
      expectInTop5: ["citi-premiermiles", "hsbc-everymile-credit-card"],
    },
    {
      name: "Hang Seng enJoy dining HKD 2000, dining selected",
      description:
        "Selected-category gate ON — enJoy's dining 4% bonus applies " +
        "(plus base) for 84 HKD. Without selection it would be 8 HKD base only.",
      txn: {
        amountHkd: 2000,
        categorySlug: "dining_local",
        isOnline: false,
        countryRegion: "HK",
        transactionDate: TXN_DATE,
      },
      userContexts: {
        "hang-seng-enjoy-card": {
          cardId: "hang-seng-enjoy-card",
          selectedCategorySlugs: ["dining_local", "online_local", "supermarket"],
        },
      },
      expectInTop5: ["hang-seng-enjoy-card"],
    },
    {
      name: "Hang Seng enJoy dining HKD 2000, dining NOT selected",
      description:
        "Selected-category rule gated OUT — only base earns 8 HKD on enJoy. " +
        "Other cards with unconditional bonuses should beat it.",
      txn: {
        amountHkd: 2000,
        categorySlug: "dining_local",
        isOnline: false,
        countryRegion: "HK",
        transactionDate: TXN_DATE,
      },
      userContexts: {
        "hang-seng-enjoy-card": {
          cardId: "hang-seng-enjoy-card",
          selectedCategorySlugs: ["supermarket", "streaming_subscription"],
        },
      },
      expectInTop5: [],
    },
  ]

  let regressions = 0
  for (const sc of scenarios) {
    console.log("─".repeat(80))
    console.log(`▸ ${sc.name}`)
    console.log(`  ${sc.description}`)
    if (
      sc.txn.merchantName &&
      sc.txn.categorySlug &&
      sc.txn.categoryResolutionConfidence !== undefined
    ) {
      console.log(
        `  resolver: ${sc.txn.merchantName} → ${sc.txn.categorySlug} (conf ${sc.txn.categoryResolutionConfidence})`,
      )
    }
    const ranked = []
    for (const c of cards) {
      const ctx = sc.userContexts?.[c.cardSlug]
      const res = calculate(c.cardSlug, c.rules, sc.txn, ctx)
      ranked.push({
        slug: c.cardSlug,
        name: c.cardNameEn,
        reward: res.rewardValueHkd,
        confidence: res.confidence,
        ruleCount: res.breakdown.length,
        topRule: res.breakdown[0]?.ruleName ?? "(no match)",
      })
    }
    ranked.sort((a, b) => b.reward - a.reward)
    const top5 = ranked.slice(0, 5)

    console.log("")
    for (let i = 0; i < top5.length; i++) {
      const r = top5[i]
      if (!r) continue
      console.log(
        `  ${(i + 1).toString().padStart(2)}. ${r.reward.toFixed(2).padStart(7)} HKD  [${r.confidence.padEnd(6)}]  ${r.name}`,
      )
      console.log(`        ${r.ruleCount} rules · ${r.topRule}`)
    }

    if (sc.expectInTop5.length > 0) {
      const top5Slugs = new Set(top5.map((r) => r.slug))
      const missing = sc.expectInTop5.filter((s) => !top5Slugs.has(s))
      if (missing.length > 0) {
        console.log(
          `\n  ⚠ REGRESSION: missing from top-5: ${missing.join(", ")}`,
        )
        regressions++
      }
    }
    console.log("")
  }

  console.log("─".repeat(80))
  if (regressions === 0) {
    console.log("✓ All expectations met.")
  } else {
    console.log(`✗ ${regressions} regression(s) detected.`)
    process.exit(1)
  }
}

async function resolveTxn(
  resolver: HardcodedMerchantResolver,
  txn: TransactionContext,
): Promise<TransactionContext> {
  if (!txn.merchantName || txn.categorySlug) return txn
  const res = await resolver.resolve(txn.merchantName)
  return {
    ...txn,
    categorySlug: res.categorySlug,
    categoryResolutionConfidence: res.confidence,
  }
}

async function campaignIdsForSlug(slugs: string[]): Promise<string[]> {
  const { db } = await import("@/db/client")
  const { campaigns } = await import("@/db/schema/catalog")
  const { inArray } = await import("drizzle-orm")
  if (slugs.length === 0) return []
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(inArray(campaigns.slug, slugs))
  return rows.map((r) => r.id)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    setTimeout(() => process.exit(0), 100)
  })
