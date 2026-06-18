import { loadAll } from "@/lib/import/loader"
import { checkCrossRefs } from "@/lib/import/cross-refs"

function main() {
  const dataset = loadAll()
  const refErrors = checkCrossRefs(dataset)

  if (refErrors.length > 0) {
    console.error("Cross-reference errors:")
    for (const e of refErrors) {
      console.error(`  ${e.path}: ${e.message}`)
    }
    process.exit(1)
  }

  console.log("✓ data/ is valid")
  console.log(
    `  issuers=${dataset.issuers.length}, currencies=${dataset.currencies.length}, categories=${dataset.categories.length}, cardFiles=${dataset.cardFiles.length}`,
  )
  for (const { path, data } of dataset.cardFiles) {
    console.log(
      `  ${path}: ${data.sources.length} sources, ${data.rules.length} rules`,
    )
  }
}

try {
  main()
  process.exit(0)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
