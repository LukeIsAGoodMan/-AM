"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db/client"
import {
  crossCheckGroups,
  reviewTasks,
  sourceClaims,
} from "@/db/schema/extraction"

// P6 — reviewer actions on a review_task.
//
// One server action with a discriminated input so the client doesn't need
// four separate "use server" entry points. The reviewer's intent maps to
// claim + group + task writes:
//
//   approve              — task -> resolved, supporting claims -> approved,
//                          contradicting claims -> rejected. Group status
//                          and canonical_payload stay as the aggregator
//                          left them; P7 (next milestone) will pick these
//                          up to materialize reward_rules.
//   reject               — task -> dismissed, ALL claims (supporting +
//                          contradicting) -> rejected. Means "none of
//                          these are right; don't make a rule".
//   mark_conflict        — group -> conflict (force), task stays open and
//                          is re-typed to conflict_resolution + high
//                          priority. Used when reviewer disagrees with
//                          the aggregator's agreed/single_source verdict.
//   edit_canonical       — overwrite group.canonical_payload with the
//                          provided JSON. Doesn't resolve the task —
//                          reviewer typically clicks Approve afterward.
//   reopen               — task -> open, claims revert to pending_review.
//                          Escape hatch for a misclick on approve/reject.
//
// All writes scope to the task's card_id; nothing here touches anything
// outside the requested task's blast radius.

export type ResolveAction =
  | { kind: "approve"; note?: string }
  | { kind: "reject"; note?: string }
  | { kind: "mark_conflict"; note?: string }
  | { kind: "edit_canonical"; canonicalPayloadJson: string; note?: string }
  | { kind: "reopen" }

export type ResolveResult =
  | { ok: true; message: string; affectedClaims: number }
  | { ok: false; error: string }

