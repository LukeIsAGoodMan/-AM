import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { UserCardContext } from "@/lib/calculator/calculate"

// PRD §13. Layer 6 — simulate ongoing reward over N months given a spending
// profile + a card's rules. Used by Plan Mode and as a sanity check for
// individual card valuations.
//
// Like the calculator, the simulator is pure: it takes rules + welcome offers
// as input rather than loading from DB. The DB-loading wrapper lands with the
// admin /projection-test page in M16.

export type SpendingProfile = {
  // category slug → HKD per month
  monthlyByCategory: Record<string, number>
  // Optional one-shot annual numbers (e.g., travel HKD per year). Distributed
  // evenly across the projection horizon as monthly synthetic txns.
  travelPerYearHkd?: number
  // Fraction of the monthlyByCategory total that is foreign-currency. The
  // naive impl applies it uniformly per-category-per-month.
  fxShare?: number
}

export type ResolvedWelcomeOffer = {
  offerId: string
  offerName: string
  estimatedValueHkd: number
}

export type ProjectionInputs = {
  cardId: string
  rules: ResolvedRule[]
  welcomeOffers: ResolvedWelcomeOffer[]
  profile: SpendingProfile
  monthsAhead: number
  includeWelcomeOffer: boolean
  // First synthetic txn date. Subsequent txns advance one month per iteration.
  startDate: string // YYYY-MM-DD
  userContext?: UserCardContext
}

export type Projection = {
  cardId: string
  totalRewardValueHkd: number
  perMonthHkd: number[]
  welcomeOfferContributionHkd: number
  caveats: string[]
}

export interface SimulationEngine {
  project(input: ProjectionInputs): Promise<Projection>
}
