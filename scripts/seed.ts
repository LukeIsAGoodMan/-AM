import { db } from "@/db/client"
import { seed } from "@/db/seed"

async function main() {
  const ids = await seed(db)
  console.log("Seed complete:")
  console.log(ids)
}

main()
  .catch((err) => {
    console.error("Seed failed:", err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
