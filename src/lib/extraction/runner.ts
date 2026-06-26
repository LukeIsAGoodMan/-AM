import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  issuers,
  sourceChunks,
  sourceDocuments,
} from "@/db/schema/catalog"
import { extractionRuns } from "@/db/schema/extraction"
import {
  computeInputHash,
  extractClaimsFromChunk,
  type ExtractInput,
  type ExtractResult,
} from "./extractor"
import { PROMPT_VERSION } from "./prompt"

// P3 — batch extraction runner. Orchestrates many P2 single-chunk calls
// across a scope of source_chunks, with three guarantees the single-call
// path doesn't provide:
//
//   1. Dedup. Skip chunks whose (PROMPT_VERSION, source_id, chunk_text)
//      hash already exists in extraction_runs.input_hash. Lets you safely
//      re-run after an interrupted batch, or after manual cleanup, without
//      paying for re-extraction.
//
//   2. Concurrency control. Worker pool size capped (default 3) to keep
//      cache hits warm (skill: a cache write must finish streaming before
//      the next request can read it; high concurrency on a cold cache
//      pays the write premium N times in parallel for nothing).
//
//   3. Failure isolation. Promise.allSettled per batch — one chunk's
//      API error or schema-validation failure does not abort sibling
//      chunks. Failed chunks land on extraction_runs with status=failed
//      and re-run on the next pass (they're not in seenHashes because
//      pending/failed rows don't share the same input_hash semantics).
//
// Out of scope here: scheduling re-runs of failed chunks, retry-with-
// backoff at the runner level (the SDK already retries 429s + 5xx with
// exponential backoff), cost budgets ("stop if I've spent $X today").
// These can layer on later if Phase 2 actually grows past the size
// where eyeballing the summary suffices.

export type RunScope = {
  // Filter by card slug — most common dev usage ("just hsbc-red please").
  // If specified, status and limit interact with this.
  cardSlugs?: string[]
  // Filter by card status. Phase 2's bulk extraction targets 'draft'
  // (the xlsx-seeded pool that needs rules built from sources). 'active'
  // can be used for re-extraction over the hand-curated 10.
  cardStatuses?: ("active" | "draft" | "archived")[]
  // Cap total chunks processed across the scope. Useful for cost-bounded
  // exploration runs. Order is (card slug asc, chunk_index asc).
  maxChunks?: number
}

export type RunOptions = {
  scope: RunScope
  // Parallel API calls. Default 3 — comfortably below most rate limits,
  // keeps the cache-write window predictable. Bump to 5-8 for higher tiers.
  concurrency?: number
  // Re-extract even if a matching extraction_run exists. Default false
  // (idempotent re-run).
  force?: boolean
  // Skip DB writes (no extraction_runs, no source_claims). Still calls the
  // API and reports cost — useful for prompt experimentation.
  dryRun?: boolean
  // Per-chunk callback fired after each extraction completes (success or
  // failure). CLI uses this to stream progress lines. Optional.
  onChunkComplete?: (event: ChunkEvent) => void
}

export type ChunkEvent =
  | {
      kind: "skipped"
      cardSlug: string
      sourceSlug: string
      chunkIndex: number
      reason: string
    }
  | {
      kind: "ok"
      cardSlug: string
      sourceSlug: string
      chunkIndex: number
      claimsEmitted: number
      costUsdCents: number
      latencyMs: number
      cacheReadInputTokens: number
    }
  | {
      kind: "fail"
      cardSlug: string
      sourceSlug: string
      chunkIndex: number
      reason: string
    }

export type RunSummary = {
  scopeSize: number // total chunks matched
  skipped: number
  processed: number
  failed: number
  claimsEmitted: number
  totalCostUsdCents: number
  totalLatencyMs: number
  perCard: Record<
    string,
    {
      processed: number
      skipped: number
      failed: number
      claimsEmitted: number
      costUsdCents: number
    }
  >
}

type ChunkWithContext = {
  chunkId: string
  chunkIndex: number
  text: string
  inputHash: string
  sourceId: string
  sourceSlug: string
  sourceTitle: string
  sourceType: string
  cardId: string
  cardSlug: string
  cardNameEn: string
  issuerNameEn: string
}

// Injectable extractor for testing — defaults to the real one. Tests pass
// a mock that captures inputs and returns canned results.
export type ExtractFn = (input: ExtractInput) => Promise<ExtractResult>