export async function resolveReviewTask(
  taskId: string,
  action: ResolveAction,
): Promise<ResolveResult> {
  try {
    const taskRows = await db
      .select({
        task: reviewTasks,
        group: crossCheckGroups,
      })
      .from(reviewTasks)
      .leftJoin(
        crossCheckGroups,
        eq(reviewTasks.subjectGroupId, crossCheckGroups.id),
      )
      .where(eq(reviewTasks.id, taskId))
      .limit(1)

    const head = taskRows[0]
    if (!head) return { ok: false, error: `Task ${taskId} not found` }
    const { task, group } = head

    // edit_canonical and mark_conflict both require a group — only P4-
    // created tasks have one. A manual claim_review (subjectClaimId only)
    // would need a different code path.
    if ((action.kind === "edit_canonical" || action.kind === "mark_conflict") && !group) {
      return {
        ok: false,
        error: `Action '${action.kind}' requires a cross_check_group; this task has none.`,
      }
    }

    const now = new Date()
    const supportingIds = group?.supportingClaimIds ?? []
    const contradictingIds = group?.contradictingClaimIds ?? []
    const allClaimIds = [...supportingIds, ...contradictingIds]

    let affected = 0
    let message = ""

    if (action.kind === "approve") {
      // Supporting claims become approved; contradicting (if any) get
      // rejected. We do these in two writes scoped by id IN (...). If
      // either array is empty, the IN clause matches nothing — no-op.
      if (supportingIds.length > 0) {
        const res = await db
          .update(sourceClaims)
          .set({
            status: "approved",
            reviewedAt: now,
            reviewerNote: action.note ?? null,
            updatedAt: now,
          })
          .where(inArray(sourceClaims.id, supportingIds))
          .returning({ id: sourceClaims.id })
        affected += res.length
      }
      if (contradictingIds.length > 0) {
        const res = await db
          .update(sourceClaims)
          .set({
            status: "rejected",
            reviewedAt: now,
            reviewerNote:
              action.note ??
              "Auto-rejected: contradicted the approved canonical reading.",
            updatedAt: now,
          })
          .where(inArray(sourceClaims.id, contradictingIds))
          .returning({ id: sourceClaims.id })
        affected += res.length
      }
      await db
        .update(reviewTasks)
        .set({
          status: "resolved",
          resolvedAt: now,
          resolutionNote: action.note ?? null,
          updatedAt: now,
        })
        .where(eq(reviewTasks.id, taskId))
      message = `Approved. ${supportingIds.length} claim(s) approved, ${contradictingIds.length} rejected.`
    } else if (action.kind === "reject") {
      if (allClaimIds.length > 0) {
        const res = await db
          .update(sourceClaims)
          .set({
            status: "rejected",
            reviewedAt: now,
            reviewerNote: action.note ?? null,
            updatedAt: now,
          })
          .where(inArray(sourceClaims.id, allClaimIds))
          .returning({ id: sourceClaims.id })
        affected = res.length
      }
      await db
        .update(reviewTasks)
        .set({
          status: "dismissed",
          resolvedAt: now,
          resolutionNote: action.note ?? null,
          updatedAt: now,
        })
        .where(eq(reviewTasks.id, taskId))
      message = `Rejected. ${affected} claim(s) marked rejected; task dismissed.`
    } else if (action.kind === "mark_conflict") {
      // group is guaranteed non-null by the early return above.
      await db
        .update(crossCheckGroups)
        .set({ status: "conflict", updatedAt: now })
        .where(eq(crossCheckGroups.id, group!.id))
      // Re-type the task — was probably cross_check_confirmation or
      // claim_review; reviewer says it's actually a conflict.
      await db
        .update(reviewTasks)
        .set({
          taskType: "conflict_resolution",
          priority: "high",
          resolutionNote: action.note ?? null,
          updatedAt: now,
        })
        .where(eq(reviewTasks.id, taskId))
      message = "Group marked as conflict; task stays open at high priority."
    } else if (action.kind === "edit_canonical") {
      let parsed: unknown
      try {
        parsed = JSON.parse(action.canonicalPayloadJson)
      } catch (err) {
        return {
          ok: false,
          error: `Invalid JSON in canonical payload: ${(err as Error).message}`,
        }
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          ok: false,
          error: "Canonical payload must be a JSON object (not array / scalar / null).",
        }
      }
      await db
        .update(crossCheckGroups)
        .set({
          canonicalPayload: parsed,
          updatedAt: now,
        })
        .where(eq(crossCheckGroups.id, group!.id))
      if (action.note) {
        await db
          .update(reviewTasks)
          .set({ resolutionNote: action.note, updatedAt: now })
          .where(eq(reviewTasks.id, taskId))
      }
      message = "Canonical payload updated."
    } else if (action.kind === "reopen") {
      if (allClaimIds.length > 0) {
        await db
          .update(sourceClaims)
          .set({
            status: "pending_review",
            reviewedAt: null,
            updatedAt: now,
          })
          // Only revert claims that look like THIS task's verdict — i.e.,
          // currently approved or rejected. Don't touch claims that have
          // moved on (superseded by a later aggregator run, etc.).
          .where(
            and(
              inArray(sourceClaims.id, allClaimIds),
              inArray(sourceClaims.status, ["approved", "rejected"]),
            ),
          )
      }
      await db
        .update(reviewTasks)
        .set({
          status: "open",
          resolvedAt: null,
          resolutionNote: null,
          updatedAt: now,
        })
        .where(eq(reviewTasks.id, taskId))
      message = `Reopened. Claims reverted to pending_review.`
    } else {
      // Exhaustiveness — TypeScript will catch a missed kind at compile
      // time, but a runtime fallback keeps the action honest.
      const _exhaustive: never = action
      return { ok: false, error: `Unknown action: ${String(_exhaustive)}` }
    }

    // Re-render both the queue and the detail page after any mutation.
    revalidatePath("/review")
    revalidatePath(`/review/${taskId}`)

    void task
    return { ok: true, message, affectedClaims: affected }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
