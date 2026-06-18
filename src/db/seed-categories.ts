import { eq } from "drizzle-orm"
import type { DB } from "./client"
import { categories } from "./schema/catalog"

// Canonical category taxonomy — PRD §6.5.
// Banks have their own category systems; ours is the canonical reference
// that bank-specific categories map into. Don't reuse a bank's taxonomy here.

type SeedCategory = {
  slug: string
  nameEn: string
  nameZh?: string
  parentSlug?: string
  exampleMerchants?: string[]
}

const CANONICAL_CATEGORIES: SeedCategory[] = [
  // Top-level general buckets
  {
    slug: "general_local",
    nameEn: "General — Local (HK)",
    nameZh: "本地一般消費",
  },
  {
    slug: "general_overseas",
    nameEn: "General — Overseas",
    nameZh: "海外一般消費",
  },

  // Dining
  { slug: "dining_local", nameEn: "Dining — Local", nameZh: "本地餐飲" },
  { slug: "dining_overseas", nameEn: "Dining — Overseas", nameZh: "海外餐飲" },

  // Online channel
  { slug: "online_local", nameEn: "Online — Local", nameZh: "本地網上消費" },
  {
    slug: "online_overseas",
    nameEn: "Online — Overseas",
    nameZh: "海外網上消費",
  },

  // Travel
  { slug: "travel_general", nameEn: "Travel — General", nameZh: "旅遊一般" },
  { slug: "travel_airline", nameEn: "Travel — Airline", nameZh: "航空" },
  { slug: "travel_hotel", nameEn: "Travel — Hotel", nameZh: "酒店" },
  {
    slug: "travel_ota",
    nameEn: "Travel — OTA",
    nameZh: "旅遊網站",
    exampleMerchants: ["Klook", "Trip.com", "Agoda", "Booking.com"],
  },

  // Groceries / retail
  {
    slug: "supermarket",
    nameEn: "Supermarket",
    nameZh: "超級市場",
    exampleMerchants: ["PARKnSHOP", "Wellcome", "ParknShop", "U-Select", "Mannings", "Watsons"],
  },
  { slug: "grocery", nameEn: "Grocery", nameZh: "雜貨" },
  {
    slug: "department_store",
    nameEn: "Department Store",
    nameZh: "百貨公司",
    exampleMerchants: ["SOGO", "Yata", "Wing On"],
  },

  // Transport
  { slug: "transport", nameEn: "Transport", nameZh: "交通" },
  {
    slug: "public_transport",
    nameEn: "Public Transport",
    nameZh: "公共交通",
    parentSlug: "transport",
    exampleMerchants: ["MTR"],
  },
  {
    slug: "taxi_ride_hailing",
    nameEn: "Taxi / Ride-hailing",
    nameZh: "的士 / 網約車",
    parentSlug: "transport",
    exampleMerchants: ["Uber", "HKTaxi"],
  },
  { slug: "fuel", nameEn: "Fuel", nameZh: "燃油" },

  // Bills / services
  { slug: "education", nameEn: "Education", nameZh: "教育" },
  { slug: "insurance", nameEn: "Insurance", nameZh: "保險" },
  { slug: "tax_government", nameEn: "Tax / Government", nameZh: "稅項及政府收費" },
  { slug: "utilities", nameEn: "Utilities", nameZh: "公共事業" },
  { slug: "telecom", nameEn: "Telecom", nameZh: "電訊" },
  { slug: "healthcare", nameEn: "Healthcare", nameZh: "醫療" },
  { slug: "beauty_health", nameEn: "Beauty / Health", nameZh: "美容保健" },

  // Lifestyle
  { slug: "entertainment", nameEn: "Entertainment", nameZh: "娛樂" },
  {
    slug: "streaming_subscription",
    nameEn: "Streaming / Subscription",
    nameZh: "串流 / 訂閱",
    exampleMerchants: ["Netflix", "Spotify", "Disney+", "Apple Music"],
  },

  // Payment top-ups
  {
    slug: "ewallet_topup",
    nameEn: "E-wallet Top-up",
    nameZh: "電子錢包增值",
    exampleMerchants: ["AlipayHK", "WeChat Pay HK", "PayMe"],
  },
  {
    slug: "octopus",
    nameEn: "Octopus",
    nameZh: "八達通",
    exampleMerchants: ["Octopus"],
  },

  // Housing
  { slug: "rent", nameEn: "Rent", nameZh: "租金" },

  // Geography
  { slug: "mainland_china", nameEn: "Mainland China", nameZh: "中國內地" },
  { slug: "macau", nameEn: "Macau", nameZh: "澳門" },
  { slug: "overseas_fx", nameEn: "Overseas (FX)", nameZh: "海外（外幣）" },

  // Catch-alls
  { slug: "merchant_specific", nameEn: "Merchant-specific", nameZh: "指定商戶" },
  { slug: "excluded", nameEn: "Excluded", nameZh: "不適用" },
  { slug: "unknown", nameEn: "Unknown", nameZh: "未分類" },
]

export async function seedCategories(db: DB): Promise<Map<string, string>> {
  const ids = new Map<string, string>()

  // First pass: upsert without parent_category_id
  for (const c of CANONICAL_CATEGORIES) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, c.slug))
    if (existing[0]) {
      ids.set(c.slug, existing[0].id)
      continue
    }
    const inserted = await db
      .insert(categories)
      .values({
        slug: c.slug,
        nameEn: c.nameEn,
        nameZh: c.nameZh,
        exampleMerchants: c.exampleMerchants,
      })
      .returning({ id: categories.id })
    if (!inserted[0]) {
      throw new Error(`Insert categories failed for slug=${c.slug}`)
    }
    ids.set(c.slug, inserted[0].id)
  }

  // Second pass: set parent FKs now that all rows exist
  for (const c of CANONICAL_CATEGORIES) {
    if (!c.parentSlug) continue
    const parentId = ids.get(c.parentSlug)
    if (!parentId) {
      throw new Error(
        `parentSlug=${c.parentSlug} for category ${c.slug} not found`,
      )
    }
    await db
      .update(categories)
      .set({ parentCategoryId: parentId })
      .where(eq(categories.slug, c.slug))
  }

  return ids
}
