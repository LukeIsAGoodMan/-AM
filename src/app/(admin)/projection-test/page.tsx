import { PageHeader } from "@/components/ui/page-header"
import { loadProjectionTestData } from "@/lib/queries/projection-test"
import { ProjectionTestClient } from "./ProjectionTestClient"

export const dynamic = "force-dynamic"

export default async function ProjectionTestPage() {
  const data = await loadProjectionTestData()
  const withWelcome = data.cards.filter((c) => c.welcomeOffers.length > 0).length

  return (
    <div>
      <PageHeader
        title="Projection test"
        subtitle={
          <>
            <strong>{data.cards.length}</strong> active cards ·{" "}
            <strong>{withWelcome}</strong> with priced welcome offer ·{" "}
            naive sim per PRD §13
          </>
        }
      />
      <ProjectionTestClient data={data} />
    </div>
  )
}
