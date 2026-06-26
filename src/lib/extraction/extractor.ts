import { createHash } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import {
  extractionRuns,
  sourceClaims,
  type NewSourceClaim,
} from "@/db/schema/extraction"
import { categories as categoriesTable, sourceDocuments } from "@/db/schema/catalog"
import {
  EXTRACTION_OUTPUT_JSON_SCHEMA,
  ExtractionOutput,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseStructuredPayload,
  type ExtractionOutput as ExtractionOutputT,
} from "./prompt"

// P2 — single-chunk extractor. Calls Opus 4.7 with adaptive thinking +
// structured output, validates against Zod, writes one extraction_runs row
// + N source_claims rows. P3's runner orchestrates many of these across
// chunks; P2 just nails the one-chunk path.
//
// Pricing (cached 2026 in skill docs): Opus 4.7 = $5/1M input, $25/1M
// output. Cache writes 1.25×, cache reads 0.1×. Per-chunk cost depends
// on chunk size + how much the model decides to think.

const MODEL_ID = "claude-opus-4-7" as const
const MAX_OUTPUT_TOKENS = 8000 // claims arrays are small; bound this for cost safety

// Per the skill: pricing snapshot (cached) — use to estimate cost into cents.
// Update if Anthropic changes pricing.
const PRICING = {
  inputPerMillion: 5.0,
  outputPerMillion: 25.0,
  // Cache write premium = 1.25× input; cache read = 0.1× input.
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
} as const

export type ExtractInput = {
  cardId: string // cards.id (uuid)
  cardSlug: string
  cardNameEn: string
  issuerNameEn: string
  sourceId: string // source_documents.id
  sourceTitle: string
  sourceType: string
  chunkText: string
  knownCategorySlugs?: string[] // override default lookup, mainly for tests
  // Optional: pre-existing Anthropic client (tests inject a mock-ish one;
  // production calls create a real one from ANTHROPIC_API_KEY).
  client?: Anthropic
  // If true, do NOT write to extraction_runs / source_claims. Useful for
  // dry-runs that just want to see what would be emitted.
  persist?: boolean
}

export type ExtractResult = {
  runId: string | null // null if persist=false
  claims: ExtractionOutputT["claims"]
  rationale: string | undefined
  costUsdCents: number
  latencyMs: number
  // Raw usage for debugging / cost audits.
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens: number
    cacheReadInputTokens: number
  }
}

