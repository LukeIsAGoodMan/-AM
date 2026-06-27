import { listReviewTasks, summarizeQueue } from "@/lib/queries/review-tasks"
import { PageHeader } from "@/components/ui/page-header"
import { ReviewQueueTable } from "./ReviewQueueTable"

export const dynamic = "force-dynamic"

export default async function ReviewPage() {
  const rows = await listReviewTasks()
  const summary = summarizeQueue(rows)

  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle={
          <>
            <strong>{summary.totalOpen}</strong> open ·{" "}
            <span className="text-rose-700">
              <strong>{summary.openConflicts}</strong> conflicts
            </span>{" "}
            · <strong>{summary.openSingleSource}</strong> single-source ·{" "}
            <strong>{summary.openAgreed}</strong> agreed-to-confirm ·{" "}
            {summary.inProgress} in progress · {summary.resolved} resolved ·{" "}
            {summary.dismissed} dismissed
          </>
        }
      />
      <ReviewQueueTable rows={rows} />
    </div>
  )
}
