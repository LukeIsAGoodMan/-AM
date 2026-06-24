import { db } from "@/db/client"
import { loadAll } from "@/lib/import/loader"
import { checkCrossRefs } from "@/lib/import/cross-refs"
import { sync } from "@/lib/import/syncer"

async function main() {
  const dataset = loadAll()

  const refErrors = checkCrossRefs(dataset)
  if (refErrors.length > 0) {
    console.error("Cross-reference errors — aborting import:")
    for (const e of refErrors) {
      console.error(`  ${e.path}: ${e.message}`)
    }
    process.exit(1)
  }

  const report = await sync(db, dataset)

  if (report.refusals.length > 0) {
    console.error("Import refused — these rules need a slug rename:")
    for (const r of report.refusals) {
      console.error(`  ${r.ruleSlug}`)
      console.error(`    fields: ${r.changedFields.join(", ")}`)
      console.error(`    ${r.message}`)
    }
    process.exit(1)
  }

  console.log("✓ import complete")
  console.log(
    `  rules:           inserted=${report.inserted}, updated=${report.updated}, unchanged=${report.unchanged}, archived=${report.archived}`,
  )
  console.log(
    `  welcome offers:  inserted=${report.welcomeOffers.inserted}, updated=${report.welcomeOffers.updated}, archived=${report.welcomeOffers.archived}`,
  )
  console.log(
    `  campaigns:       inserted=${report.campaigns.inserted}, updated=${report.campaigns.updated}, archived=${report.campaigns.archived}`,
  )
}

main()
  .catch((err) => {
    console.error("Import failed:", err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
