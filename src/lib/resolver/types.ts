// PRD §6.11 + §9.
// Resolver translates a free-text merchant name into a canonical category
// (plus confidence) so the calculator can match category-conditioned rules
// without the caller knowing canonical taxonomy.
//
// Architecture: the resolver is intentionally NOT injected into the pure
// calculator. The caller resolves first (await), then passes the result
// onto TransactionContext (categorySlug + categoryResolutionConfidence).
// This keeps calculate() sync and side-effect-free; the resolver remains
// free to do async work (DB queries, embedding lookups in Phase 2).

export type MerchantResolution = {
  categorySlug: string
  confidence: number          // 0..1
  candidateMccs: string[]
  matchedMerchantSlug?: string
  sourceIds: string[]
  fallbackUsed: boolean
}

export interface MerchantResolver {
  resolve(name: string, cardId?: string): Promise<MerchantResolution>
}
