import type { MerchantResolution, MerchantResolver } from "./types"
import { SEED_MERCHANTS, type SeedMerchant } from "./seed-merchants"

// Phase-1 implementation per PRD §9 (and reserved in calculator-semantics §9).
// Builds a case-insensitive lookup over canonical names + aliases.
// When merchant data moves to the DB (Phase 2), the lookup swaps to a query
// against the merchants table — the MerchantResolver interface stays the same.

export const FALLBACK_RESOLUTION: MerchantResolution = {
  categorySlug: "unknown",
  confidence: 0.3,
  candidateMccs: [],
  sourceIds: [],
  fallbackUsed: true,
}

export class HardcodedMerchantResolver implements MerchantResolver {
  private byName: Map<string, SeedMerchant>

  constructor(merchants: SeedMerchant[] = SEED_MERCHANTS) {
    this.byName = new Map()
    for (const m of merchants) {
      this.register(m.canonicalName, m)
      for (const alias of m.aliases) this.register(alias, m)
    }
  }

  private register(rawKey: string, merchant: SeedMerchant): void {
    const key = normalize(rawKey)
    const existing = this.byName.get(key)
    if (existing && existing.slug !== merchant.slug) {
      throw new Error(
        `Duplicate merchant key "${rawKey}" (normalized "${key}") between ${existing.slug} and ${merchant.slug}`,
      )
    }
    this.byName.set(key, merchant)
  }

  async resolve(name: string, _cardId?: string): Promise<MerchantResolution> {
    const m = this.byName.get(normalize(name))
    if (!m) return FALLBACK_RESOLUTION
    return {
      categorySlug: m.categorySlug,
      confidence: m.confidence,
      candidateMccs: m.possibleMccs ?? [],
      matchedMerchantSlug: m.slug,
      sourceIds: [],
      fallbackUsed: false,
    }
  }
}

// "PARKnSHOP " / "parknshop" / "PnS" all hit the same entry.
function normalize(s: string): string {
  return s.trim().toLowerCase()
}
