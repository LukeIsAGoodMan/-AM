// scripts/audit-diff.ts — before/after snapshot of a canary card's calculator
// surface (annual fee + rules with their P18 publication state). Used by the
// canary CLI for --print-diff and runnable standalone for the §11 audit.
//
//   pnpm tsx --env-file=.env.local scripts/audit-diff.ts --card-slug <slug>

import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, rewardCurrencies, rewardRules } from "@/db/schema/catalog"
import { normalizeNumeric } from "@/lib/normalize"
import type { CardSnapshot, SnapshotRule } from "@/lib/extraction/canary"

export async function snapshotCanaryCard(cardSlug: string): Promise<CardSnapshot> {
  const card = (
    await db
      .select({
        id: cards.id,
        annualFeeHkd: cards.annualFeeHkd,
        annualFeeAuthority: cards.annualFeePublishAuthority,
      })
      .from(cards)
      .where(eq(cards.slug, cardSlug))
      .limit(1)
  )[0]
  if (!card) {
    return { cardSlug, annualFeeHkd: null, annualFeeAuthority: "(missing card)", rules: [] }
  }

  const rows = await db
    .select({
      slug: rewardRules.slug,
      ruleType: rewardRules.ruleType,
      formulaType: rewardRules.rewardFormulaType,
      currencySlug: rewardCurrencies.slug,
      publishAuthority: rewardRules.publishAuthority,
      isActiveForCalculator: rewardRules.isActiveForCalculator,
    })
    .from(rewardRules)
    .leftJoin(rewardCurrencies, eq(rewardRules.rewardCurrencyId, rewardCurrencies.id))
    .where(eq(rewardRules.cardId, card.id))

  const rules: SnapshotRule[] = rows
    .map((r) => ({
      slug: r.slug,
      ruleType: r.ruleType,
      formulaType: r.formulaType,
      currencySlug: r.currencySlug ?? "hkd_cashback",
      publishAuthority: r.publishAuthority,
      isActiveForCalculator: r.isActiveForCalculator,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug))

  return {
    cardSlug,
    annualFeeHkd: normalizeNumeric(card.annualFeeHkd),
    annualFeeAuthority: card.annualFeeAuthority,
    rules,
  }
}

async function main() {
  const slugs = process.argv
    .slice(2)
    .map((a, i, arr) => (arr[i - 1] === "--card-slug" ? a : null))
    .filter((v): v is string => !!v)
  if (slugs.length === 0) {
    console.error("usage: audit-diff.ts --card-slug <slug> [--card-slug <slug>]")
    process.exit(1)
  }
  for (const slug of slugs) {
    const snap = await snapshotCanaryCard(slug)
    console.log(JSON.stringify(snap, null, 2))
  }
  process.exit(0)
}

if (process.argv[1]?.endsWith("audit-diff.ts")) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
