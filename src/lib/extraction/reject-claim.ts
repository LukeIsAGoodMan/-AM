// reject_claim (§3C) — reject a single source claim through normal review,
// storing a reason + reviewer email while preserving the claim's provenance.
//
// The canary case: mrmiles Blue Cash insurance claim `6db31629`. The
// inferred-category gate blocks it from auto-materializing and files a review
// task; a reviewer then rejects the claim here. The claim row stays (rejected
// provenance), so /review still shows why insurance is NOT a 1.2% category
// rate — the 1.2% base already covers it.
//
// Core DB logic lives here (no next/cache) so the canary CLI, tests, and the
// "use server" action wrapper can all call it.

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { reviewTasks, sourceClaims } from "@/db/schema/extraction"

export interface RejectClaimResult {
  ok: boolean
  claimId: string
  error?: string
  tasksDismissed: number
}

export async function rejectClaim(args: {
  claimId: string
  reason: string
  reviewerEmail: string
}): Promise<RejectClaimResult> {
  const reason = args.reason.trim()
  const reviewerEmail = args.reviewerEmail.trim()
  if (!reason) {
    return { ok: false, claimId: args.claimId, error: "reason is required", tasksDismissed: 0 }
  }
  if (!reviewerEmail) {
    return {
      ok: false,
      claimId: args.claimId,
      error: "reviewer email is required",
      tasksDismissed: 0,
    }
  }

  const claim = (
    await db
      .select({ id: sourceClaims.id, status: sourceClaims.status })
      .from(sourceClaims)
      .where(eq(sourceClaims.id, args.claimId))
      .limit(1)
  )[0]
  if (!claim) {
    return { ok: false, claimId: args.claimId, error: "claim not found", tasksDismissed: 0 }
  }

  const now = new Date()
  await db
    .update(sourceClaims)
    .set({
      status: "rejected",
      reviewerNote: reason,
      reviewerEmail,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(sourceClaims.id, args.claimId))

  // Dismiss any open review task that subjects this claim, recording who did
  // it. Group-subject tasks (e.g. the gate's inferred_category_review) are
  // left for the reviewer to close explicitly once satisfied.
  const dismissed = await db
    .update(reviewTasks)
    .set({
      status: "dismissed",
      reviewerEmail,
      resolvedAt: now,
      resolutionNote: `Claim rejected: ${reason}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(reviewTasks.subjectClaimId, args.claimId),
        inArray(reviewTasks.status, ["open", "in_progress"]),
      ),
    )
    .returning({ id: reviewTasks.id })

  return { ok: true, claimId: args.claimId, tasksDismissed: dismissed.length }
}
