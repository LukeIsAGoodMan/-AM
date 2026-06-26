import type { MerchantResolver, MerchantResolution } from "./types"

// Phase 2+ stub. The hardcoded resolver caps at ~35 HK merchants; an
// embedding-backed resolver lifts coverage to long-tail merchants without
// hand-curation. Implementer's contract is the same MerchantResolver
// interface (D6 in docs/decisions.md), so the calculator and UI need
// zero changes when this swaps in.
//
// Implementation outline (PRD §22.x):
//   - Build embeddings for every `merchant_datapoints.merchant_name` we've
//     observed (user submissions + public source citations).
//   - At resolve() time: embed the query name, nearest-neighbour against
//     the index, return the top hit's categorySlug + cosine-similarity-
//     as-confidence.
//   - Fall back to hardcoded resolver when similarity < threshold (~0.7).
//
// TODO: implement when Phase 3 Wallet Mode ships and merchant_datapoints
// has real user-submitted volume.

export class EmbeddingMerchantResolver implements MerchantResolver {
  async resolve(_name: string, _cardId?: string): Promise<MerchantResolution> {
    throw new Error(
      "EmbeddingMerchantResolver not implemented. Use HardcodedMerchantResolver in MVP.",
    )
  }
}
