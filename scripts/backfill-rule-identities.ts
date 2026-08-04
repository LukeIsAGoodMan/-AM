// scripts/backfill-rule-identities.ts — Stage 1B core (P18 · D30).
//
// Deterministic legacy backfill of rule_identities: gives every existing
// reward_rules row exactly one persistent identity (spec §6C). Pure planning
// lives in src/lib/extraction/rule-identity.ts and is unit-tested; this script
// only reads reward_rules, diffs against existing identities, and inserts.
//
// This is NOT calculator materialization. It writes ONLY the additive
// rule_identities table — it never touches reward_rules, cards, or any
// calculator-active state — so full-rule-set coverage is the intended scope
// (the whole point is that no rule is left without an identity). The write
// gates below are a safety valve, not an allowlist.
//
//   Dry-run (default — reads + prints a plan, writes nothing):
//     pnpm tsx --env-file=.env.local scripts/backfill-rule-identities.ts
//
//   Write (all THREE required): --enable-write AND --max-write-count N, and the
//   plan's insert count must be <= N:
//     pnpm tsx --env-file=.env.local scripts/backfill-rule-identities.ts \
//       --enable-write --max-write-count 250
//
// Idempotent: re-running after a full backfill inserts nothing.

import { isNotNull } from "drizzle-orm"
import { db } from "@/db/client"
import { rewardRules } from "@/db/schema/catalog"
import { ruleIdentities } from "@/db/schema/extraction"
import {
  planLegacyBackfill,
  type BackfillableRule,
} from "@/lib/extraction/rule-identity"

interface Args {
  dryRun: boolean
  enableWrite: boolean
  maxWriteCount: number | null
}

function parseArgs(argv: string[]): { ok: true; args: Args } | { ok: false; error: string } {
  let enableWrite = false
  let maxWriteCount: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--enable-write") {
      enableWrite = true
    } else if (a === "--dry-run") {
      // Explicit dry-run is the default; accepted for clarity, never writes.
      enableWrite = false
    } else if (a === "--max-write-count") {
      const raw = argv[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) {
        return { ok: false, error: `--max-write-count needs a non-negative integer, got ${raw}` }
      }
      maxWriteCount = n
    } else {
      return { ok: false, error: `unknown argument: ${a}` }
    }
  }

  return { ok: true, args: { dryRun: !enableWrite, enableWrite, maxWriteCount } }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`✗ ${parsed.error}`)
    process.exit(1)
  }
  const { dryRun, enableWrite, maxWriteCount } = parsed.args

  console.log("─".repeat(80))
  console.log(
    `▸ Stage 1B rule-identity backfill — ${dryRun ? "DRY-RUN (no writes)" : "WRITE MODE"}`,
  )

  // Read the minimal stable-scope columns from every reward_rule.
  const ruleRows = await db
    .select({
      id: rewardRules.id,
      slug: rewardRules.slug,
      cardId: rewardRules.cardId,
      ruleType: rewardRules.ruleType,
      rewardFormulaType: rewardRules.rewardFormulaType,
      rewardCurrencyId: rewardRules.rewardCurrencyId,
      campaignId: rewardRules.campaignId,
      requiresRegistration: rewardRules.requiresRegistration,
      requiresActivation: rewardRules.requiresActivation,
      requiresSelectedCategory: rewardRules.requiresSelectedCategory,
    })
    .from(rewardRules)

  const rules: BackfillableRule[] = ruleRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    cardId: r.cardId,
    ruleType: r.ruleType,
    rewardFormulaType: r.rewardFormulaType,
    rewardCurrencyId: r.rewardCurrencyId,
    campaignId: r.campaignId,
    requiresRegistration: r.requiresRegistration,
    requiresActivation: r.requiresActivation,
    requiresSelectedCategory: r.requiresSelectedCategory,
  }))

  // Existing identities keyed by origin rule id (idempotency source of truth).
  const existingRows = await db
    .select({ originRuleId: ruleIdentities.originRuleId })
    .from(ruleIdentities)
    .where(isNotNull(ruleIdentities.originRuleId))
  const existing = new Set(existingRows.map((r) => r.originRuleId as string))

  const plan = planLegacyBackfill(rules, existing)

  console.log(`  reward_rules scanned ........ ${rules.length}`)
  console.log(`  already have an identity .... ${plan.skippedExistingRuleIds.length}`)
  console.log(`  identities to create ........ ${plan.inserts.length}`)
  console.log(`  scope-key collisions ........ ${plan.collisions.length} (never auto-merged · §6C)`)
  for (const c of plan.collisions.slice(0, 10)) {
    console.log(`    ⚠ ${c.ruleIds.length} rules share ${c.stableScopeKey}`)
    console.log(`       → reviewer reconciliation later: ${c.ruleIds.join(", ")}`)
  }
  if (plan.collisions.length > 10) {
    console.log(`    … and ${plan.collisions.length - 10} more collision groups`)
  }

  if (plan.inserts.length === 0) {
    console.log("✓ Nothing to backfill — every rule already has an identity.")
    process.exit(0)
  }

  if (dryRun) {
    console.log("─".repeat(80))
    console.log("DRY-RUN — no rows written. Re-run with --enable-write --max-write-count N to apply.")
    process.exit(0)
  }

  // Write gates (§12 spirit: a deliberate, bounded write).
  if (maxWriteCount === null) {
    console.error("✗ WRITE MODE requires --max-write-count N.")
    process.exit(1)
  }
  if (plan.inserts.length > maxWriteCount) {
    console.error(
      `✗ plan writes ${plan.inserts.length} identities but --max-write-count is ${maxWriteCount}. Aborting (raise the limit deliberately).`,
    )
    process.exit(1)
  }

  await db.insert(ruleIdentities).values(plan.inserts)
  console.log("─".repeat(80))
  console.log(`✓ Inserted ${plan.inserts.length} rule identities (status=legacy_unreconciled).`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
