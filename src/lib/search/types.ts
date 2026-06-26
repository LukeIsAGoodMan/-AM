// Phase 3 — Layer 3 (RAG) interface stub. PRD §15.
//
// MVP populates source_documents.extracted_text + source_chunks (per M8),
// so when SourceSearcher implementation lands it has the corpus ready.
// Today nothing in MVP imports this interface — it's reserved here so
// future implementers don't redesign it.
//
// TODO: implement when Q&A chatbot (Phase 4+) needs grounded answers.

export type SearchFilter = {
  cardId?: string
  issuerId?: string
  ruleType?: string
}

export type SearchResult = {
  sourceId: string
  chunkId: string
  text: string
  score: number          // 0..1 cosine similarity
  cardSlug: string | null
  sourceTitle: string
  sourceUrl: string | null
}

export interface SourceSearcher {
  // Semantic search across source_chunks. Implementer's contract:
  //   - Embed the question with the same model used to embed the chunks
  //     (Phase 3 migration adds source_chunks.embedding vector(1536)).
  //   - Return top-K chunks ranked by cosine similarity, scoped by filters.
  search(question: string, filters?: SearchFilter, k?: number): Promise<SearchResult[]>
}
