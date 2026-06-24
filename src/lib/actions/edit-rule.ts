"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db/client"
import {
  campaigns,
  categories,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
} from "@/db/schema/catalog"
import { RewardFormulaSchema } from "@/lib/schemas/formula"

// M15 escape hatch — light edit form for a single rule. YAML in data/ is
// still the source of truth; this only writes the DB row. The next
// `pnpm import:data` would revert these edits if they don't make it back
// into the YAML. Per roadmap M15, that tradeoff is acceptable for the
// demo flow (edit → recalculator updates immediately).
//
// The economic-field refusal logic mirrors `src/lib/import/syncer.ts`:
// an approved rule cannot have its reward math silently changed; the
// caller must demote the rule to draft first (or, in YAML, supersede
// it with a new slug).

const ECONOMIC_RULE_FIELDS = [
  "ruleType",
  "rewardFormulaPayload",
  "rewardCurrencyId",
  "categoryId",
  "campaignId",
  "isOnline",
  "isOverseas",
  "isForeignCurrency",
  "requiresActivation",
  "requiresRegistration",
  "requiresSelectedCategory",
  "capAmountHkd",
  "capRewardAmount",
  "capPeriod",
  "capBasis",
  "appliesTo",
  "stackingPolicy",
  "exclusiveGroup",
  "priority",
  "effectiveStart",
  "effectiveEnd",
] as const

export type EditRuleInput = {
  ruleSlug: string
  ruleName: string
  status: "draft" | "approved" | "archived"
  ruleType: string
  rewardFormulaPayloadJson: string
  rewardCurrencySlug: string | null
  categorySlug: string | null
  campaignSlug: string | null
  sourceSlug: string | null
  isOnline: boolean | null
  isOverseas: boolean | null
  isForeignCurrency: boolean | null
  requiresActivation: boolean
  requiresRegistration: boolean
  requiresSelectedCategory: boolean
  capAmountHkd: string | null
  capRewardAmount: string | null
  capPeriod: string | null
  capBasis: string | null
  appliesTo: string[] | null
  stackingPolicy: "additive" | "max_only_in_group" | "replaces_base"
  exclusiveGroup: string | null
  priority: number
  effectiveStart: string | null
  effectiveEnd: string | null
  confidenceScore: number
  notes: string | null
}

export type EditRuleResult =
  | { ok: true; updatedFields: string[] }
  | { ok: false; error: string; changedEconomicFields?: string[] }

