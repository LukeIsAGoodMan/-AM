import type { RewardFormula } from "@/lib/schemas/formula"
import type { TransactionContext } from "@/lib/schemas/transaction"

// Returns reward units in the rule's reward currency (NOT yet converted to HKD).
// M1: simple_percent only. New variants added in M2+ per PRD §7.

export function applyFormula(
  formula: RewardFormula,
  txn: TransactionContext,
): number {
  switch (formula.type) {
    case "simple_percent":
      return txn.amountHkd * formula.rate
  }
}
