// scripts/materialize-canary.ts — Stage 1A canary materializer (§3H · §8 · §12).
//
// Materializes ONLY the Amex Explorer + Blue Cash cross-check groups, with
// three hard write gates:
//   • dry-run by DEFAULT (writes nothing to reward_rules / cards)
//   • --enable-write to actually write, which REQUIRES
//   • --card-slug on the allowlist AND --max-write-count <N>
//
//   pnpm tsx --env-file=.env.local scripts/materialize-canary.ts \
//     --card-slug american-express-amex-blue-cash-credit-card [--reaggregate] \
//     [--print-diff] [--enable-write --max-write-count 20]
//
// --reaggregate re-runs the aggregator for the canary cards first (writes
// cross_check_groups only — the §3A formula-split grouping). It is an
// explicit, scoped prep step, separate from the calculator-surface write
// gate.

import {
  parseCanaryArgs,
  enforceMaxWriteCount,
  formatAuditDiff,
  type CardSnapshot,
} from "@/lib/extraction/canary"
import { aggregateClaims } from "@/lib/extraction/aggregator"
import {
  materializeApprovedGroups,
  type MaterializeOutcome,
} from "@/lib/extraction/materializer"
import { snapshotCanaryCard } from "./audit-diff"

function plannedWrites(outcomes: MaterializeOutcome[]): number {
  const rules = outcomes.filter((o) => o.kind === "created").length
  const feeUpdates = outcomes.filter(
    (o) => o.kind === "annual_fee" && o.newValueHkd != null,
  ).length
  const deactivations = outcomes.filter(
    (o) => o.kind === "skipped" && o.deactivatedRuleSlug,
  ).length
  return rules + feeUpdates + deactivations
}

function printOutcome(o: MaterializeOutcome): void {
  const idx = `[${o.groupId.slice(0, 8)}]`
  if (o.kind === "created") {
    const flag = o.isActiveForCalculator ? "" : " · INACTIVE"
    console.log(
      `${idx} + rule ${o.ruleSlug} (${o.ruleType}) · ${o.publishAuthority}${flag}${o.capStitched ? " · +cap" : ""}`,
    )
  } else if (o.kind === "annual_fee") {
    console.log(
      `${idx} $ annual_fee ${o.oldValueHkd ?? "∅"}→${o.newValueHkd ?? "∅"} (${o.authority}) · ${o.reason}`,
    )
  } else if (o.kind === "skipped") {
    console.log(`${idx} ⊘ ${o.reason}`)
  } else {
    console.log(`${idx} ✗ ${o.error}`)
  }
}

async function main() {
  const parsed = parseCanaryArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`✗ ${parsed.error}`)
    process.exit(1)
  }
  const cfg = parsed.config
  console.log("─".repeat(80))
  console.log(
    `▸ Stage 1A canary materializer — ${cfg.dryRun ? "DRY-RUN (no writes)" : "WRITE MODE"}`,
  )
  console.log(`  cards: ${cfg.cards.join(", ")}`)
  if (cfg.enableWrite) console.log(`  --max-write-count: ${cfg.maxWriteCount}`)
  console.log("─".repeat(80))

  const before: Record<string, CardSnapshot> = {}
  for (const c of cfg.cards) before[c] = await snapshotCanaryCard(c)

  if (cfg.reaggregate) {
    console.log("▸ re-aggregating canary cards (writes cross_check_groups only)…")
    const agg = await aggregateClaims({ scope: { cardSlugs: cfg.cards } })
    console.log(
      `  ${agg.claimsScanned} claims → ${agg.groupsTotal} groups ` +
        `(${agg.agreed} agreed / ${agg.singleSource} single / ${agg.conflict} conflict)`,
    )
  }

  // Always do a dry-run pass first to compute the planned write count.
  console.log("▸ materialization plan (dry-run):")
  const dry = await materializeApprovedGroups({ cardSlugs: cfg.cards }, { dryRun: true })
  dry.outcomes.forEach(printOutcome)
  const planned = plannedWrites(dry.outcomes)
  console.log(
    `  plan: ${dry.considered} groups considered · ${planned} write(s) planned ` +
      `(${dry.created} rule-creates · ${dry.skipped} skipped)`,
  )

  if (cfg.dryRun) {
    console.log("─".repeat(80))
    console.log("DRY-RUN complete. No writes performed. Re-run with")
    console.log(`  --enable-write --max-write-count ${Math.max(planned, 1)}`)
    console.log("to apply (after PM verification).")
    process.exit(0)
  }

  // Write mode: enforce the write budget BEFORE any write.
  const budgetErr = enforceMaxWriteCount(planned, cfg.maxWriteCount)
  if (budgetErr) {
    console.error(`✗ ${budgetErr}`)
    process.exit(1)
  }

  console.log("▸ WRITING (gates satisfied: allowlist + --enable-write + budget)…")
  const live = await materializeApprovedGroups({ cardSlugs: cfg.cards }, { dryRun: false })
  live.outcomes.forEach(printOutcome)
  console.log(
    `  wrote: ${live.created} rule/fee change(s) · ${live.skipped} skipped · ${live.failed} failed`,
  )

  if (cfg.printDiff) {
    console.log("─".repeat(80))
    console.log("▸ before/after audit diff:")
    for (const c of cfg.cards) {
      const after = await snapshotCanaryCard(c)
      console.log(formatAuditDiff(before[c]!, after))
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
