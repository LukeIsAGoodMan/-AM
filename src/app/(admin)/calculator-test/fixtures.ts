import type { TransactionContext } from "@/lib/schemas/transaction"

// Canonical demo scenarios. The 7 below mirror scripts/diagnose.ts so the
// /calculator-test page exercises the same paths the diagnostic checks.
// The 8th (Unknown shop) covers PRD §20 step 7 — resolver fallback to low.
//
// `formInput` is the raw form state; the page resolves merchantName →
// category/confidence at render time via HardcodedMerchantResolver.
// `categoryOverride` (when set) bypasses the resolver — used for the
// fixtures whose input was a structured category, not a merchant.
//
// `cardContexts` are keyed by card slug. Campaign refs are by slug
// because campaign ids are random UUIDs; the page resolves slug → id
// against the loaded campaigns list.

export type FixtureFormInput = {
  amountHkd: number
  merchantName?: string
  categoryOverride?: string
  countryRegion?: TransactionContext["countryRegion"]
  isOnline?: boolean
  isForeignCurrency?: boolean
  currency?: string
  transactionDate?: string
}

export type FixtureCardContext = {
  selectedCategorySlugs?: string[]
  activatedRuleIds?: string[]
  activatedCampaignSlugs?: string[]
}

export type Fixture = {
  id: string
  label: string
  description: string
  formInput: FixtureFormInput
  cardContexts?: Record<string, FixtureCardContext>
}

const TXN_DATE = "2026-06-24"

export const FIXTURES: Fixture[] = [
  {
    id: "klook-5k-online",
    label: "Klook HKD 5000 (online, local)",
    description:
      "PRD §20 step 6 — merchant resolver fills category travel_ota at " +
      "confidence 0.90 [high]. Current ranking: HSBC EveryMile > SC Cathay > " +
      "SC SimplyCash > Citi PremierMiles. All medium confidence (rule scores " +
      "cap the result at 0.90).",
    formInput: {
      amountHkd: 5000,
      merchantName: "Klook",
      countryRegion: "HK",
      isOnline: true,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
  },
  {
    id: "unknown-shop-2k",
    label: "Unknown Shop XYZ HKD 2000",
    description:
      "PRD §20 step 7 — resolver falls back to 'unknown' category at " +
      "0.30 confidence; overall confidence drops to low for every card.",
    formInput: {
      amountHkd: 2000,
      merchantName: "Some Random Shop XYZ",
      countryRegion: "HK",
      isOnline: false,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
  },
  {
    id: "overseas-fx-5k",
    label: "General overseas FX HKD 5000",
    description:
      "EveryMile / PremierMiles / SC Cathay should top the ranking — " +
      "overseas + FX both fire.",
    formInput: {
      amountHkd: 5000,
      categoryOverride: "general_overseas",
      countryRegion: "OVERSEAS",
      isOnline: false,
      isForeignCurrency: true,
      currency: "USD",
      transactionDate: TXN_DATE,
    },
  },
  {
    id: "hsbc-red-online-noopt",
    label: "HSBC Red online HKD 3000 — Q3 campaign NOT registered",
    description:
      "Online bonus only, no campaign uplift. HSBC Red Q3 campaign " +
      "rule is gated out by the campaign opt-in check.",
    formInput: {
      amountHkd: 3000,
      categoryOverride: "online_local",
      countryRegion: "HK",
      isOnline: true,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
  },
  {
    id: "hsbc-red-online-optin",
    label: "HSBC Red online HKD 3000 — Q3 campaign REGISTERED",
    description:
      "Same txn, but with the Q3 campaign opted in. HSBC Red picks up " +
      "the extra 2% campaign bonus on top of base + online.",
    formInput: {
      amountHkd: 3000,
      categoryOverride: "online_local",
      countryRegion: "HK",
      isOnline: true,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
    cardContexts: {
      "hsbc-red": {
        activatedCampaignSlugs: ["hsbc-red-2026-q3-online-extra"],
      },
    },
  },
  {
    id: "tax-10k",
    label: "Tax payment HKD 10000",
    description:
      "PRD §8.4 canonical case — bonus rules are excluded; only base " +
      "earn applies for cards whose base isn't ruled out.",
    formInput: {
      amountHkd: 10000,
      categoryOverride: "tax_government",
      countryRegion: "HK",
      isOnline: true,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
  },
  {
    id: "enjoy-dining-selected",
    label: "enJoy dining HKD 2000 — dining IS selected",
    description:
      "Hang Seng enJoy gets dining 4% bonus when dining is among the " +
      "user's selected categories. Beats other cards' base earn.",
    formInput: {
      amountHkd: 2000,
      categoryOverride: "dining_local",
      countryRegion: "HK",
      isOnline: false,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
    cardContexts: {
      "hang-seng-enjoy-card": {
        selectedCategorySlugs: ["dining_local", "online_local", "supermarket"],
      },
    },
  },
  {
    id: "enjoy-dining-not-selected",
    label: "enJoy dining HKD 2000 — dining NOT selected",
    description:
      "Selected-category gate denies enJoy's dining bonus; only base " +
      "earns. Cards with unconditional dining bonuses overtake enJoy.",
    formInput: {
      amountHkd: 2000,
      categoryOverride: "dining_local",
      countryRegion: "HK",
      isOnline: false,
      isForeignCurrency: false,
      currency: "HKD",
      transactionDate: TXN_DATE,
    },
    cardContexts: {
      "hang-seng-enjoy-card": {
        selectedCategorySlugs: ["supermarket", "streaming_subscription"],
      },
    },
  },
]
