import { eq, and, isNull } from "drizzle-orm"
import type { DB } from "@/db/client"
import { sourceChunks, sourceDocuments } from "@/db/schema/catalog"
import { extractSource } from "./extractor"
import { chunkText } from "./chunker"

// Runs extraction against every source_documents row that has not yet been
// processed. Designed to be idempotent — re-running only retries sources
// where extracted_text IS NULL AND extraction_failed IS FALSE (i.e., never
// attempted). To force a retry of a failed source, manually unset
// extraction_failed before re-running.

export type ExtractReport = {
  attempted: number
  succeeded: number
  failed: number
  totalChunks: number
  details: ExtractDetail[]
}

export type ExtractDetail = {
  sourceSlug: string
  ok: boolean
  method?: string
  chunkCount?: number
  charCount?: number
  error?: string
}

export async function runExtraction(db: DB): Promise<ExtractReport> {
  const candidates = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        isNull(sourceDocuments.extractedText),
        eq(sourceDocuments.extractionFailed, false),
      ),
    )

  const report: ExtractReport = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    totalChunks: 0,
    details: [],
  }

  for (const src of candidates) {
    report.attempted++
    const outcome = await extractSource({
      sourceType: src.sourceType,
      url: src.url,
      storagePath: src.storagePath,
    })

    if (!outcome.ok) {
      await db
        .update(sourceDocuments)
        .set({
          extractionFailed: true,
          extractionError: outcome.error,
          extractionMethod: outcome.method,
          retrievedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sourceDocuments.id, src.id))
      report.failed++
      report.details.push({
        sourceSlug: src.slug,
        ok: false,
        method: outcome.method ?? undefined,
        error: outcome.error,
      })
      continue
    }

    const chunks = chunkText(outcome.text)

    await db
      .update(sourceDocuments)
      .set({
        extractedText: outcome.text,
        extractionMethod: outcome.method,
        contentHash: outcome.contentHash,
        extractionFailed: false,
        extractionError: null,
        retrievedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sourceDocuments.id, src.id))

    // Clear any existing chunks for this source (idempotent re-run hygiene)
    // and insert the new set.
    await db.delete(sourceChunks).where(eq(sourceChunks.sourceId, src.id))
    if (chunks.length > 0) {
      await db.insert(sourceChunks).values(
        chunks.map((c) => ({
          sourceId: src.id,
          chunkIndex: c.index,
          text: c.text,
          metadata: {
            charCount: c.charCount,
            approxTokenCount: c.approxTokenCount,
            sourceMetadata: outcome.metadata,
          },
        })),
      )
    }

    report.succeeded++
    report.totalChunks += chunks.length
    report.details.push({
      sourceSlug: src.slug,
      ok: true,
      method: outcome.method,
      chunkCount: chunks.length,
      charCount: outcome.text.length,
    })
  }

  return report
}
