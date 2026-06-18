import { createHash } from "node:crypto"
import * as cheerio from "cheerio"
import type { ExtractionOutcome } from "./types"

// HTML extraction: fetch the URL, parse with cheerio, strip noise
// (nav, header, footer, script, style), then pull text out of the main
// content area (<main>, <article>, common content class names, else body).
//
// Not as smart as @mozilla/readability but ~100x lighter — no JSDOM, no
// CommonJS deps. Good enough for bank product pages whose T&C blocks are
// well-tagged. For competitor sites / forum posts in Phase 2 we may want
// to upgrade.

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) am-extractor/0.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-HK,en;q=0.9,zh-HK;q=0.8",
}

const FETCH_TIMEOUT_MS = 20_000

export async function extractHtml(url: string): Promise<ExtractionOutcome> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        method: "html-cheerio",
      }
    }

    const html = await res.text()
    return extractFromHtmlString(html)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      method: "html-cheerio",
    }
  }
}

// Exported separately so unit tests can feed canned HTML.
export function extractFromHtmlString(html: string): ExtractionOutcome {
  try {
    const $ = cheerio.load(html)

    // Capture metadata before stripping
    const title = $("title").first().text().trim() || undefined
    const lang = $("html").attr("lang") || undefined
    const description = $('meta[name="description"]').attr("content") || undefined

    $("script, style, noscript, nav, header, footer, aside, iframe").remove()

    let containerText = ""
    for (const selector of [
      "main",
      "article",
      "[role=main]",
      ".content",
      ".article-body",
      ".main-content",
      "body",
    ]) {
      const el = $(selector).first()
      if (el.length > 0) {
        containerText = collectText($, el)
        if (containerText.length > 200) break
      }
    }

    const text = normalizeWhitespace(containerText)
    return {
      ok: true,
      text,
      method: "html-cheerio",
      contentHash: sha256(html),
      metadata: { title, lang, description, htmlBytes: html.length },
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      method: "html-cheerio",
    }
  }
}

// Pull text out of block-level descendants, one per line, preserving rough
// paragraph structure. `container` is whatever $.first() returned — typed
// as `unknown` to avoid pulling domhandler's `Element`/`AnyNode` into the
// dependency surface just for one signature.
function collectText(
  $: cheerio.CheerioAPI,
  container: ReturnType<cheerio.CheerioAPI>,
): string {
  const parts: string[] = []
  container
    .find("p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre")
    .each((_, node) => {
      const t = $(node).text().trim()
      if (t.length > 0) parts.push(t)
    })
  if (parts.length > 0) return parts.join("\n")
  return container.text().trim()
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}
