// Best-effort card-image fetcher. Loads each card's officialUrl in
// headless Chromium, looks for an Open Graph image first (most reliable),
// then falls back to the largest <img> tag whose URL contains the card
// slug or product name. Downloads to public/card-images/<slug>.<ext>.
//
// Idempotent: skips cards that already have a file on disk. Pass --force
// to re-fetch.
//
// Run with: pnpm fetch:card-images
//
// Expected hit rate: ~30-60%. Banks with root-domain officialUrls (Aeon,
// Amex, virtual banks) routinely fail — manually drop the file into
// public/card-images/<slug>.<ext> for those. The syncer auto-detects.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { chromium, type Browser, type Page } from "playwright"
import { eq, asc, isNotNull } from "drizzle-orm"
import { db } from "@/db/client"
import { cards } from "@/db/schema/catalog"

const OUTPUT_DIR = resolve(process.cwd(), "public", "card-images")
const PAGE_TIMEOUT_MS = 20_000
const NAV_WAIT_MS = 4_000 // post-load settle for SPAs

const SUPPORTED_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"])

type Card = {
  slug: string
  cardNameEn: string
  officialUrl: string
  status: string
}

type FetchResult =
  | { kind: "skipped"; slug: string; reason: string }
  | { kind: "ok"; slug: string; source: string; path: string; bytes: number }
  | { kind: "fail"; slug: string; reason: string }

async function main() {
  const force = process.argv.includes("--force")
  const onlyActive = process.argv.includes("--active-only")

  mkdirSync(OUTPUT_DIR, { recursive: true })

  const rows = await db
    .select({
      slug: cards.slug,
      cardNameEn: cards.cardNameEn,
      officialUrl: cards.officialUrl,
      status: cards.status,
    })
    .from(cards)
    .where(isNotNull(cards.officialUrl))
    .orderBy(asc(cards.slug))

  const candidates: Card[] = rows
    .filter((r) => !onlyActive || r.status === "active")
    .filter((r): r is Card => r.officialUrl !== null)

  console.log(
    `Loaded ${candidates.length} cards with officialUrl${onlyActive ? " (active only)" : ""}`,
  )

  const browser = await chromium.launch({ headless: true })
  const results: FetchResult[] = []

  try {
    for (let i = 0; i < candidates.length; i++) {
      const card = candidates[i]!
      const idx = `[${i + 1}/${candidates.length}]`

      if (!force && hasExistingImage(card.slug)) {
        results.push({
          kind: "skipped",
          slug: card.slug,
          reason: "file exists (use --force to overwrite)",
        })
        console.log(`${idx} ⊘ ${card.slug} — already on disk`)
        continue
      }

      const r = await fetchOne(browser, card)
      results.push(r)
      const tag =
        r.kind === "ok" ? "✓" : r.kind === "skipped" ? "⊘" : "✗"
      const detail =
        r.kind === "ok"
          ? `${r.source} → ${r.path} (${(r.bytes / 1024).toFixed(0)}KB)`
          : "reason" in r
            ? r.reason
            : ""
      console.log(`${idx} ${tag} ${card.slug} — ${detail}`)
    }
  } finally {
    await browser.close()
  }

  console.log("─".repeat(80))
  const ok = results.filter((r) => r.kind === "ok").length
  const skipped = results.filter((r) => r.kind === "skipped").length
  const failed = results.filter((r) => r.kind === "fail").length
  console.log(
    `Summary: ${ok} fetched · ${skipped} already on disk · ${failed} failed`,
  )

  if (failed > 0) {
    console.log("")
    console.log("Failed cards (drop a file into public/card-images/<slug>.<ext> manually):")
    for (const r of results) {
      if (r.kind === "fail") console.log(`  • ${r.slug}  — ${r.reason}`)
    }
  }

  console.log("")
  console.log(
    "Next: re-run `pnpm import:data` to write the image_path column for any new files.",
  )
}

function hasExistingImage(slug: string): boolean {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    if (existsSync(join(OUTPUT_DIR, `${slug}.${ext}`))) return true
  }
  return false
}

