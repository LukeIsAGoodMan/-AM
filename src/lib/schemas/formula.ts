import { z } from "zod"

// PRD §7. M1 ships with `simple_percent` only.
// M2 adds: tiered_percent (with accrual_period), fixed_bonus.
// M3 adds: tiered_points, miles_per_hkd.
// M4 adds: first_n_transactions_bonus, no_reward.
// `custom_note` exists as an escape hatch but is counted; >10% usage = redesign.

export const RewardFormulaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simple_percent"),
    rate: z.number().min(0).max(1),
  }),
])

export type RewardFormula = z.infer<typeof RewardFormulaSchema>

export const RewardFormulaTypes = [
  "simple_percent",
] as const satisfies ReadonlyArray<RewardFormula["type"]>

export type RewardFormulaType = (typeof RewardFormulaTypes)[number]
