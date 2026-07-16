// Stage 1A canary orchestration primitives (§3H · §8 · §12).
//
// Pure, testable logic for the materialize-canary + audit-diff CLIs:
//   - the hard card allowlist (only Amex Explorer + Blue Cash)
//   - dry-run-by-default arg parsing
//   - the write gates: --enable-write + allowlist + --max-write-count
//   - before/after snapshot diff formatting
//
// Blocking rule (§12): a Stage 1A materialization command must NEVER be able
// to touch the full DB or write without all three gates satisfied.

export const CANARY_ALLOWLIST: readonly string[] = [
  "american-express-explorer-credit-card",
  "american-express-amex-blue-cash-credit-card",
]

export interface CanaryConfig {
  cards: string[]
  dryRun: boolean
  enableWrite: boolean
  maxWriteCount: number | null
  printDiff: boolean
  reaggregate: boolean
}

export type ParseResult =
  | { ok: true; config: CanaryConfig }
  | { ok: false; error: string }

export function parseCanaryArgs(argv: readonly string[]): ParseResult {
  const cards: string[] = []
  let enableWrite = false
  let printDiff = false
  let reaggregate = false
  let maxWriteCount: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case "--card-slug": {
        const v = argv[++i]
        if (!v) return { ok: false, error: "--card-slug requires a value" }
        cards.push(v)
        break
      }
      case "--enable-write":
        enableWrite = true
        break
      case "--max-write-count": {
        const v = argv[++i]
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0) {
          return { ok: false, error: "--max-write-count requires a non-negative integer" }
        }
        maxWriteCount = n
        break
      }
      case "--print-diff":
        printDiff = true
        break
      case "--reaggregate":
        reaggregate = true
        break
      case "--dry-run":
        // Explicit dry-run; already the default. No-op flag for clarity.
        break
      case "--":
        break
      default:
        if (a && a.startsWith("--")) {
          return { ok: false, error: `unknown flag: ${a}` }
        }
    }
  }

  const config: CanaryConfig = {
    cards,
    dryRun: !enableWrite,
    enableWrite,
    maxWriteCount,
    printDiff,
    reaggregate,
  }
  const err = validateCanaryConfig(config)
  if (err) return { ok: false, error: err }
  return { ok: true, config }
}

// Returns an error string, or null if the config is safe to run.
export function validateCanaryConfig(config: CanaryConfig): string | null {
  // No full-DB sweeps: an explicit card scope is mandatory (§12).
  if (config.cards.length === 0) {
    return "no --card-slug given; Stage 1A refuses to run without an explicit card allowlist"
  }
  // Every card must be on the Stage 1A allowlist.
  const offAllowlist = config.cards.filter((c) => !CANARY_ALLOWLIST.includes(c))
  if (offAllowlist.length > 0) {
    return (
      `card(s) not on the Stage 1A allowlist: ${offAllowlist.join(", ")}. ` +
      `Allowed: ${CANARY_ALLOWLIST.join(", ")}`
    )
  }
  // Writing requires an explicit write budget (§3H).
  if (config.enableWrite && config.maxWriteCount == null) {
    return "--enable-write requires --max-write-count to bound the blast radius"
  }
  return null
}

// Returns an error string when the planned write count would exceed the cap,
// or null when it's within budget (or no cap in a dry run).
export function enforceMaxWriteCount(
  plannedWriteCount: number,
  max: number | null,
): string | null {
  if (max == null) return null
  if (plannedWriteCount > max) {
    return (
      `planned ${plannedWriteCount} write(s) exceeds --max-write-count ${max}; ` +
      `aborting before any write`
    )
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Before/after snapshot diff (§11 #4/#5, test #15).

export interface SnapshotRule {
  slug: string
  ruleType: string
  formulaType: string
  currencySlug: string
  publishAuthority: string
  isActiveForCalculator: boolean
}

export interface CardSnapshot {
  cardSlug: string
  annualFeeHkd: number | null
  annualFeeAuthority: string
  rules: SnapshotRule[]
}

export function formatAuditDiff(before: CardSnapshot, after: CardSnapshot): string {
  const lines: string[] = []
  lines.push(`■ ${after.cardSlug}`)

  // Annual fee.
  if (
    before.annualFeeHkd !== after.annualFeeHkd ||
    before.annualFeeAuthority !== after.annualFeeAuthority
  ) {
    lines.push(
      `  annual_fee: ${before.annualFeeHkd ?? "∅"} (${before.annualFeeAuthority}) ` +
        `→ ${after.annualFeeHkd ?? "∅"} (${after.annualFeeAuthority})`,
    )
  } else {
    lines.push(`  annual_fee: unchanged (${after.annualFeeHkd ?? "∅"}, ${after.annualFeeAuthority})`)
  }

  // Rules by slug.
  const beforeBySlug = new Map(before.rules.map((r) => [r.slug, r]))
  const afterBySlug = new Map(after.rules.map((r) => [r.slug, r]))
  for (const [slug, r] of afterBySlug) {
    if (!beforeBySlug.has(slug)) {
      lines.push(
        `  + rule ${slug} [${r.ruleType} · ${r.formulaType} · ${r.currencySlug}] ` +
          `${r.publishAuthority}${r.isActiveForCalculator ? "" : " · INACTIVE"}`,
      )
    }
  }
  for (const [slug] of beforeBySlug) {
    if (!afterBySlug.has(slug)) lines.push(`  - rule ${slug} (removed)`)
  }
  const activeBefore = before.rules.filter((r) => r.isActiveForCalculator).length
  const activeAfter = after.rules.filter((r) => r.isActiveForCalculator).length
  lines.push(
    `  rules: ${before.rules.length}→${after.rules.length} ` +
      `(active-for-calc ${activeBefore}→${activeAfter})`,
  )
  return lines.join("\n")
}
