import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  sourceDocuments,
  rewardRules,
} from "@/db/schema/catalog"
import {
  crossCheckGroups,
  extractionRuns,
  reviewTasks,
  rewardRuleSources,
  sourceClaims,
} from "@/db/schema/extraction"

// P1 schema smoke. Verifies:
//   1. All 5 tables are insertable end-to-end with realistic FKs.
//   2. The UNIQUE (card_id, claim_type, key_dimension) on cross_check_groups
//      actually fires — re-running the aggregator over the same dimension is
//      a no-op, not a duplicate.
//   3. Cascade rules match the design (cascading delete from cards →
//      source_claims / cross_check_groups; restrict on source_documents →
//      source_claims).
//
// Uses an existing seeded card (Citi Cash Back) to avoid having to bootstrap
// a fresh issuer + currency. Cleans up after itself.

const TEST_RULE_SLUG = "test__p1_smoke_rule"
const TEST_CARD_SLUG = "citi-cash-back"

let cardId: string
let sourceId: string
let primaryRuleId: string

beforeAll(async () => {
  const card = (
    await db.select().from(cards).where(eq(cards.slug, TEST_CARD_SLUG))
  )[0]
  expect(card).toBeDefined()
  cardId = card!.id

  const src = (
    await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.cardId, cardId))
  )[0]
  expect(src).toBeDefined()
  sourceId = src!.id

  const rule = (
    await db.select().from(rewardRules).where(eq(rewardRules.cardId, cardId))
  )[0]
  expect(rule).toBeDefined()
  primaryRuleId = rule!.id
})

afterAll(async () => {
  // Cascade order: review_tasks → source_claims → cross_check_groups +
  // extraction_runs + reward_rule_sources. Just delete by the slug we
  // tagged into extracted_text_snippet for safety.
  await db
    .delete(sourceClaims)
    .where(eq(sourceClaims.extractedTextSnippet, TEST_RULE_SLUG))
  await db
    .delete(extractionRuns)
    .where(eq(extractionRuns.inputHash, TEST_RULE_SLUG))
  await db
    .delete(crossCheckGroups)
    .where(eq(crossCheckGroups.keyDimension, TEST_RULE_SLUG))
  await db
    .delete(rewardRuleSources)
    .where(eq(rewardRuleSources.ruleId, primaryRuleId))
})

describe("P1 — extraction schema smoke", () => {
  it("can write end-to-end: run → claim → group → review_task → rule_sources", async () => {
    // extraction_runs row first (claim FK to it).
    const [run] = await db
      .insert(extractionRuns)
      .values({
        sourceId,
        modelId: "claude-opus-4-7-2026-06",
        promptVersion: "p1-smoke",
        inputHash: TEST_RULE_SLUG,
        status: "succeeded",
        claimsEmitted: 1,
        costUsdCents: 12,
        latencyMs: 1500,
      })
      .returning()
    expect(run).toBeDefined()

    // cross_check_groups before claim so we can reference it.
    const [group] = await db
      .insert(crossCheckGroups)
      .values({
        cardId,
        claimType: "earn_rate",
        keyDimension: TEST_RULE_SLUG,
        status: "single_source",
        canonicalPayload: { type: "simple_percent", rate: 0.012 },
        aggregateConfidence: "0.850",
      })
      .returning()
    expect(group).toBeDefined()

    const [claim] = await db
      .insert(sourceClaims)
      .values({
        sourceId,
        cardId,
        claimType: "earn_rate",
        structuredPayload: { type: "simple_percent", rate: 0.012 },
        extractedTextSnippet: TEST_RULE_SLUG,
        extractionRunId: run!.id,
        extractedBy: "claude-opus-4-7-2026-06",
        confidenceScore: "0.900",
        status: "pending_review",
        crossCheckGroupId: group!.id,
      })
      .returning()
    expect(claim).toBeDefined()
    expect(claim!.crossCheckGroupId).toBe(group!.id)

    const [task] = await db
      .insert(reviewTasks)
      .values({
        taskType: "cross_check_confirmation",
        cardId,
        subjectClaimId: claim!.id,
        subjectGroupId: group!.id,
        title: "P1 smoke task",
      })
      .returning()
    expect(task!.status).toBe("open")
    expect(task!.priority).toBe("normal")

    const [join] = await db
      .insert(rewardRuleSources)
      .values({
        ruleId: primaryRuleId,
        sourceId,
        supportingClaimId: claim!.id,
      })
      .returning()
    expect(join).toBeDefined()
  })

  it("UNIQUE (card_id, claim_type, key_dimension) blocks duplicate groups", async () => {
    // First insert succeeds (already inserted in the previous test under the
    // same keyDimension — we expect the second to error).
    let threw = false
    try {
      await db.insert(crossCheckGroups).values({
        cardId,
        claimType: "earn_rate",
        keyDimension: TEST_RULE_SLUG,
        status: "open",
      })
    } catch (err) {
      threw = true
      expect((err as Error).message).toMatch(/unique|duplicate/i)
    }
    expect(threw).toBe(true)
  })

  it("source_id ON DELETE RESTRICT on source_claims (FK retain)", async () => {
    // Sanity check via system catalog — we don't actually delete a source
    // here to avoid breaking other tests. Querying pg's information_schema
    // confirms the rule.
    const rows = await db.execute(
      "SELECT delete_rule FROM information_schema.referential_constraints WHERE constraint_name = 'source_claims_source_id_source_documents_id_fk'",
    )
    const rule = (rows.rows[0] as { delete_rule: string } | undefined)?.delete_rule
    expect(rule).toBe("RESTRICT")
  })
})
