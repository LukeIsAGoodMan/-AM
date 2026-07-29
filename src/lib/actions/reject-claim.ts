"use server"

import { isEditUnlocked, EDIT_LOCKED_ERROR } from "@/lib/auth/edit-gate"

import { revalidatePath } from "next/cache"
import { rejectClaim, type RejectClaimResult } from "@/lib/extraction/reject-claim"

// P18 (§3C) — reviewer rejects a single source claim (e.g. the mrmiles Blue
// Cash insurance claim). Thin "use server" wrapper over the reusable core so
// the /review UI can call it; the canary CLI + tests call the core directly.
export async function rejectClaimAction(input: {
  claimId: string
  reason: string
  reviewerEmail: string
}): Promise<RejectClaimResult> {
  if (!(await isEditUnlocked())) {
    return {
      ok: false,
      claimId: input.claimId,
      error: EDIT_LOCKED_ERROR,
      tasksDismissed: 0,
    }
  }
  const result = await rejectClaim(input)
  if (result.ok) {
    revalidatePath("/review")
    revalidatePath(`/review`)
  }
  return result
}
