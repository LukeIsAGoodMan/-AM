import { notFound } from "next/navigation"
import Link from "next/link"
import { getReviewTaskDetail } from "@/lib/queries/review-task-detail"
import { PageHeader } from "@/components/ui/page-header"
import { Badge, StatusBadge, type BadgeTone } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ReviewTaskActions } from "./ReviewTaskActions"

export const dynamic = "force-dynamic"

const PRIORITY_TONE: Record<string, BadgeTone> = {
  blocker: "red",
  high: "red",
  normal: "blue",
  low: "gray",
}

function formatPayload(p: unknown): string {
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return String(p)
  }
}

function priorityLabel(p: number): string {
  // P1 = official PDF, etc. Compact label so the card header isn't noisy.
  const tags: Record<number, string> = {
    1: "P1 official PDF",
    2: "P2 official page",
    3: "P3 app screenshot",
    4: "P4 open API",
    5: "P5 competitor",
    6: "P6 forum",
    7: "P7 user submission",
    8: "P8 manual note",
  }
  return tags[p] ?? `P${p}`
}

export default async function ReviewTaskDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  const detail = await getReviewTaskDetail(taskId)
  if (!detail) notFound()

  const { task, card, group, claims } = detail
  const supporting = claims.filter((c) => c.isSupporting)
  const contradicting = claims.filter((c) => !c.isSupporting)

  return (
    <div className="pb-12">
      <PageHeader
        title={task.title}
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PRIORITY_TONE[task.priority] ?? "default"}>
              {task.priority}
            </Badge>
            <Badge tone="gray">{task.taskType}</Badge>
            <StatusBadge status={task.status} />
            <span className="text-xs">·</span>
            <Link
              href={`/cards/${card.slug}`}
              className="text-sm text-neutral-700 hover:underline"
            >
              {card.cardNameEn}
            </Link>
            <span className="text-xs text-neutral-500">
              ({card.issuerNameEn})
            </span>
            <span className="ml-auto">
              <Link
                href="/review"
                className="text-xs text-neutral-500 hover:text-neutral-700 hover:underline"
              >
                ← back to queue
              </Link>
            </span>
          </div>
        }
      />

      <div className="grid gap-4 px-6 pt-4 lg:grid-cols-3">
        {/* Left rail — group summary + action panel */}
        <div className="space-y-4">
          {group ? (
            <Card>
              <CardHeader>
                <CardTitle>Cross-check group</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Verdict
                  </div>
                  <StatusBadge status={group.status} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Claim type · key dimension
                  </div>
                  <div>
                    <Badge tone="gray">{group.claimType}</Badge>{" "}
                    <span className="font-mono text-xs text-neutral-700">
                      {group.keyDimension}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-neutral-500">Supporting</div>
                    <div className="text-base font-semibold text-emerald-700 tabular-nums">
                      {group.supportingClaimIds.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Contradicting</div>
                    <div
                      className={`text-base font-semibold tabular-nums ${
                        group.contradictingClaimIds.length > 0
                          ? "text-rose-700"
                          : "text-neutral-400"
                      }`}
                    >
                      {group.contradictingClaimIds.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Confidence</div>
                    <div className="text-base font-semibold text-neutral-800 tabular-nums">
                      {Number(group.aggregateConfidence).toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Canonical payload
                  </div>
                  <pre className="overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-xs text-neutral-800 ring-1 ring-neutral-200">
                    {formatPayload(group.canonicalPayload)}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <ReviewTaskActions
            taskId={task.id}
            taskStatus={task.status}
            groupStatus={group?.status ?? null}
            canonicalPayloadJson={formatPayload(group?.canonicalPayload ?? {})}
            hasGroup={!!group}
            resolutionNote={task.resolutionNote}
            resolvedAt={task.resolvedAt}
          />
        </div>

        {/* Right rail — supporting + contradicting claims */}
        <div className="space-y-4 lg:col-span-2">
          {task.description ? (
            <Card>
              <CardHeader>
                <CardTitle>Task description</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-700">
                  {task.description}
                </pre>
              </CardContent>
            </Card>
          ) : null}

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-800">
              Supporting claims ({supporting.length})
            </h2>
            <div className="space-y-3">
              {supporting.length === 0 ? (
                <p className="text-sm text-neutral-500">No supporting claims.</p>
              ) : (
                supporting.map((c) => <ClaimCard key={c.id} claim={c} kind="support" />)
              )}
            </div>
          </section>

          {contradicting.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-rose-800">
                Contradicting claims ({contradicting.length})
              </h2>
              <div className="space-y-3">
                {contradicting.map((c) => (
                  <ClaimCard key={c.id} claim={c} kind="contradict" />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ClaimCard({
  claim,
  kind,
}: {
  claim: import("@/lib/queries/review-task-detail").ReviewClaim
  kind: "support" | "contradict"
}) {
  const borderClass =
    kind === "support"
      ? "border-emerald-200 bg-emerald-50/30"
      : "border-rose-200 bg-rose-50/30"
  return (
    <Card className={borderClass}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={kind === "support" ? "green" : "red"}>
            {priorityLabel(claim.source.sourcePriority)}
          </Badge>
          {claim.source.url ? (
            <a
              href={claim.source.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-neutral-800 hover:underline"
            >
              {claim.source.title}
            </a>
          ) : (
            <span className="font-medium text-neutral-800">
              {claim.source.title}
            </span>
          )}
          <span className="text-neutral-400">·</span>
          <Link
            href={`/sources/${claim.source.slug}`}
            className="font-mono text-[11px] text-neutral-500 hover:underline"
          >
            {claim.source.slug}
          </Link>
          <span className="ml-auto text-neutral-500 tabular-nums">
            conf {Number(claim.confidenceScore).toFixed(2)} · {claim.extractedBy}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            Extracted snippet
          </div>
          <blockquote className="rounded border border-neutral-200 bg-white p-2 text-xs italic text-neutral-700">
            “{claim.extractedTextSnippet}”
          </blockquote>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            Structured payload
          </div>
          <pre className="overflow-x-auto rounded bg-white p-2 font-mono text-xs text-neutral-800 ring-1 ring-neutral-200">
            {JSON.stringify(claim.structuredPayload, null, 2)}
          </pre>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <StatusBadge status={claim.status} />
          {claim.reviewerNote ? (
            <span>· note: {claim.reviewerNote}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