export async function extractClaimsFromChunk(
  input: ExtractInput,
): Promise<ExtractResult> {
  const persist = input.persist !== false
  const client = input.client ?? new Anthropic()

  const knownCategorySlugs =
    input.knownCategorySlugs ?? (await loadCategorySlugs())

  const userMessage = buildUserMessage({
    cardSlug: input.cardSlug,
    cardNameEn: input.cardNameEn,
    issuerNameEn: input.issuerNameEn,
    sourceTitle: input.sourceTitle,
    sourceType: input.sourceType,
    chunkText: input.chunkText,
    knownCategorySlugs,
  })

  // input_hash dedups identical (prompt_version, source, chunk) re-runs at
  // the application level — DB doesn't enforce.
  const inputHash = computeInputHash(input.sourceId, input.chunkText)

  // Pre-insert the run row so we have an id even if the API call fails.
  let runId: string | null = null
  if (persist) {
    const [row] = await db
      .insert(extractionRuns)
      .values({
        sourceId: input.sourceId,
        modelId: MODEL_ID,
        promptVersion: PROMPT_VERSION,
        inputHash,
        status: "pending",
      })
      .returning({ id: extractionRuns.id })
    runId = row?.id ?? null
  }

  const startedAt = Date.now()
  let response: Anthropic.Messages.Message
  try {
    response = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Adaptive thinking is the recommended on-mode for Opus 4.7. The
      // model auto-decides depth; effort controls overall token spend.
      // Medium is the sweet spot for moderate-complexity extraction.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: EXTRACTION_OUTPUT_JSON_SCHEMA,
        },
      },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // Cache: prefix is tools (none) + system. The skill says marker on
          // the last system block caches tools+system. Per-chunk user message
          // is the only varying part, after the breakpoint.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    })
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    if (persist && runId) {
      await db
        .update(extractionRuns)
        .set({
          status: "failed",
          errorMessage: (err as Error).message,
          finishedAt: new Date(),
          latencyMs,
        })
        .where(eq(extractionRuns.id, runId))
    }
    throw err
  }
  const latencyMs = Date.now() - startedAt

  // Per the skill, response.content is a discriminated union — narrow by .type
  // before accessing .text. Structured-output mode puts the JSON in the first
  // text block.
  const textBlock = response.content.find(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text",
  )
  if (!textBlock) {
    if (persist && runId) {
      await db
        .update(extractionRuns)
        .set({
          status: "failed",
          errorMessage: "no text block in response",
          finishedAt: new Date(),
          latencyMs,
        })
        .where(eq(extractionRuns.id, runId))
    }
    throw new Error("extractor: no text block in response")
  }

  let parsed: ExtractionOutputT
  try {
    const json: unknown = JSON.parse(textBlock.text)
    parsed = ExtractionOutput.parse(json)
  } catch (err) {
    if (persist && runId) {
      await db
        .update(extractionRuns)
        .set({
          status: "failed",
          errorMessage: `output validation failed: ${(err as Error).message}`,
          finishedAt: new Date(),
          latencyMs,
        })
        .where(eq(extractionRuns.id, runId))
    }
    throw err
  }

  const cost = computeCostUsdCents(response.usage)

  if (persist && runId) {
    await db
      .update(extractionRuns)
      .set({
        status: "succeeded",
        claimsEmitted: parsed.claims.length,
        costUsdCents: cost,
        latencyMs,
        finishedAt: new Date(),
      })
      .where(eq(extractionRuns.id, runId))

    if (parsed.claims.length > 0) {
      // Parse the JSON-string payloads here (not in P3 / P4) so a malformed
      // payload fails the run loudly rather than persisting garbage. If any
      // claim's payload doesn't parse, mark the run failed and don't write
      // any of the claims — partial writes would confuse the aggregator.
      const rows: NewSourceClaim[] = []
      for (const c of parsed.claims) {
        let payload: Record<string, unknown>
        try {
          payload = parseStructuredPayload(c)
        } catch (err) {
          await db
            .update(extractionRuns)
            .set({
              status: "failed",
              errorMessage: `claim payload not valid JSON: ${(err as Error).message}`,
              finishedAt: new Date(),
              latencyMs,
            })
            .where(eq(extractionRuns.id, runId))
          throw err
        }
        rows.push({
          sourceId: input.sourceId,
          cardId: input.cardId,
          claimType: c.claimType,
          structuredPayload: payload,
          extractedTextSnippet: c.extractedTextSnippet,
          extractionRunId: runId,
          extractedBy: MODEL_ID,
          confidenceScore: c.confidenceScore.toFixed(3),
          status: "pending_review", // P4 aggregator picks these up
        })
      }
      await db.insert(sourceClaims).values(rows)
    }
  }

  return {
    runId,
    claims: parsed.claims,
    rationale: parsed.rationale,
    costUsdCents: cost,
    latencyMs,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  }
}

// Same hash the extractor records on extraction_runs.input_hash. Exported
// so the P3 runner can pre-query "which chunks have I already extracted?"
// without duplicating the formula.
export function computeInputHash(sourceId: string, chunkText: string): string {
  return createHash("sha256")
    .update(PROMPT_VERSION)
    .update("\n")
    .update(sourceId)
    .update("\n")
    .update(chunkText)
    .digest("hex")
}

async function loadCategorySlugs(): Promise<string[]> {
  const rows = await db.select({ slug: categoriesTable.slug }).from(categoriesTable)
  return rows.map((r) => r.slug)
}

function computeCostUsdCents(usage: Anthropic.Messages.Usage): number {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  // Per the skill: input_tokens is uncached input only — total = input +
  // cache_creation + cache_read.
  const uncachedInputUsd =
    (usage.input_tokens / 1_000_000) * PRICING.inputPerMillion
  const cacheWriteUsd =
    (cacheCreation / 1_000_000) * PRICING.inputPerMillion * PRICING.cacheWriteMultiplier
  const cacheReadUsd =
    (cacheRead / 1_000_000) * PRICING.inputPerMillion * PRICING.cacheReadMultiplier
  const outputUsd =
    (usage.output_tokens / 1_000_000) * PRICING.outputPerMillion
  return Math.round(
    (uncachedInputUsd + cacheWriteUsd + cacheReadUsd + outputUsd) * 100,
  )
}

// Convenience: look up source + card metadata for the extractor. P3 runner
// will load chunks in bulk; this single-row variant is for the dry-run.
export async function lookupSourceMeta(sourceSlug: string): Promise<{
  sourceId: string
  cardId: string | null
  sourceTitle: string
  sourceType: string
  extractedText: string | null
} | null> {
  const rows = await db
    .select({
      sourceId: sourceDocuments.id,
      cardId: sourceDocuments.cardId,
      sourceTitle: sourceDocuments.title,
      sourceType: sourceDocuments.sourceType,
      extractedText: sourceDocuments.extractedText,
    })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.slug, sourceSlug))
  return rows[0] ?? null
}