export async function runExtraction(
  options: RunOptions,
  extractFn: ExtractFn = extractClaimsFromChunk,
): Promise<RunSummary> {
  const concurrency = Math.max(1, options.concurrency ?? 3)

  const allChunks = await loadChunksInScope(options.scope)
  const seenHashes = options.force
    ? new Set<string>()
    : await loadSeenInputHashes(allChunks.map((c) => c.inputHash))

  const todo = allChunks.filter((c) => !seenHashes.has(c.inputHash))

  const summary: RunSummary = {
    scopeSize: allChunks.length,
    skipped: allChunks.length - todo.length,
    processed: 0,
    failed: 0,
    claimsEmitted: 0,
    totalCostUsdCents: 0,
    totalLatencyMs: 0,
    perCard: {},
  }

  for (const c of allChunks) {
    if (!summary.perCard[c.cardSlug]) {
      summary.perCard[c.cardSlug] = {
        processed: 0,
        skipped: 0,
        failed: 0,
        claimsEmitted: 0,
        costUsdCents: 0,
      }
    }
  }
  for (const c of allChunks) {
    if (seenHashes.has(c.inputHash)) {
      summary.perCard[c.cardSlug]!.skipped += 1
      options.onChunkComplete?.({
        kind: "skipped",
        cardSlug: c.cardSlug,
        sourceSlug: c.sourceSlug,
        chunkIndex: c.chunkIndex,
        reason: "already extracted (use --force to re-run)",
      })
    }
  }

  // Process in batches of `concurrency`. Promise.allSettled isolates
  // failures: one bad chunk doesn't reject the whole batch.
  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map((c) => runOne(c, options.dryRun ?? false, extractFn)),
    )
    for (let j = 0; j < settled.length; j++) {
      const c = batch[j]!
      const result = settled[j]!
      const perCard = summary.perCard[c.cardSlug]!
      if (result.status === "fulfilled") {
        const r = result.value
        summary.processed += 1
        summary.claimsEmitted += r.claims.length
        summary.totalCostUsdCents += r.costUsdCents
        summary.totalLatencyMs += r.latencyMs
        perCard.processed += 1
        perCard.claimsEmitted += r.claims.length
        perCard.costUsdCents += r.costUsdCents
        options.onChunkComplete?.({
          kind: "ok",
          cardSlug: c.cardSlug,
          sourceSlug: c.sourceSlug,
          chunkIndex: c.chunkIndex,
          claimsEmitted: r.claims.length,
          costUsdCents: r.costUsdCents,
          latencyMs: r.latencyMs,
          cacheReadInputTokens: r.usage.cacheReadInputTokens,
        })
      } else {
        summary.failed += 1
        perCard.failed += 1
        options.onChunkComplete?.({
          kind: "fail",
          cardSlug: c.cardSlug,
          sourceSlug: c.sourceSlug,
          chunkIndex: c.chunkIndex,
          reason: (result.reason as Error).message,
        })
      }
    }
  }

  return summary
}

async function loadChunksInScope(scope: RunScope): Promise<ChunkWithContext[]> {
  const conditions = []
  if (scope.cardSlugs && scope.cardSlugs.length > 0) {
    conditions.push(inArray(cards.slug, scope.cardSlugs))
  }
  if (scope.cardStatuses && scope.cardStatuses.length > 0) {
    conditions.push(inArray(cards.status, scope.cardStatuses))
  }

  let query = db
    .select({
      chunkId: sourceChunks.id,
      chunkIndex: sourceChunks.chunkIndex,
      text: sourceChunks.text,
      sourceId: sourceDocuments.id,
      sourceSlug: sourceDocuments.slug,
      sourceTitle: sourceDocuments.title,
      sourceType: sourceDocuments.sourceType,
      cardId: cards.id,
      cardSlug: cards.slug,
      cardNameEn: cards.cardNameEn,
      issuerNameEn: issuers.nameEn,
    })
    .from(sourceChunks)
    .innerJoin(sourceDocuments, eq(sourceChunks.sourceId, sourceDocuments.id))
    .innerJoin(cards, eq(sourceDocuments.cardId, cards.id))
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    .orderBy(asc(cards.slug), asc(sourceDocuments.slug), asc(sourceChunks.chunkIndex))
    .$dynamic()

  for (const cond of conditions) {
    query = query.where(cond)
  }

  const rows = await query
  const out: ChunkWithContext[] = rows.map((r) => ({
    ...r,
    inputHash: computeInputHash(r.sourceId, r.text),
  }))
  return scope.maxChunks !== undefined ? out.slice(0, scope.maxChunks) : out
}

async function loadSeenInputHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set()
  // 'pending' and 'failed' are intentionally excluded — re-running a stuck
  // pending or a previously-failed extraction is the recovery path. Only
  // 'succeeded' rows count as "already done, skip me".
  const rows = await db
    .select({ inputHash: extractionRuns.inputHash })
    .from(extractionRuns)
    .where(
      and(
        inArray(extractionRuns.inputHash, hashes),
        eq(extractionRuns.status, "succeeded"),
      ),
    )
  return new Set(rows.map((r) => r.inputHash))
}

async function runOne(
  c: ChunkWithContext,
  dryRun: boolean,
  extractFn: ExtractFn,
): Promise<ExtractResult> {
  return extractFn({
    cardId: c.cardId,
    cardSlug: c.cardSlug,
    cardNameEn: c.cardNameEn,
    issuerNameEn: c.issuerNameEn,
    sourceId: c.sourceId,
    sourceTitle: c.sourceTitle,
    sourceType: c.sourceType,
    chunkText: c.text,
    persist: !dryRun,
  })
}