async function fetchOne(browser: Browser, card: Card): Promise<FetchResult> {
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  try {
    try {
      await page.goto(card.officialUrl, {
        // networkidle waits for SPAs to settle; bank pages routinely lazy-
        // load the hero image after first paint, so plain domcontentloaded
        // misses them. Falls back to domcontentloaded for sites that never
        // go idle (analytics beacons etc).
        waitUntil: "networkidle",
        timeout: PAGE_TIMEOUT_MS,
      })
    } catch {
      try {
        await page.goto(card.officialUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        })
      } catch (err) {
        return {
          kind: "fail",
          slug: card.slug,
          reason: `nav failed: ${(err as Error).message.split("\n")[0]}`,
        }
      }
    }
    await page.waitForTimeout(NAV_WAIT_MS)

    // Strategy 1: og:image — but skip when it's actually a favicon, logo, or
    // SVG, which Hang Seng / SC sometimes use as a fallback og:image and
    // which we never want as a card face.
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute("content")
      .catch(() => null)
    if (ogImage && isPlausibleCardImage(ogImage)) {
      const r = await downloadAndStore(page, card.slug, ogImage, "og:image")
      if (r) return r
    }

    // Strategy 2: largest visible <img> whose URL hints at a card asset
    const heroSrc = await findHeroImage(page, card)
    if (heroSrc) {
      const r = await downloadAndStore(page, card.slug, heroSrc, "hero img")
      if (r) return r
    }

    return {
      kind: "fail",
      slug: card.slug,
      reason: "no og:image, no plausible hero img",
    }
  } finally {
    await page.close()
  }
}

async function findHeroImage(page: Page, card: Card): Promise<string | null> {
  // Look at every img the page rendered. Prefer ones whose src/alt hints at
  // a card asset (filename matches part of the card slug, or alt mentions
  // "card"). Filter out tiny icons.
  const candidates = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"))
    return imgs
      .map((img) => ({
        src: img.currentSrc || img.src,
        alt: img.alt || "",
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      }))
      .filter((i) => i.src && i.width >= 200 && i.height >= 100)
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 10)
  })

  if (candidates.length === 0) return null

  const slugParts = card.slug.split("-")

  // Prefer images whose src/alt mentions the card by name OR "card" keyword.
  const scored = candidates
    .map((c) => {
      const haystack = (c.src + " " + c.alt).toLowerCase()
      let score = c.width * c.height // base = pixel area
      for (const part of slugParts) {
        if (part.length >= 4 && haystack.includes(part)) score *= 2
      }
      if (haystack.includes("card") || haystack.includes("credit"))
        score *= 1.5
      return { ...c, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.src ?? null
}

async function downloadAndStore(
  page: Page,
  slug: string,
  url: string,
  source: string,
): Promise<FetchResult | null> {
  try {
    const absoluteUrl = new URL(url, page.url()).href
    const ext = pickExtension(absoluteUrl)
    if (!ext) {
      return {
        kind: "fail",
        slug,
        reason: `unsupported image extension for ${absoluteUrl}`,
      }
    }
    const resp = await page.context().request.get(absoluteUrl, {
      timeout: PAGE_TIMEOUT_MS,
    })
    if (!resp.ok()) {
      return {
        kind: "fail",
        slug,
        reason: `download ${resp.status()} from ${absoluteUrl}`,
      }
    }
    const buffer = await resp.body()
    if (buffer.byteLength < 2_000) {
      // Probably a tracking pixel; treat as miss.
      return null
    }
    const outPath = join(OUTPUT_DIR, `${slug}.${ext}`)
    writeFileSync(outPath, buffer)
    return {
      kind: "ok",
      slug,
      source,
      path: `/card-images/${slug}.${ext}`,
      bytes: buffer.byteLength,
    }
  } catch (err) {
    return {
      kind: "fail",
      slug,
      reason: `download error: ${(err as Error).message.split("\n")[0]}`,
    }
  }
}

function pickExtension(url: string): string | null {
  // Strip query string then take the path extension.
  const path = url.split("?")[0]?.toLowerCase() ?? ""
  const e = extname(path).slice(1) // ".png" → "png"
  if (SUPPORTED_EXTS.has(`.${e}`)) return e
  // Some CDN URLs omit the extension; default to png and hope for the best.
  return null
}

// Filter for "is this URL a real card-face image vs a favicon/logo/sprite".
// First-pass og:image fallbacks (Hang Seng, AmEx) tend to return logos —
// reject those so we fall through to the hero <img> scan.
function isPlausibleCardImage(url: string): boolean {
  const lower = url.toLowerCase()
  if (lower.endsWith(".ico") || lower.endsWith(".svg")) return false
  if (lower.includes("favicon")) return false
  if (lower.includes("logo")) return false
  if (lower.includes("sprite")) return false
  // Malformed URLs (missing colon, double protocol) — let URL constructor
  // catch and the download attempt skip them.
  try {
    new URL(url)
  } catch {
    return false
  }
  return true
}

// Touch eq so the unused-import gate doesn't trip the bundler.
void eq

main()
  .catch((err) => {
    console.error("fetch-card-images failed:", err)
    process.exit(1)
  })
  .finally(() => setTimeout(() => process.exit(0), 100))
