// P4 — cross-check aggregator CLI. Reads pending source_claims for the
// requested scope, computes verdicts, upserts cross_check_groups, and
// auto-creates review_tasks.
//
// Usage:
//   pnpm p4:aggregate -- --card-slug hsbc-red           # one card
//   pnpm p4:aggregate -- --status draft                 # all draft-status cards
//   pnpm p4:aggregate -- --card-slug hsbc-red --dry-run # compute, write nothing
//   pnpm p4:aggregate -- --card-slug hsbc-red --claim-type earn_rate
//
// At least one of --card-slug or --status must be supplied. Default
// behavior with no scope is a no-op rather than "aggregate everything,
// surprise!" — matches P3's safety convention (D14).
//
// Re-running is safe: groups upsert via (card_id, claim_type, key_dimension)
// UNIQUE (D12), and review_tasks are created only when no open task
// exists for the group.

import {
  aggregateClaims,
  type AggregateScope,
  type GroupEvent,
} from "@/lib/extraction/aggregator"

type Args = {
  cardSlugs: string[]
  statuses: ("active" | "draft" | "archived")[]
  claimTypes: string[]
  dryRun: boolean
}

const USAGE = `pnpm p4:aggregate -- [options]

Required (at least one):
  --card-slug <slug>      Limit to one card. Repeatable.
  --status <status>       One of active|draft|archived. Repeatable.

Options:
  --claim-type <type>     Limit to one claim_type (debug). Repeatable.
  --dry-run               Compute verdicts, write nothing.
  --help, -h              Print this help and exit.
`

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    cardSlugs: [],
    statuses: [],
    claimTypes: [],
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
      case "--status": {
        const v = argv[++i]
        if (v === "active" || v === "draft" || v === "archived") {
          args.statuses.push(v)
        } else {
          console.error(`--status: expected active|draft|archived, got '${v}'`)
          process.exit(1)
        }
        break
      }
      case "--claim-type": {
        const v = argv[++i]
        if (v) args.claimTypes.push(v)
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

function statusIcon(s: GroupEvent["status"]): string {
  if (s === "agreed") return "✓"
  if (s === "conflict") return "⚠"
  return "·" // single_source
}

async function main() {
  const args = parseArgs()
  if (args.cardSlugs.length === 0 && args.statuses.length === 0) {
    console.error(
      "P4 requires an explicit scope. Pass --card-slug or --status (or both).\n",
    )
    console.error(USAGE)
    process.exit(1)
  }

  const scope: AggregateScope = {
    cardSlugs: args.cardSlugs.length > 0 ? args.cardSlugs : undefined,
    cardStatuses: args.statuses.length > 0 ? args.statuses : undefined,
    claimTypes: args.claimTypes.length > 0 ? args.claimTypes : undefined,
  }

  console.log("─".repeat(80))
  console.log(
    `▸ P4 cross-check aggregator${args.dryRun ? " (DRY-RUN)" : ""}`,
  )
  if (scope.cardSlugs) console.log(`  card slugs:    ${scope.cardSlugs.join(", ")}`)
  if (scope.cardStatuses) console.log(`  card statuses: ${scope.cardStatuses.join(", ")}`)
  if (scope.claimTypes) console.log(`  claim types:   ${scope.claimTypes.join(", ")}`)
  console.log("─".repeat(80))

  const startedAt = Date.now()
  let nthEvent = 0
  const summary = await aggregateClaims({
    scope,
    dryRun: args.dryRun,
    onGroupComplete: (e: GroupEvent) => {
      nthEvent += 1
      const idx = `[${nthEvent}]`.padStart(5)
      const icon = statusIcon(e.status)
      const newTag = e.wasInserted ? "NEW" : "upd"
      const taskTag = e.taskCreated ? " +task" : ""
      const conflictTag =
        e.contradictingCount > 0 ? ` (${e.contradictingCount} contradict)` : ""
      console.log(
        `${idx} ${icon} [${newTag}] ${e.cardSlug} · ${e.claimType} · ${e.keyDimension} — ${e.status} · ${e.supportingCount} support${conflictTag} · conf=${e.aggregateConfidence.toFixed(3)}${taskTag}`,
      )
    },
  })

  const wallMs = Date.now() - startedAt

  console.log("─".repeat(80))
  console.log(
    `Summary — scanned ${summary.claimsScanned} claims · ${summary.groupsTotal} groups (${summary.groupsInserted} new, ${summary.groupsUpdated} upd) · ${summary.reviewTasksCreated} review tasks created`,
  )
  console.log(
    `Verdicts: ${summary.agreed} agreed · ${summary.singleSource} single_source · ${summary.conflict} conflict`,
  )
  console.log(`Wall clock: ${(wallMs / 1000).toFixed(2)}s`)

  if (Object.keys(summary.perCard).length > 1) {
    console.log("")
    console.log("Per card:")
    for (const [slug, s] of Object.entries(summary.perCard)) {
      console.log(
        `  ${slug.padEnd(40)}  ${s.groupsTotal} groups · ${s.agreed} agreed · ${s.singleSource} single · ${s.conflict} conflict`,
      )
    }
  }

  setTimeout(() => process.exit(0), 100)
}

main().catch((err) => {
  console.error("P4 aggregator failed:", err)
  process.exit(1)
})
