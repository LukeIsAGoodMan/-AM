// Annual-fee writer (§3E). Consumes the pure classify + policy module and
// applies it: updates cards.annual_fee_hkd + annual_fee_publish_authority
// (provisionally, never silently 'auto'), preserves conflicting outliers, and
// creates a review task. Called from the materializer's dispatch for an
// annual_fee cross-check group.

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, sourceDocuments } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  reviewTasks,
  sourceClaims,
} from "@/db/schema/extraction"
import { normalizeNumeric } from "@/lib/normalize"
import {
  classifyAnnualFee,
  evaluateAnnualFeePublication,
  type AnnualFeeClaimInput,
} from "@/lib/extraction/annual-fee-classify"

const OFFICIAL_PRIORITIES: ReadonlySet<number> = new Set([1, 2, 4])

export interface AnnualFeeWriteResult {
  cardId: string
  updated: boolean
  oldValueHkd: number | null
  newValueHkd: number | null
  authority: string
  reason: string
  chosenClaimId: string | null
  retainedConflictClaimIds: string[]
  waiverClaimIds: string[]
}

type LoadedGroup = typeof crossCheckGroups.$inferSelect

// Guarded review-task creation: don't spam the queue on idempotent re-runs.
async function ensureReviewTask(args: {
  cardId: string
  groupId: string
  title: string
  description: string
  priority: "normal" | "high"
}): Promise<void> {
  const existing = (
    await db
      .select({ id: reviewTasks.id })
      .from(reviewTasks)
      .where(
        and(
          eq(reviewTasks.subjectGroupId, args.groupId),
          eq(reviewTasks.taskType, "annual_fee_authority"),
          inArray(reviewTasks.status, ["open", "in_progress"]),
        ),
      )
      .limit(1)
  )[0]
  if (existing) return
  await db.insert(reviewTasks).values({
    taskType: "annual_fee_authority",
    priority: args.priority,
    cardId: args.cardId,
    subjectGroupId: args.groupId,
    title: args.title,
    description: args.description,
  })
}

export async function writeAnnualFee(
  group: LoadedGroup,
  opts: { dryRun?: boolean } = {},
): Promise<AnnualFeeWriteResult> {
  // Load EVERY active annual_fee claim for the card (supporting AND
  // contradicting) — the §3E policy classifies each and preserves outliers,
  // so we can't restrict to the group's supporting set.
  const rows = await db
    .select({
      id: sourceClaims.id,
      sourceId: sourceClaims.sourceId,
      payload: sourceClaims.structuredPayload,
      snippet: sourceClaims.extractedTextSnippet,
      priority: sourceDocuments.sourcePriority,
    })
    .from(sourceClaims)
    .innerJoin(sourceDocuments, eq(sourceClaims.sourceId, sourceDocuments.id))
    .where(
      and(
        eq(sourceClaims.cardId, group.cardId),
        eq(sourceClaims.claimType, "annual_fee"),
        inArray(sourceClaims.status, ["pending_review", "approved"]),
      ),
    )

  const claims: AnnualFeeClaimInput[] = rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    return {
      claimId: r.id,
      sourceId: r.sourceId,
      amountHkd: normalizeNumeric(payload["amountHkd"]),
      isOfficial: OFFICIAL_PRIORITIES.has(r.priority),
      sourcePriority: r.priority,
      classification: classifyAnnualFee(payload, r.snippet),
    }
  })

  const card = (
    await db
      .select({ annualFeeHkd: cards.annualFeeHkd, authority: cards.annualFeePublishAuthority })
      .from(cards)
      .where(eq(cards.id, group.cardId))
      .limit(1)
  )[0]
  const oldValueHkd = card ? normalizeNumeric(card.annualFeeHkd) : null

  const decision = evaluateAnnualFeePublication(claims)

  const result: AnnualFeeWriteResult = {
    cardId: group.cardId,
    updated: false,
    oldValueHkd,
    newValueHkd: decision.newValueHkd,
    authority: decision.updateCard
      ? (decision.publishAuthority as string)
      : (card?.authority ?? "legacy_unverified"),
    reason: decision.reviewReason,
    chosenClaimId: decision.chosenClaimId,
    retainedConflictClaimIds: decision.retainedConflictClaimIds,
    waiverClaimIds: decision.waiverClaimIds,
  }

  if (opts.dryRun) return result

  if (decision.updateCard && decision.newValueHkd != null) {
    await db
      .update(cards)
      .set({
        annualFeeHkd: decision.newValueHkd.toFixed(2),
        annualFeePublishAuthority: decision.publishAuthority!,
        updatedAt: new Date(),
      })
      .where(eq(cards.id, group.cardId))
    result.updated = true
  }

  // Always create a review task — §3E requires human confirmation on every
  // publication path (and on the "no authority, unchanged" path too).
  await ensureReviewTask({
    cardId: group.cardId,
    groupId: group.id,
    priority: decision.outcome === "official_conflict" ? "high" : "normal",
    title:
      decision.outcome === "insufficient"
        ? "Annual fee: no authoritative evidence — review"
        : `Annual fee: confirm provisional HK$${decision.newValueHkd} (${decision.outcome})`,
    description:
      `${decision.reviewReason}. Old value: ${oldValueHkd ?? "(none)"}. ` +
      (decision.retainedConflictClaimIds.length > 0
        ? `Retained conflicting claim(s): ${decision.retainedConflictClaimIds.join(", ")}. `
        : "") +
      (decision.waiverClaimIds.length > 0
        ? `Waiver/first-year claim(s): ${decision.waiverClaimIds.join(", ")}.`
        : ""),
  })

  return result
}
