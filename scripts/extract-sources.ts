import { db } from "@/db/client"
import { runExtraction } from "@/lib/import/extract/runner"

async function main() {
  console.log("Running extraction on un-attempted sources…")
  const report = await runExtraction(db)

  console.log("")
  console.log(
    `Attempted: ${report.attempted}  succeeded: ${report.succeeded}  failed: ${report.failed}  chunks: ${report.totalChunks}`,
  )
  for (const d of report.details) {
    const tag = d.ok ? "✓" : "✗"
    if (d.ok) {
      console.log(
        `  ${tag} ${d.sourceSlug}  method=${d.method}  chunks=${d.chunkCount}  chars=${d.charCount}`,
      )
    } else {
      console.log(`  ${tag} ${d.sourceSlug}  method=${d.method ?? "n/a"}`)
      console.log(`     ${d.error}`)
    }
  }
}

main()
  .catch((err) => {
    console.error("Extraction failed:", err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
