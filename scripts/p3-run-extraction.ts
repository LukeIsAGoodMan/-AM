// P3 — batch extraction CLI. Iterate source_chunks in a configurable scope
// (card slug / card status / max chunks), call the P2 extractor under a
// concurrency cap, dedup against extraction_runs, and report.
//
// Usage:
//   pnpm p3:run -- --card-slug hsbc-red                  # one card
//   pnpm p3:run -- --status draft --limit 5              # 5 chunks from draft pool
//   pnpm p3:run -- --card-slug hsbc-red --force          # re-extract everything
//   pnpm p3:run -- --card-slug hsbc-red --dry-run        # call API, no DB writes
//   pnpm p3:run -- --card-slug hsbc-red --concurrency 5  # bump parallelism
//
// At least one of --card-slug or --status MUST be supplied. Default
// behavior with no scope is a no-op rather than "extract everything,
// surprise!".
//
// Requires ANTHROPIC_API_KEY in .env.local.

import { runExtraction, type ChunkEvent, type RunScope } from "@/lib/extraction/runner"

type Args = {
  cardSlugs: string[]
  statuses: ("active" | "draft" | "archived")[]
  maxChunks: number | undefined
  concurrency: number
  force: boolean
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    cardSlugs: [],
    statuses: [],
    maxChunks: undefined,
    concurrency: 3,
    force: false,
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
      case "--limit": {
        const v = argv[++i]
        const n = Number(v)
        if (!Number.isFinite(n) || n < 1) {
          console.error(`--limit: expected positive integer, got '${v}'`)
          process.exit(1)
        }
        args.maxChunks = n
        break
      }
      case "--concurrency": {
        const v = argv[++i]
        const n = Number(v)
        if (!Number.isFinite(n) || n < 1) {
          console.error(`--concurrency: expected positive integer, got '${v}'`)
          process.exit(1)
        }
        args.concurrency = n
        break
      }
      case "--force":
        args.force = true
        break
      case "--dry-run":
        args.dryRun = true
        break
      case "--help":
      case "-h":
        console.log(USAGE)
        process.exit(0)
        break
      default:
        // Skip pnpm's `--` separator.
        if (a === "--") break
        if (a) {
          console.error(`unknown arg: ${a}`)
          process.exit(1)
        }
    }
  }
  return args
}

const USAGE = `pnpm p3:run -- [options]

Required (at least one):
  --card-slug <slug>   Limit to one card. Repeatable for multiple cards.
  --status <status>    One of active|draft|archived. Repeatable.

Options:
  --limit <N>          Cap on total chunks processed (default: no cap).
  --concurrency <N>    Parallel API calls (default: 3).
  --force              Re-extract even if a succeeded extraction_run exists.
  --dry-run            Call API and report, but skip all DB writes.
  --help, -h           Print this help and exit.
`

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY missing. Add it to .env.local.")
    process.exit(1)
  }

  const args = parseArgs()
  if (args.cardSlugs.length === 0 && args.statuses.length === 0) {
    console.error(
      "P3 requires an explicit scope. Pass --card-slug or --status (or both).\n",
    )
    console.error(USAGE)
    process.exit(1)
  }

  const scope: RunScope = {
    cardSlugs: args.cardSlugs.length > 0 ? args.cardSlugs : undefined,
    cardStatuses: args.statuses.length > 0 ? args.statuses : undefined,
    maxChunks: args.maxChunks,
  }

  console.log("─".repeat(80))
  console.log(
    `▸ P3 extraction runner — concurrency=${args.concurrency}${args.dryRun ? " (DRY-RUN)" : ""}${args.force ? " (FORCE)" : ""}`,
  )
  if (scope.cardSlugs)
    console.log(`  card slugs:     ${scope.cardSlugs.join(", ")}`)
  if (scope.cardStatuses)
    console.log(`  card statuses:  ${scope.cardStatuses.join(", ")}`)
  if (scope.maxChunks !== undefined)
    console.log(`  max chunks:     ${scope.maxChunks}`)
  console.log("─".repeat(80))

  const startedAt = Date.now()
  let nthEvent = 0
  const summary = await runExtraction(
    {
      scope,
      concurrency: args.concurrency,
      force: args.force,
      dryRun: args.dryRun,
      onChunkComplete: (ev: ChunkEvent) => {
        nthEvent += 1
        const idx = `[${nthEvent}]`.padStart(5)
        const label = `${ev.cardSlug} · ${ev.sourceSlug} · #${ev.chunkIndex}`
        if (ev.kind === "ok") {
          console.log(
            `${idx} ✓ ${label} — ${ev.claimsEmitted} claims · $${(ev.costUsdCents / 100).toFixed(4)} · ${ev.latencyMs}ms · cache_read=${ev.cacheReadInputTokens}`,
          )
        } else if (ev.kind === "skipped") {
          console.log(`${idx} ⊘ ${label} — ${ev.reason}`)
        } else {
          console.log(`${idx} ✗ ${label} — ${ev.reason}`)
        }
      },
    },
  )

  const wallMs = Date.now() - startedAt

  console.log("─".repeat(80))
  console.log(
    `Summary — scope=${summary.scopeSize} chunks · processed=${summary.processed} · skipped=${summary.skipped} · failed=${summary.failed}`,
  )
  console.log(
    `Total: ${summary.claimsEmitted} claims · $${(summary.totalCostUsdCents / 100).toFixed(4)} · ${(summary.totalLatencyMs / 1000).toFixed(1)}s API time · ${(wallMs / 1000).toFixed(1)}s wall clock`,
  )
  if (Object.keys(summary.perCard).length > 1) {
    console.log("")
    console.log("Per card:")
    for (const [slug, s] of Object.entries(summary.perCard)) {
      if (s.processed === 0 && s.skipped === 0 && s.failed === 0) continue
      console.log(
        `  ${slug.padEnd(40)}  ${s.processed} processed · ${s.skipped} skipped · ${s.failed} failed · ${s.claimsEmitted} claims · $${(s.costUsdCents / 100).toFixed(4)}`,
      )
    }
  }
  console.log("")
  if (summary.failed > 0) {
    console.log(
      "Failed chunks are recorded with status=failed in extraction_runs; re-run to retry (skip-on-success dedup leaves them alone).",
    )
  }

  setTimeout(() => process.exit(summary.failed > 0 ? 1 : 0), 100)
}

main().catch((err) => {
  console.error("P3 runner failed:", err)
  process.exit(1)
})
