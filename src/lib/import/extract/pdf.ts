import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import pdfParse from "pdf-parse"
import type { ExtractionOutcome } from "./types"

// PDF extraction via pdf-parse.
// Input: an absolute path on disk OR a Buffer.
// Returns text + page count + content hash for de-dup.

export async function extractPdf(input: string | Buffer): Promise<ExtractionOutcome> {
  try {
    const buf = typeof input === "string" ? await readFile(input) : input
    const result = await pdfParse(buf)
    const text = normalizeWhitespace(result.text)
    return {
      ok: true,
      text,
      method: "pdf-parse",
      contentHash: sha256(buf),
      metadata: {
        pageCount: result.numpages,
        infoTitle: result.info?.Title,
        infoAuthor: result.info?.Author,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      method: "pdf-parse",
    }
  }
}

const PDF_FETCH_TIMEOUT_MS = 30_000

export async function extractPdfFromUrl(url: string): Promise<ExtractionOutcome> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) am-extractor/0.1",
        Accept: "application/pdf",
      },
      signal: controller.signal,
      redirect: "follow",
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText}`,
        method: "pdf-parse",
      }
    }

    const arrayBuf = await res.arrayBuffer()
    return extractPdf(Buffer.from(arrayBuf))
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      method: "pdf-parse",
    }
  }
}

function normalizeWhitespace(s: string): string {
  // Collapse runs of spaces/tabs but keep single newlines (preserves paragraph
  // structure that's often visible in T&C PDFs).
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}
