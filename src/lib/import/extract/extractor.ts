import { extractPdf, extractPdfFromUrl } from "./pdf"
import { extractHtml } from "./html"
import type { ExtractionOutcome } from "./types"

// Routes a source document to the right extractor based on type + inputs.

export type SourceLike = {
  sourceType: string
  url: string | null
  storagePath: string | null
}

export async function extractSource(source: SourceLike): Promise<ExtractionOutcome> {
  switch (source.sourceType) {
    case "official_pdf_tc":
      if (source.storagePath) return extractPdf(source.storagePath)
      if (source.url) return extractPdfFromUrl(source.url)
      return {
        ok: false,
        error: "official_pdf_tc requires storagePath or url",
        method: "pdf-parse",
      }

    case "official_page":
    case "competitor_page":
    case "forum_post":
    case "reddit_post":
    case "lihkg_post":
      if (!source.url) {
        return {
          ok: false,
          error: `${source.sourceType} requires url`,
          method: "html-cheerio",
        }
      }
      return extractHtml(source.url)

    case "official_app_screenshot":
    case "official_open_api":
    case "user_submission":
    case "manual_note":
      // Not auto-extractable in MVP. OCR (screenshot) lands later; API + manual
      // are filled by humans.
      return {
        ok: false,
        error: `${source.sourceType} is not auto-extractable in MVP`,
        method: null,
      }

    default:
      return {
        ok: false,
        error: `unknown sourceType ${source.sourceType}`,
        method: null,
      }
  }
}
