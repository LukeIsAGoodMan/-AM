// scripts/reject-claim.ts — reviewer rejects a single source claim (§3C).
// Used in the canary to reject the mrmiles Blue Cash insurance claim.
//
//   pnpm tsx --env-file=.env.local scripts/reject-claim.ts \
//     --claim-id <uuid> --reason "..." --reviewer-email pm@askmike.hk

import { rejectClaim } from "@/lib/extraction/reject-claim"

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

async function main() {
  const claimId = arg("--claim-id")
  const reason = arg("--reason")
  const reviewerEmail = arg("--reviewer-email")
  if (!claimId || !reason || !reviewerEmail) {
    console.error(
      "usage: reject-claim.ts --claim-id <uuid> --reason <text> --reviewer-email <email>",
    )
    process.exit(1)
  }
  const res = await rejectClaim({ claimId, reason, reviewerEmail })
  console.log(JSON.stringify(res, null, 2))
  process.exit(res.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
