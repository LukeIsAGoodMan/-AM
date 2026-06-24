import { listSources } from "@/lib/queries/sources"
import { PageHeader } from "@/components/ui/page-header"
import { SourcesTable } from "./SourcesTable"

export const dynamic = "force-dynamic"

export default async function SourcesPage() {
  const rows = await listSources()
  const extracted = rows.filter(
    (r) => r.extractedChars > 0 && !r.extractionFailed,
  ).length
  const failed = rows.filter((r) => r.extractionFailed).length
  const pending = rows.length - extracted - failed

  return (
    <div>
      <PageHeader
        title="Source documents"
        subtitle={
          <>
            <strong>{rows.length}</strong> total · <strong>{extracted}</strong>{" "}
            extracted · {failed} failed · {pending} not attempted
          </>
        }
      />
      <SourcesTable rows={rows} />
    </div>
  )
}
