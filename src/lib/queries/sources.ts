import { eq, sql, desc } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  issuers,
  rewardRules,
  sourceChunks,
  sourceDocuments,
} from "@/db/schema/catalog"

export type SourceListRow = {
  id: string
  slug: string
  title: string
  sourceType: string
  sourcePriority: number
  status: string
  language: string
  url: string | null
  issuerSlug: string | null
  issuerNameEn: string | null
  cardSlug: string | null
  cardNameEn: string | null
  extractionFailed: boolean
  extractionMethod: string | null
  extractionError: string | null
  extractedChars: number
  chunkCount: number
  retrievedAt: Date | null
}

export async function listSources(): Promise<SourceListRow[]> {
  const chunkCountsBySource = db.$with("chunk_counts").as(
    db
      .select({
        sourceId: sourceChunks.sourceId,
        chunkTotal: sql<number>`COUNT(*)::int`.as("chunk_total"),
      })
      .from(sourceChunks)
      .groupBy(sourceChunks.sourceId),
  )

  const rows = await db
    .with(chunkCountsBySource)
    .select({
      id: sourceDocuments.id,
      slug: sourceDocuments.slug,
      title: sourceDocuments.title,
      sourceType: sourceDocuments.sourceType,
      sourcePriority: sourceDocuments.sourcePriority,
      status: sourceDocuments.status,
      language: sourceDocuments.language,
      url: sourceDocuments.url,
      issuerSlug: issuers.slug,
      issuerNameEn: issuers.nameEn,
      cardSlug: cards.slug,
      cardNameEn: cards.cardNameEn,
      extractionFailed: sourceDocuments.extractionFailed,
      extractionMethod: sourceDocuments.extractionMethod,
      extractionError: sourceDocuments.extractionError,
      extractedChars: sql<number>`COALESCE(LENGTH(${sourceDocuments.extractedText}), 0)::int`,
      chunkCount: sql<number>`COALESCE(${chunkCountsBySource.chunkTotal}, 0)::int`,
      retrievedAt: sourceDocuments.retrievedAt,
    })
    .from(sourceDocuments)
    .leftJoin(issuers, eq(sourceDocuments.issuerId, issuers.id))
    .leftJoin(cards, eq(sourceDocuments.cardId, cards.id))
    .leftJoin(
      chunkCountsBySource,
      eq(chunkCountsBySource.sourceId, sourceDocuments.id),
    )
    .orderBy(sourceDocuments.sourcePriority, sourceDocuments.slug)

  return rows
}

export type SourceDetail = {
  source: typeof sourceDocuments.$inferSelect
  issuer: typeof issuers.$inferSelect | null
  card: typeof cards.$inferSelect | null
  chunks: (typeof sourceChunks.$inferSelect)[]
  citingRules: (typeof rewardRules.$inferSelect)[]
}

export async function getSourceDetail(
  slug: string,
): Promise<SourceDetail | null> {
  const found = await db
    .select()
    .from(sourceDocuments)
    .leftJoin(issuers, eq(sourceDocuments.issuerId, issuers.id))
    .leftJoin(cards, eq(sourceDocuments.cardId, cards.id))
    .where(eq(sourceDocuments.slug, slug))

  const row = found[0]
  if (!row) return null

  const sourceId = row.source_documents.id

  const [chunks, citingRules] = await Promise.all([
    db
      .select()
      .from(sourceChunks)
      .where(eq(sourceChunks.sourceId, sourceId))
      .orderBy(sourceChunks.chunkIndex),
    db
      .select()
      .from(rewardRules)
      .where(eq(rewardRules.sourceId, sourceId))
      .orderBy(rewardRules.status, desc(rewardRules.priority), rewardRules.slug),
  ])

  return {
    source: row.source_documents,
    issuer: row.issuers,
    card: row.cards,
    chunks,
    citingRules,
  }
}
