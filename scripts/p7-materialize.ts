// P7 — CLI to bulk-materialize approved cross_check_groups into
// reward_rules. The reviewer-driven flow (resolveReviewTask('approve'))
// auto-materializes inline; this CLI is for backfill, batch promotion,
// or recovery after a partial failure.
//
// Usage:
//   pnpm p7:materialize -- --card-slug hsbc-red          # one card
//   pnpm p7:materialize -- --group-id <uuid>             # one group
//   pnpm p7:materialize -- --card-slug hsbc-red --dry-run
//
// At least one of --card-slug or --group-id must be supplied. Default
// behavior with no scope is a no-op rather than "materialize every
// approved group across the corpus".
//
// Re-running is safe: gate is `approved_rule_id IS NULL` on the group,
// plus slug collision detection on the synthesized rule slug. Already-
// materialized groups skip with kind='skipped'.

import {
  materializeApprovedGroups,
  type MaterializeScope,
  type MaterializeOutcome,
} from "@/lib/extraction/materializer"

type Args = {
  cardSlugs: string[]
  groupIds: string[]
  dryRun: boolean
}

const USAGE = `pnpm p7:materialize -- [options]

Required (at least one):
  --card-slug <slug>      Limit to one card. Repeatable.
  --group-id <uuid>       Limit to one cross_check_group. Repeatable.

Options:
  --dry-run               Print outcomes without writing (NOT IMPLEMENTED — falls through to live run; placeholder for future).
  --help, -h              Print this help and exit.
`

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    cardSlugs: [],
    groupIds: [],
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case "--card-slug": {
        const v = argv[++i]
        if (v) args.cardSlugs.push(v)
        break
      }
      case "--group-id": {
        const v = argv[++i]
        if (v) args.groupIds.push(v)
        break
      }
      case "--dry-run":
        args.dryRun = true
        break
      case "--help":
      case "-h":
        console.log(USAGE)
        process.exit(0)
        break
      default:
        if (a === "--") break
        if (a) {
          console.error(`unknown arg: ${a}`)
          process.exit(1)
        }
    }
  }
  return args
}

function formatOutcome(o: MaterializeOutcome): string {
  const idx = `[${o.groupId.slice(0, 8)}]`
  if (o.kind === "created") {
    const cap = o.capStitched ? " · +cap" : ""
    return `${idx} ✓ created  rule='${o.ruleSlug}' (${o.ruleType}) · ${o.supportingSourceCount} src${cap}`
  }
  if (o.kind === "skipped") {
    return `${idx} ⊘ skipped  ${o.reason}`
  }
  return `${idx} ✗ failed   ${o.error}`
}

async function main() {
  const args = parseArgs()
  if (args.cardSlugs.length === 0 && args.groupIds.length === 0) {
    console.error(
      "P7 requires an explicit scope. Pass --card-slug or --group-id.\n",
    )
    console.error(USAGE)
    process.exit(1)
  }
  if (args.dryRun) {
    console.error(
      "--dry-run is not yet implemented; running live. (See P7 CLI header.)",
    )
  }

  const scope: MaterializeScope = {
    cardSlugs: args.cardSlugs.length > 0 ? args.cardSlugs : undefined,
    groupIds: args.groupIds.length > 0 ? args.groupIds : undefined,
  }

  console.log("─".repeat(80))
  console.log("▸ P7 materializer — group → reward_rule")
  if (scope.cardSlugs) console.log(`  card slugs: ${scope.cardSlugs.join(", ")}`)
  if (scope.groupIds) console.log(`  group ids:  ${scope.groupIds.join(", ")}`)
  console.log("─".repeat(80))

  const startedAt = Date.now()
  const summary = await materializeApprovedGroups(scope)
  const wallMs = Date.now() - startedAt

  for (const o of summary.outcomes) {
    console.log(formatOutcome(o))
  }

  console.log("─".repeat(80))
  console.log(
    `Summary — considered ${summary.considered} eligible groups · created ${summary.created} · skipped ${summary.skipped} · failed ${summary.failed}`,
  )
  console.log(`Wall clock: ${(wallMs / 1000).toFixed(2)}s`)

  setTimeout(() => process.exit(summary.failed > 0 ? 1 : 0), 100)
}

main().catch((err) => {
  console.error("P7 materializer failed:", err)
  process.exit(1)
})
