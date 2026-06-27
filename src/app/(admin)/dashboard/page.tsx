import Link from "next/link"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { loadDashboardData } from "@/lib/queries/dashboard"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const data = await loadDashboardData()
  const cc = data.catalogCounts

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            Snapshot of the catalog. Live numbers — refresh after{" "}
            <code>pnpm import:data</code>.
          </>
        }
      />

      <div className="space-y-4 px-6 py-4">
        {/* Top: schema-health metric (PRD §5 principle 4) */}
        <Card>
          <CardHeader>
            <CardTitle>
              Schema health — <code>custom_note</code> ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4">
              <span
                className={cn(
                  "text-3xl font-semibold tabular-nums",
                  data.customNote.ratioPct === 0
                    ? "text-emerald-700"
                    : data.customNote.ratioPct < 10
                      ? "text-amber-700"
                      : "text-rose-700",
                )}
              >
                {data.customNote.ratioPct.toFixed(1)}%
              </span>
              <span className="text-sm text-neutral-600">
                {data.customNote.customNoteCount} of{" "}
                {data.customNote.approvedTotal} approved rules use the
                free-text <code>custom_note</code> formula.
              </span>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Target: <strong>&lt; 10%</strong>. Climbing past that means the
              schema is failing to model real cards — review whether the
              recurring custom_note rules need a new formula variant.
            </p>
          </CardContent>
        </Card>

        {/* Counts grid */}
        <div className="grid gap-4 lg:grid-cols-4">
          <CountCard
            title="Cards"
            primary={`${cc.activeCards} active`}
            secondary={`${cc.draftCards} draft · ${cc.totalCards} total`}
            href="/cards"
            note={`${cc.issuers} issuers`}
          />
          <CountCard
            title="Rules"
            primary={`${cc.approvedRules} approved`}
            secondary={`${cc.archivedRules} archived · ${cc.totalRules} total`}
            href="/rules"
            note="seam from schema to calculator"
          />
          <CountCard
            title="Sources"
            primary={`${cc.activeSources} active`}
            secondary={`${cc.extractedSources} with extracted text`}
            href="/sources"
            note="PRD §5 principle 1 — every rule cites one"
          />
          <CountCard
            title="Welcome + campaigns"
            primary={`${cc.approvedWelcomeOffers} offers · ${cc.activeCampaigns} campaigns`}
            secondary={`${cc.categories} categories · ${cc.currencies} currencies`}
            href="/welcome-offers"
            disabled
            note="welcome-offers / campaigns admin pages: TBD"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Approved rules by type</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                rows={data.rulesByType.map((r) => ({
                  label: r.ruleType,
                  count: r.count,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cards by issuer</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                rows={data.cardsByIssuer.map((r) => ({
                  label: r.issuerSlug,
                  count: r.total,
                  badge:
                    r.active > 0 ? `${r.active} active` : undefined,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* Phase 2 — extraction cost + review backlog (PRD §22.10 #5) */}
        <Card>
          <CardHeader>
            <CardTitle>
              Phase 2 — extraction + cross-check
              <span className="ml-2 text-xs font-normal text-neutral-500">
                (PRD §22.10 #5 telemetry)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <Stat
                label="LLM cost to date"
                value={`$${(data.extraction.totalCostUsdCents / 100).toFixed(2)}`}
                hint={`${data.extraction.succeededRuns} succeeded · ${data.extraction.failedRuns} failed runs`}
              />
              <Stat
                label="Claims emitted"
                value={data.extraction.totalClaimsEmitted.toLocaleString()}
                hint={`avg ${data.extraction.avgLatencyMs}ms / call`}
              />
              <Stat
                label="Cross-check groups"
                value={data.crossCheck.totalGroups.toLocaleString()}
                hint={`${data.crossCheck.materializedRules} materialized to rules`}
              />
              <Stat
                label="Review backlog"
                value={data.reviewQueue.openTasks.toLocaleString()}
                hint={`${data.reviewQueue.resolvedTasks} resolved · ${data.reviewQueue.dismissedTasks} dismissed`}
                href="/review"
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <VerdictPill
                tone="red"
                label="Conflicts (open)"
                count={data.reviewQueue.openConflicts}
                groupCount={data.crossCheck.conflictGroups}
              />
              <VerdictPill
                tone="green"
                label="Agreed-to-confirm (open)"
                count={data.reviewQueue.openAgreedToConfirm}
                groupCount={data.crossCheck.agreedGroups}
              />
              <VerdictPill
                tone="yellow"
                label="Single-source (open)"
                count={data.reviewQueue.openSingleSource}
                groupCount={data.crossCheck.singleSourceGroups}
              />
            </div>

            {data.crossCheck.topCardsByMaterializedRules.length > 0 ? (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Top cards by materialized rules (xchk__)
                </h4>
                <BarList
                  rows={data.crossCheck.topCardsByMaterializedRules.map((r) => ({
                    label: r.cardSlug,
                    count: r.ruleCount,
                  }))}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently updated rules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-neutral-100 text-sm">
              {data.recentlyUpdatedRules.map((r) => (
                <li
                  key={r.slug}
                  className="flex items-center gap-2 py-1.5 text-sm"
                >
                  <Link
                    href={`/rules/${r.slug}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {r.ruleName}
                  </Link>
                  <StatusBadge status={r.status} />
                  <Link
                    href={`/cards/${r.cardSlug}`}
                    className="text-xs text-neutral-500 hover:underline"
                  >
                    {r.cardSlug}
                  </Link>
                  <span className="ml-auto font-mono text-xs text-neutral-500 tabular-nums">
                    {formatRelative(r.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CountCard({
  title,
  primary,
  secondary,
  href,
  note,
  disabled,
}: {
  title: string
  primary: string
  secondary: string
  href: string
  note?: string
  disabled?: boolean
}) {
  const body = (
    <Card className={cn(disabled && "opacity-60")}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums text-neutral-900">
          {primary}
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">{secondary}</div>
        {note ? (
          <div className="mt-2 text-[11px] text-neutral-400">{note}</div>
        ) : null}
      </CardContent>
    </Card>
  )
  if (disabled) return body
  return (
    <Link href={href} className="block">
      {body}
    </Link>
  )
}

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string
  value: string
  hint?: string
  href?: string
}) {
  const body = (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-neutral-500">{hint}</div>
      ) : null}
    </div>
  )
  return href ? (
    <Link href={href} className="block hover:bg-neutral-50">
      {body}
    </Link>
  ) : (
    body
  )
}

function VerdictPill({
  tone,
  label,
  count,
  groupCount,
}: {
  tone: "red" | "green" | "yellow"
  label: string
  count: number
  groupCount: number
}) {
  const toneClass =
    tone === "red"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-amber-200 bg-amber-50 text-amber-900"
  return (
    <div className={cn("rounded border p-3", toneClass)}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{count}</span>
        <span className="text-xs opacity-70">/ {groupCount} groups</span>
      </div>
    </div>
  )
}

function BarList({
  rows,
}: {
  rows: { label: string; count: number; badge?: string }[]
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-center gap-2">
            <span className="w-44 truncate text-neutral-700">{r.label}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-neutral-100">
              <div
                className="absolute inset-y-0 left-0 bg-neutral-400"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-neutral-700">
              {r.count}
            </span>
            {r.badge ? <Badge tone="green">{r.badge}</Badge> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function formatRelative(d: Date): string {
  const now = Date.now()
  const t = new Date(d).getTime()
  const seconds = Math.floor((now - t) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(d).toISOString().slice(0, 10)
}
