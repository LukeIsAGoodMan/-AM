import { z } from "zod"

// PRD §7. M4 ships with:
//   simple_percent, tiered_percent, tiered_points, points_per_hkd, no_reward
// M5+ adds: fixed_bonus, first_n_transactions_bonus, custom_note.
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
    type: z.literal("points_per_hkd"),
    points: z.number().nonnegative(),
    perHkd: z.number().positive(),
    currencySlug: z.string(),
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
  z.object({
    type: z.literal("no_reward"),
    reason: z.string().optional(),
  }),
])

export type RewardFormula = z.infer<typeof RewardFormulaSchema>

export const RewardFormulaTypes = [
  "simple_percent",
  "points_per_hkd",
  "tiered_percent",
  "tiered_points",
  "no_reward",
] as const satisfies ReadonlyArray<RewardFormula["type"]>

export type RewardFormulaType = (typeof RewardFormulaTypes)[number]
