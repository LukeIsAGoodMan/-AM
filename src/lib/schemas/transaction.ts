import { z } from "zod"

// PRD §8.1 — minimum fields for M1. Adds is_online / is_foreign_currency /
// country_region in M2+. category / merchant resolver wires up in M2/M7.

export const TransactionRegionSchema = z.enum([
  "HK",
  "MAINLAND_CHINA",
  "MACAU",
  "OVERSEAS",
  "UNKNOWN",
])
export type TransactionRegion = z.infer<typeof TransactionRegionSchema>

export const TransactionContextSchema = z.object({
  amountHkd: z.number().nonnegative(),
  merchantName: z.string().optional(),
  categorySlug: z.string().optional(),
  // M7: caller resolved merchantName → categorySlug via MerchantResolver.
  // Passes the resolver's confidence here so the calculator can fold it
  // into the result confidence (PRD §8.3). When categorySlug came from a
  // trusted source (user-confirmed, structured input), leave undefined =
  // calculator treats as 1.0.
  categoryResolutionConfidence: z.number().min(0).max(1).optional(),
  currency: z.string().optional(),
  countryRegion: TransactionRegionSchema.optional(),
  isOnline: z.boolean().optional(),
  isForeignCurrency: z.boolean().optional(),
  transactionDate: z.string(), // ISO yyyy-mm-dd
})

export type TransactionContext = z.infer<typeof TransactionContextSchema>
