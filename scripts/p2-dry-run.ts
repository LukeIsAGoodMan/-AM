// P2 dry-run — extract claims from the first source_chunk of HSBC Red's
// official page. Demonstrates the full pipeline end-to-end:
//
//   chunk → Opus 4.7 (adaptive thinking + structured output) → Zod-parse
//        → write extraction_runs (with cost/latency) → write source_claims
//
// Run with:  pnpm tsx --env-file=.env.local scripts/p2-dry-run.ts
//
// Requires ANTHROPIC_API_KEY in .env.local. Costs ~$0.03–0.08 per run
// depending on chunk size + how much thinking the model decides to do.
//
// To re-run without burning more API quota, pass --no-persist to skip the
// extraction_runs / source_claims writes (still calls the API).

import { eq, asc, and, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, issuers, sourceChunks } from "@/db/schema/catalog"
import { extractionRuns, sourceClaims } from "@/db/schema/extraction"
import {
  extractClaimsFromChunk,
  lookupSourceMeta,
} from "@/lib/extraction/extractor"

const SOURCE_SLUG = "hsbc-red-official-page"
const CARD_SLUG = "hsbc-red"

async function main() {
  const persist = !process.argv.includes("--no-persist")

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY missing from environment. Add it to .env.local first.",
    )
    process.exit(1)
  }

  const source = await lookupSourceMeta(SOURCE_SLUG)
  if (!source) {
    console.error(`Source '${SOURCE_SLUG}' not found.`)
    process.exit(1)
  }
  if (!source.cardId) {
    console.error(`Source '${SOURCE_SLUG}' has no card_id.`)
    process.exit(1)
  }

  const card = (
    await db
      .select({
        id: cards.id,
        slug: cards.slug,
        cardNameEn: cards.cardNameEn,
        issuerNameEn: issuers.nameEn,
      })
      .from(cards)
      .innerJoin(issuers, eq(cards.issuerId, issuers.id))
      .where(eq(cards.slug, CARD_SLUG))
  )[0]
  if (!card) {
    console.error(`Card '${CARD_SLUG}' not found.`)
    process.exit(1)
  }

  // Pick the first chunk. P3's runner will iterate every chunk.
  const chunks = await db
    .select({
      id: sourceChunks.id,
      chunkIndex: sourceChunks.chunkIndex,
      text: sourceChunks.text,
    })
    .from(sourceChunks)
    .where(eq(sourceChunks.sourceId, source.sourceId))
    .orderBy(asc(sourceChunks.chunkIndex))
    .limit(1)

  const chunk = chunks[0]
  if (!chunk) {
    console.error(
      `No chunks for source '${SOURCE_SLUG}'. Run \`pnpm extract:sources\` first.`,
    )
    process.exit(1)
  }

  console.log("─".repeat(80))
  console.log(`▸ Extracting from ${SOURCE_SLUG} chunk #${chunk.chunkIndex}`)
  console.log(`  Card:      ${card.issuerNameEn} — ${card.cardNameEn}`)
  console.log(`  Chunk:     ${chunk.text.length} chars`)
  console.log(`  Persist:   ${persist}`)
  console.log("─".repeat(80))
  console.log(chunk.text.slice(0, 400) + (chunk.text.length > 400 ? "…" : ""))
  console.log("─".repeat(80))

  const result = await extractClaimsFromChunk({
    cardId: card.id,
    cardSlug: card.slug,
    cardNameEn: card.cardNameEn,
    issuerNameEn: card.issuerNameEn,
    sourceId: source.sourceId,
    sourceTitle: source.sourceTitle,
    sourceType: source.sourceType,
    chunkText: chunk.text,
    persist,
  })

  console.log("")
  console.log(`✓ Extracted ${result.claims.length} claim(s)`)
  console.log(`  Cost:      $${(result.costUsdCents / 100).toFixed(4)} USD`)
  console.log(`  Latency:   ${result.latencyMs}ms`)
  console.log(
    `  Usage:     input=${result.usage.inputTokens}  output=${result.usage.outputTokens}  cache_write=${result.usage.cacheCreationInputTokens}  cache_read=${result.usage.cacheReadInputTokens}`,
  )
  if (result.runId) console.log(`  Run id:    ${result.runId}`)
  if (result.rationale) console.log(`  Rationale: ${result.rationale}`)
  console.log("")

  for (let i = 0; i < result.claims.length; i++) {
    const c = result.claims[i]!
    console.log(`── claim ${i + 1} ──`)
    console.log(`  type:        ${c.claimType}`)
    console.log(`  confidence:  ${c.confidenceScore.toFixed(2)}`)
    console.log(`  snippet:     "${c.extractedTextSnippet.slice(0, 120)}${c.extractedTextSnippet.length > 120 ? "…" : ""}"`)
    console.log(`  payload:     ${JSON.stringify(c.structuredPayload)}`)
    if (c.note) console.log(`  note:        ${c.note}`)
    console.log("")
  }

  if (persist) {
    console.log(`Recorded in DB. To clean up:`)
    console.log(
      `  docker compose exec -T postgres psql -U am -d am -c "DELETE FROM source_claims WHERE extraction_run_id IN (SELECT id FROM extraction_runs WHERE prompt_version='p2-v1' AND model_id='claude-opus-4-7'); DELETE FROM extraction_runs WHERE prompt_version='p2-v1' AND model_id='claude-opus-4-7';"`,
    )
  }

  // Suppress the "drizzle keeps the pool alive" hang.
  setTimeout(() => process.exit(0), 100)
}

main().catch((err) => {
  console.error("dry-run failed:", err)
  process.exit(1)
})

// Silence unused-import warnings for the cleanup helpers above.
void extractionRuns
void sourceClaims
void and
void inArray
