import { z } from "zod"

// PRD §7. M3 ships with: simple_percent, tiered_percent, tiered_points.
// M4 adds: fixed_bonus, first_n_transactions_bonus, no_reward, custom_note.
// `custom_note` exists as an escape hatch but is counted; >10% usage = redesign.

export const AccrualPeriodSchema = z.enum([
  "month",
  "quarter",
  "year",
  "campaign",
  "lifetime",
])
export type AccrualPeriod = z.infer<typeof AccrualPeriodSchema>

// One bracket of a tiered formula. `maxAmountHkd: null` means open-ended top.
export const TierBracketSchema = z.object({
  minAmountHkd: z.number().min(0),
  maxAmountHkd: z.number().min(0).nullable(),
  rate: z.number().min(0).max(1),
})

export const TierBracketPointsSchema = z.object({
  minAmountHkd: z.number().min(0),
  maxAmountHkd: z.number().min(0).nullable(),
  points: z.number().min(0),
  perHkd: z.number().positive(),
})

export const RewardFormulaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simple_percent"),
    rate: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("tiered_percent"),
    accrualPeriod: AccrualPeriodSchema,
    tiers: z.array(TierBracketSchema).min(1),
  }),
  z.object({
    type: z.literal("tiered_points"),
    accrualPeriod: AccrualPeriodSchema,
    currencySlug: z.string(),
    tiers: z.array(TierBracketPointsSchema).min(1),
  }),
])

export type RewardFormula = z.infer<typeof RewardFormulaSchema>

export const RewardFormulaTypes = [
  "simple_percent",
  "tiered_percent",
  "tiered_points",
] as const satisfies ReadonlyArray<RewardFormula["type"]>

export type RewardFormulaType = (typeof RewardFormulaTypes)[number]
