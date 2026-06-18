// PRD §10 — Layer 1 forward-compat. Stored on source_documents + source_chunks.

export type ExtractionMethod =
  | "pdf-parse"
  | "html-cheerio"
  | "manual"

export type ExtractionResult = {
  ok: true
  text: string
  method: ExtractionMethod
  contentHash: string
  metadata: Record<string, unknown> // page count, title, etc.
}

export type ExtractionFailure = {
  ok: false
  error: string
  method: ExtractionMethod | null
}

export type ExtractionOutcome = ExtractionResult | ExtractionFailure
