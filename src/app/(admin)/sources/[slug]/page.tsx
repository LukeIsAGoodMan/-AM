import Link from "next/link"
import { notFound } from "next/navigation"
import { getSourceDetail } from "@/lib/queries/sources"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge, StatusBadge } from "@/components/ui/badge"

export const dynamic = "force-dynamic"

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const detail = await getSourceDetail(slug)
  if (!detail) notFound()

  const { source, issuer, card, chunks, citingRules } = detail
  const text = source.extractedText ?? ""
  const charCount = text.length

  return (
    <div className="pb-12">
      <PageHeader
        title={source.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={source.status} />
            <Badge tone="blue">{source.sourceType}</Badge>
            <Badge tone="gray">priority {source.sourcePriority}</Badge>
            <Badge tone="gray">{source.language}</Badge>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-500">
              {issuer?.nameEn ?? "—"}
              {card ? (
                <>
                  {" · "}
                  <Link
                    href={`/cards/${card.slug}`}
                    className="text-neutral-600 hover:underline"
                  >
                    {card.cardNameEn}
                  </Link>
                </>
              ) : null}
            </span>
            <span className="text-neutral-500">·</span>
            <span className="font-mono text-xs text-neutral-500">{source.slug}</span>
          </span>
        }
        actions={
          source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              Open source ↗
            </a>
          ) : null
        }
      />

      <div className="grid gap-4 px-6 pt-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-neutral-100 text-sm">
              {[
                ["URL", source.url ?? "—"],
                ["Storage path", source.storagePath ?? "—"],
                ["Status", source.status],
                [
                  "Retrieved at",
                  source.retrievedAt
                    ? new Date(source.retrievedAt).toISOString().replace("T", " ").slice(0, 19)
                    : "—",
                ],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-2 py-1.5">
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="col-span-2 truncate text-neutral-900">{v}</dd>
                </div>
              ))}
            </dl>
            {source.notes ? (
              <>
                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Notes
                </h4>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">
                  {source.notes}
                </pre>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Extraction</CardTitle>
          </CardHeader>
          <CardContent>
            {source.extractionFailed ? (
              <>
                <Badge tone="red">extraction failed</Badge>
                <div className="mt-2 text-sm text-neutral-500">
                  Method:{" "}
                  <span className="font-mono">{source.extractionMethod ?? "n/a"}</span>
                </div>
                {source.extractionError ? (
                  <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                    {source.extractionError}
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-neutral-500">
                  Re-attempt by setting <code>extraction_failed = false</code>{" "}
                  on the row and running <code>pnpm extract:sources</code>.
                </p>
              </>
            ) : charCount > 0 ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="green">
                    {charCount.toLocaleString()} chars extracted
                  </Badge>
                  <Badge tone="gray">{chunks.length} chunks</Badge>
                  <Badge tone="gray">
                    method:{" "}
                    <span className="font-mono">{source.extractionMethod ?? "—"}</span>
                  </Badge>
                  {source.contentHash ? (
                    <span className="font-mono text-xs text-neutral-500">
                      hash {source.contentHash.slice(0, 12)}…
                    </span>
                  ) : null}
                </div>
                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Extracted text
                </h4>
                <pre className="mt-1 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs leading-5 text-neutral-800">
                  {text}
                </pre>
              </>
            ) : (
              <>
                <Badge tone="yellow">not attempted</Badge>
                <p className="mt-3 text-xs text-neutral-500">
                  Run <code>pnpm extract:sources</code> to populate.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 px-6 pt-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Chunks ({chunks.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {chunks.length === 0 ? (
              <div className="text-sm text-neutral-500">No chunks.</div>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {chunks.map((c) => {
                  const meta = (c.metadata ?? {}) as {
                    charCount?: number
                    approxTokenCount?: number
                  }
                  return (
                    <li key={c.id} className="py-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-neutral-700">
                          Chunk #{c.chunkIndex + 1}
                        </span>
                        <span className="text-neutral-500 tabular-nums">
                          {meta.charCount?.toLocaleString() ?? "?"} chars · ~
                          {meta.approxTokenCount ?? "?"} tokens
                        </span>
                      </div>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-700">
                          Preview
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                          {c.text.slice(0, 1500)}
                          {c.text.length > 1500 ? "\n… (truncated)" : ""}
                        </pre>
                      </details>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cited by rules ({citingRules.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {citingRules.length === 0 ? (
              <div className="text-sm text-neutral-500">No rules cite this source.</div>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {citingRules.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/rules/${r.slug}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {r.ruleName}
                      </Link>
                      <StatusBadge status={r.status} />
                      <Badge tone="gray">{r.ruleType}</Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-neutral-500">
                      {r.slug}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
