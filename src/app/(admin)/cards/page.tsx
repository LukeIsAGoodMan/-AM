import { listCards } from "@/lib/queries/cards"
import { PageHeader } from "@/components/ui/page-header"
import { CardsTable } from "./CardsTable"

export const dynamic = "force-dynamic" // hit the DB on every request in dev

export default async function CardsPage() {
  const rows = await listCards()
  const active = rows.filter((r) => r.status === "active").length
  const draft = rows.filter((r) => r.status === "draft").length

  return (
    <div>
      <PageHeader
        title="Cards"
        subtitle={
          <>
            <strong>{rows.length}</strong> total ·{" "}
            <strong>{active}</strong> active ·{" "}
            <strong>{draft}</strong> draft
          </>
        }
      />
      <CardsTable rows={rows} />
    </div>
  )
}
