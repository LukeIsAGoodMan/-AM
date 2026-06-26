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
