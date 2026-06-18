// ~30 common HK merchants for the M7 hardcoded resolver.
// When merchant_datapoints + a merchants table land (M9 / Phase 2), this list
// becomes a one-time seed; the resolver then queries the table instead.

export type SeedMerchant = {
  slug: string
  canonicalName: string
  aliases: string[]
  categorySlug: string
  confidence: number
  possibleMccs?: string[]
  notes?: string
}

export const SEED_MERCHANTS: SeedMerchant[] = [
  // ---- supermarkets ----
  { slug: "parknshop", canonicalName: "PARKnSHOP", aliases: ["ParknShop", "PnS", "百佳"], categorySlug: "supermarket", confidence: 0.95 },
  { slug: "wellcome", canonicalName: "Wellcome", aliases: ["惠康"], categorySlug: "supermarket", confidence: 0.95 },
  { slug: "dch", canonicalName: "DCH Food Mart", aliases: ["DCH", "大昌食品專門店"], categorySlug: "supermarket", confidence: 0.9 },
  { slug: "watsons", canonicalName: "Watsons", aliases: ["Watson's", "屈臣氏"], categorySlug: "beauty_health", confidence: 0.9, notes: "Some banks code as supermarket." },
  { slug: "mannings", canonicalName: "Mannings", aliases: ["萬寧"], categorySlug: "beauty_health", confidence: 0.9, notes: "Some banks code as supermarket." },

  // ---- department stores ----
  { slug: "sogo", canonicalName: "SOGO", aliases: ["崇光"], categorySlug: "department_store", confidence: 0.95 },
  { slug: "yata", canonicalName: "Yata", aliases: ["一田"], categorySlug: "department_store", confidence: 0.95 },

  // ---- dining ----
  { slug: "kfc-hk", canonicalName: "KFC", aliases: ["Kentucky", "肯德基"], categorySlug: "dining_local", confidence: 0.95 },
  { slug: "mcdonalds-hk", canonicalName: "McDonald's", aliases: ["McDonalds", "McD", "麥當勞"], categorySlug: "dining_local", confidence: 0.95 },
  { slug: "starbucks-hk", canonicalName: "Starbucks", aliases: ["星巴克"], categorySlug: "dining_local", confidence: 0.95 },
  { slug: "foodpanda", canonicalName: "Foodpanda", aliases: ["foodpanda HK", "熊貓外賣"], categorySlug: "dining_local", confidence: 0.75, notes: "Some banks code as online_local (online platform). Confidence reduced for the ambiguity." },
  { slug: "deliveroo", canonicalName: "Deliveroo", aliases: ["戶戶送"], categorySlug: "dining_local", confidence: 0.75, notes: "Same online/dining ambiguity as Foodpanda." },

  // ---- travel ----
  { slug: "klook", canonicalName: "Klook", aliases: ["客路"], categorySlug: "travel_ota", confidence: 0.9 },
  { slug: "trip-com", canonicalName: "Trip.com", aliases: ["Ctrip", "攜程"], categorySlug: "travel_ota", confidence: 0.9 },
  { slug: "agoda", canonicalName: "Agoda", aliases: [], categorySlug: "travel_ota", confidence: 0.9 },
  { slug: "booking-com", canonicalName: "Booking.com", aliases: ["Booking"], categorySlug: "travel_ota", confidence: 0.9 },
  { slug: "cathay-pacific", canonicalName: "Cathay Pacific", aliases: ["國泰航空", "CX"], categorySlug: "travel_airline", confidence: 0.95 },
  { slug: "hk-express", canonicalName: "HK Express", aliases: ["香港快運", "UO"], categorySlug: "travel_airline", confidence: 0.95 },

  // ---- transport ----
  { slug: "mtr", canonicalName: "MTR", aliases: ["港鐵"], categorySlug: "public_transport", confidence: 0.95 },
  { slug: "octopus", canonicalName: "Octopus", aliases: ["八達通", "Octopus AAVS"], categorySlug: "octopus", confidence: 0.95 },
  { slug: "uber-hk", canonicalName: "Uber", aliases: ["Uber HK"], categorySlug: "taxi_ride_hailing", confidence: 0.9 },

  // ---- e-wallet ----
  { slug: "alipayhk", canonicalName: "AlipayHK", aliases: ["Alipay HK", "支付寶香港"], categorySlug: "ewallet_topup", confidence: 0.95 },
  { slug: "wechat-pay-hk", canonicalName: "WeChat Pay HK", aliases: ["WeChat Pay"], categorySlug: "ewallet_topup", confidence: 0.95 },
  { slug: "payme", canonicalName: "PayMe", aliases: ["HSBC PayMe"], categorySlug: "ewallet_topup", confidence: 0.95 },

  // ---- online retail ----
  { slug: "hktvmall", canonicalName: "HKTVmall", aliases: ["HKTV mall"], categorySlug: "online_local", confidence: 0.9 },
  { slug: "apple-store-hk", canonicalName: "Apple Store HK", aliases: ["Apple Online Store", "Apple Hong Kong"], categorySlug: "online_local", confidence: 0.85 },

  // ---- streaming / subscriptions ----
  { slug: "netflix", canonicalName: "Netflix", aliases: [], categorySlug: "streaming_subscription", confidence: 0.95 },
  { slug: "spotify", canonicalName: "Spotify", aliases: [], categorySlug: "streaming_subscription", confidence: 0.95 },
  { slug: "disney-plus", canonicalName: "Disney+", aliases: ["Disney Plus"], categorySlug: "streaming_subscription", confidence: 0.95 },
  { slug: "apple-music", canonicalName: "Apple Music", aliases: [], categorySlug: "streaming_subscription", confidence: 0.95 },

  // ---- telecom ----
  { slug: "csl", canonicalName: "CSL", aliases: [], categorySlug: "telecom", confidence: 0.95 },
  { slug: "3hk", canonicalName: "3HK", aliases: ["3 Hong Kong", "和記電訊"], categorySlug: "telecom", confidence: 0.95 },
  { slug: "hkbn", canonicalName: "HKBN", aliases: ["Hong Kong Broadband"], categorySlug: "telecom", confidence: 0.95 },
  { slug: "china-mobile-hk", canonicalName: "China Mobile HK", aliases: ["中國移動香港", "CMHK"], categorySlug: "telecom", confidence: 0.95 },

  // ---- tax / government ----
  { slug: "ird-hk", canonicalName: "Inland Revenue Department", aliases: ["IRD", "稅務局"], categorySlug: "tax_government", confidence: 0.95 },
]