export async function saveRuleEdit(input: EditRuleInput): Promise<EditRuleResult> {
  const existing = await db
    .select()
    .from(rewardRules)
    .where(eq(rewardRules.slug, input.ruleSlug))
  const current = existing[0]
  if (!current) {
    return { ok: false, error: `Rule '${input.ruleSlug}' not found.` }
  }

  // Validate the formula payload via the same Zod schema that gated import.
  // Pull out the type tag for the row's rewardFormulaType column.
  let parsedFormula: ReturnType<typeof RewardFormulaSchema.parse>
  try {
    const json: unknown = JSON.parse(input.rewardFormulaPayloadJson)
    parsedFormula = RewardFormulaSchema.parse(json)
  } catch (err) {
    return {
      ok: false,
      error: `Reward formula JSON is invalid: ${(err as Error).message}`,
    }
  }

  // Resolve FK slugs → ids. Drizzle's TS generics balk at table polymorphism,
  // so each lookup is spelled out.
  const currencyId = input.rewardCurrencySlug
    ? (await db
        .select({ id: rewardCurrencies.id })
        .from(rewardCurrencies)
        .where(eq(rewardCurrencies.slug, input.rewardCurrencySlug)))[0]?.id ?? null
    : null
  if (input.rewardCurrencySlug && !currencyId) {
    return { ok: false, error: `reward_currency_slug '${input.rewardCurrencySlug}' not found.` }
  }
  const categoryId = input.categorySlug
    ? (await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, input.categorySlug)))[0]?.id ?? null
    : null
  if (input.categorySlug && !categoryId) {
    return { ok: false, error: `category_slug '${input.categorySlug}' not found.` }
  }
  const campaignId = input.campaignSlug
    ? (await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(eq(campaigns.slug, input.campaignSlug)))[0]?.id ?? null
    : null
  if (input.campaignSlug && !campaignId) {
    return { ok: false, error: `campaign_slug '${input.campaignSlug}' not found.` }
  }
  const sourceId = input.sourceSlug
    ? (await db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(eq(sourceDocuments.slug, input.sourceSlug)))[0]?.id ?? null
    : null
  if (input.sourceSlug && !sourceId) {
    return { ok: false, error: `source_slug '${input.sourceSlug}' not found.` }
  }

  // Invariant: approved rules must have a source (DB CHECK enforces too).
  if (input.status === "approved" && !sourceId) {
    return {
      ok: false,
      error: "Approved rules must have a source. Pick a source or set status to draft.",
    }
  }

  const wouldBe = {
    ruleType: input.ruleType,
    rewardFormulaType: parsedFormula.type,
    rewardFormulaPayload: parsedFormula,
    rewardCurrencyId: currencyId,
    categoryId,
    campaignId,
    isOnline: input.isOnline,
    isOverseas: input.isOverseas,
    isForeignCurrency: input.isForeignCurrency,
    requiresActivation: input.requiresActivation,
    requiresRegistration: input.requiresRegistration,
    requiresSelectedCategory: input.requiresSelectedCategory,
    capAmountHkd: input.capAmountHkd,
    capRewardAmount: input.capRewardAmount,
    capPeriod: input.capPeriod,
    capBasis: input.capBasis,
    appliesTo: input.appliesTo,
    stackingPolicy: input.stackingPolicy,
    exclusiveGroup: input.exclusiveGroup,
    priority: input.priority,
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
  }

  const economicChanges = ECONOMIC_RULE_FIELDS.filter(
    (f) =>
      !valuesEqual(
        (current as unknown as Record<string, unknown>)[f],
        (wouldBe as unknown as Record<string, unknown>)[f],
      ),
  )

  if (economicChanges.length > 0 && current.status === "approved") {
    return {
      ok: false,
      error:
        `Rule '${input.ruleSlug}' is approved and the edit changes economic fields. ` +
        `Per the syncer's refusal policy, demote to draft first OR rename the slug ` +
        `(e.g. add __v2 suffix and set supersedesSlug) and re-import via YAML.`,
      changedEconomicFields: [...economicChanges],
    }
  }

  // Track what actually changed for the success message.
  const updatedFields: string[] = []
  const allTracked: { name: string; cur: unknown; next: unknown }[] = [
    { name: "ruleName", cur: current.ruleName, next: input.ruleName },
    { name: "status", cur: current.status, next: input.status },
    { name: "confidenceScore", cur: Number(current.confidenceScore), next: input.confidenceScore },
    { name: "sourceId", cur: current.sourceId, next: sourceId },
    { name: "notes", cur: current.notes, next: input.notes },
    ...ECONOMIC_RULE_FIELDS.map((f) => ({
      name: f,
      cur: (current as unknown as Record<string, unknown>)[f],
      next: (wouldBe as unknown as Record<string, unknown>)[f],
    })),
  ]
  for (const { name, cur, next } of allTracked) {
    if (!valuesEqual(cur, next)) updatedFields.push(name)
  }

  if (updatedFields.length === 0) {
    return { ok: true, updatedFields: [] }
  }

  await db
    .update(rewardRules)
    .set({
      ruleName: input.ruleName,
      status: input.status,
      ruleType: input.ruleType,
      rewardFormulaType: parsedFormula.type,
      rewardFormulaPayload: parsedFormula,
      rewardCurrencyId: currencyId,
      categoryId,
      campaignId,
      isOnline: input.isOnline,
      isOverseas: input.isOverseas,
      isForeignCurrency: input.isForeignCurrency,
      requiresActivation: input.requiresActivation,
      requiresRegistration: input.requiresRegistration,
      requiresSelectedCategory: input.requiresSelectedCategory,
      capAmountHkd: input.capAmountHkd,
      capRewardAmount: input.capRewardAmount,
      capPeriod: input.capPeriod,
      capBasis: input.capBasis,
      appliesTo: input.appliesTo,
      stackingPolicy: input.stackingPolicy,
      exclusiveGroup: input.exclusiveGroup,
      priority: input.priority,
      effectiveStart: input.effectiveStart,
      effectiveEnd: input.effectiveEnd,
      sourceId,
      confidenceScore: input.confidenceScore.toFixed(3),
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(rewardRules.slug, input.ruleSlug))

  // Invalidate every surface that depends on rule rows.
  revalidatePath("/rules")
  revalidatePath(`/rules/${input.ruleSlug}`)
  revalidatePath("/cards")
  revalidatePath("/calculator-test")

  return { ok: true, updatedFields }
}

// Same equality semantics as syncer.valuesEqual:
//   - jsonb key order isn't preserved → recurse, sort keys
//   - numeric is stringly typed in pg → coerce
//   - arrays compared element-wise
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => valuesEqual(x, b[i]))
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao).sort()
    const bk = Object.keys(bo).sort()
    if (ak.length !== bk.length) return false
    return ak.every((k, i) => k === bk[i] && valuesEqual(ao[k], bo[k]))
  }
  // Numeric coercion — handles pg numeric returning "12.000" while form
  // submits a JS number.
  const an = Number(a)
  const bn = Number(b)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an === bn
  return String(a) === String(b)
}
