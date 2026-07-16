// Earn-rate gate wiring (§3C + §3D) for the materializer.
//
// The pure gates live in inferred-category-gate.ts / alt-mode-gate.ts. This
// module gathers the DB context they need (source snippets, distinct source
// count, official-source presence, the card's PRIMARY base reward mode) and
// returns the materializer's action: materialize normally, hold as an
// inactive candidate, or block (don't materialize, review only).

import { and, eq, inArray, like } from "drizzle-orm"
import { db } from "@/db/client"
import { rewardCurrencies, rewardRules } from "@/db/schema/catalog"
import { crossCheckGroups, sourceClaims } from "@/db/schema/extraction"
import { normalizeNumeric } from "@/lib/normalize"
import { evaluateInferredCategory } from "@/lib/extraction/inferred-category-gate"
import { evaluateAltMode, type AltModeKind } from "@/lib/extraction/alt-mode-gate"

// Official / issuer source priorities (PRD §6.6): 1 official T&C PDF,
// 2 official page, 4 official PDF T&C.
const OFFICIAL_PRIORITIES: ReadonlySet<number> = new Set([1, 2, 4])

export type EarnGateDecision =
  | { action: "materialize" }
  | { action: "candidate"; kind: AltModeKind; reason: string }
  | { action: "block"; reason: string; matched: string[] }

interface BaseMode {
  formulaType: string
  currencySlug: string | null
  rate: number | null
}

// The card's PRIMARY base reward mode — the base_earn rule the calculator
// actually earns on. Prefer an approved active base rule; fall back to the
// most-supported base_earn cross-check group's canonical payload (e.g. when
// the base was YAML-deduped and no xchk rule exists).
async function loadCardBaseMode(cardId: string): Promise<BaseMode | null> {
  const rule = (
    await db
      .select({
        rewardFormulaType: rewardRules.rewardFormulaType,
        rewardFormulaPayload: rewardRules.rewardFormulaPayload,
        currencySlug: rewardCurrencies.slug,
      })
      .from(rewardRules)
      .leftJoin(
        rewardCurrencies,
        eq(rewardRules.rewardCurrencyId, rewardCurrencies.id),
      )
      .where(
        and(
          eq(rewardRules.cardId, cardId),
          eq(rewardRules.ruleType, "base_earn"),
          eq(rewardRules.status, "approved"),
          eq(rewardRules.isActiveForCalculator, true),
        ),
      )
      .limit(1)
  )[0]
  if (rule) {
    const p = (rule.rewardFormulaPayload ?? {}) as Record<string, unknown>
    return {
      formulaType: rule.rewardFormulaType,
      currencySlug: rule.currencySlug,
      rate: normalizeNumeric(p["rate"]),
    }
  }

  // Fallback: the most-supported base_earn group's canonical.
  const groups = await db
    .select()
    .from(crossCheckGroups)
    .where(
      and(
        eq(crossCheckGroups.cardId, cardId),
        eq(crossCheckGroups.claimType, "earn_rate"),
        like(crossCheckGroups.keyDimension, "rule_type=base_earn%"),
        inArray(crossCheckGroups.status, ["agreed", "single_source"]),
      ),
    )
  if (groups.length === 0) return null
  // Most supporting claims = primary (official-backed base outweighs a lone
  // third-party alt-mode base like Blue Cash's HK$6=1 mile).
  const primary = [...groups].sort(
    (a, b) => b.supportingClaimIds.length - a.supportingClaimIds.length,
  )[0]!
  const p = (primary.canonicalPayload ?? {}) as Record<string, unknown>
  const formulaType =
    typeof p["rewardFormulaType"] === "string"
      ? (p["rewardFormulaType"] as string)
      : "simple_percent"
  return {
    formulaType,
    currencySlug:
      typeof p["currencySlug"] === "string" ? (p["currencySlug"] as string) : null,
    rate: normalizeNumeric(p["rate"]),
  }
}

async function loadSnippets(claimIds: readonly string[]): Promise<string[]> {
  if (claimIds.length === 0) return []
  const rows = await db
    .select({ snippet: sourceClaims.extractedTextSnippet })
    .from(sourceClaims)
    .where(inArray(sourceClaims.id, [...claimIds]))
  return rows.map((r) => r.snippet)
}

export async function decideEarnRateGate(args: {
  cardId: string
  payload: Record<string, unknown>
  rewardFormulaType: string
  supports: readonly { claimId: string; sourceId: string; sourcePriority: number }[]
}): Promise<EarnGateDecision> {
  const { cardId, payload, rewardFormulaType, supports } = args
  const categorySlug =
    typeof payload["categorySlug"] === "string"
      ? (payload["categorySlug"] as string)
      : null
  const currencySlug =
    typeof payload["currencySlug"] === "string"
      ? (payload["currencySlug"] as string)
      : null
  const rate = normalizeNumeric(payload["rate"])

  const distinctSources = new Set(supports.map((s) => s.sourceId))
  const hasOfficialSource = supports.some((s) =>
    OFFICIAL_PRIORITIES.has(s.sourcePriority),
  )
  const snippets = await loadSnippets(supports.map((s) => s.claimId))
  const baseMode = await loadCardBaseMode(cardId)

  // §3C — inferred-category gate (only for category-specific claims).
  if (categorySlug) {
    const inferred = evaluateInferredCategory({
      categorySlug,
      rate,
      snippets,
      supportingSourceCount: distinctSources.size,
      baseRate: baseMode?.rate ?? null,
    })
    if (inferred.blocked) {
      return {
        action: "block",
        reason: inferred.reason!,
        matched: inferred.matchedInclusion,
      }
    }
  }

  // §3D — alternate-reward-mode gate.
  const alt = evaluateAltMode({
    formulaType: rewardFormulaType,
    rewardCurrency: currencySlug,
    primaryFormulaType: baseMode?.formulaType ?? null,
    primaryRewardCurrency: baseMode?.currencySlug ?? null,
    supportingSourceCount: distinctSources.size,
    hasOfficialSource,
    snippets,
  })
  if (alt.gateToCandidate) {
    return { action: "candidate", kind: alt.kind, reason: alt.reason! }
  }

  return { action: "materialize" }
}
