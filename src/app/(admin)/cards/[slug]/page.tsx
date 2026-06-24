import Link from "next/link"
import { notFound } from "next/navigation"
import { getCardDetail } from "@/lib/queries/cards"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge, StatusBadge } from "@/components/ui/badge"

export const dynamic = "force-dynamic"

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const detail = await getCardDetail(slug)
  if (!detail) notFound()

  const { card, issuer, rules, sources, welcomeOffersList } = detail
  const approvedRules = rules.filter((r) => r.status === "approved")
  const archivedRules = rules.filter((r) => r.status === "archived")
  const otherRules = rules.filter(
    (r) => r.status !== "approved" && r.status !== "archived",
  )

  return (
    <div className="pb-12">
      <PageHeader
        title={card.cardNameEn}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={card.status} />
            {card.network ? <Badge tone="blue">{card.network}</Badge> : null}
            {card.cardLevel ? <Badge tone="gray">{card.cardLevel}</Badge> : null}
            <span className="text-neutral-500">·</span>
            <Link
              href={`/cards?issuer=${issuer.slug}`}
              className="text-neutral-600 hover:underline"
            >
              {issuer.nameEn}
              {issuer.nameZh ? ` (${issuer.nameZh})` : ""}
            </Link>
            <span className="text-neutral-500">·</span>
            <span className="font-mono text-xs text-neutral-500">{card.slug}</span>
          </span>
        }
        actions={
          card.officialUrl ? (
            <a
              href={card.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
              Official page ↗
            </a>
          ) : null
        }
      />

      <div className="grid gap-4 px-6 pt-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Card metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <Definitions
              items={[
                ["English name", card.cardNameEn],
                ["Chinese name", card.cardNameZh ?? "—"],
                ["Product family", card.productFamily ?? "—"],
                ["Variant", card.variantSlug ?? "—"],
                ["Network", card.network ?? "—"],
                ["Level", card.cardLevel ?? "—"],
                [
                  "Annual fee (HKD)",
                  formatAnnualFee(card.annualFeeHkd),
                ],
                ["Status", card.status],
              ]}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Qualitative features</CardTitle>
          </CardHeader>
          <CardContent>
            <QualitativeFeatures features={card.qualitativeFeatures} />
            {card.notes ? (
              <>
                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Notes
                </h4>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">
                  {card.notes}
                </pre>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 px-6 pt-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Reward rules ({approvedRules.length} approved
              {otherRules.length > 0 ? `, ${otherRules.length} other` : ""}
              {archivedRules.length > 0 ? `, ${archivedRules.length} archived` : ""})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <Empty>No rules yet — card is metadata-only (Phase 2 input).</Empty>
            ) : (
              <RulesList rules={[...approvedRules, ...otherRules, ...archivedRules]} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Welcome offers ({welcomeOffersList.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {welcomeOffersList.length === 0 ? (
              <Empty>No structured welcome offers.</Empty>
            ) : (
              <WelcomeOffersList offers={welcomeOffersList} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="px-6 pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Sources ({sources.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <Empty>No sources linked.</Empty>
            ) : (
              <SourcesList sources={sources} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Definitions({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-neutral-100 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-3 gap-2 py-1.5">
          <dt className="text-neutral-500">{k}</dt>
          <dd className="col-span-2 text-neutral-900">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-neutral-500">{children}</div>
}

function QualitativeFeatures({
  features,
}: {
  features: unknown
}) {
  if (!features || typeof features !== "object" || Object.keys(features).length === 0) {
    return <Empty>None.</Empty>
  }
  const f = features as Record<string, unknown>
  const order = [
    "summaryZh",
    "bestUseCaseZh",
    "xlsxCategory",
    "xlsxSpecialty",
    "xlsxBaseRewardText",
    "welcomeOfferDraft",
  ]
  const keys = [
    ...order.filter((k) => k in f),
    ...Object.keys(f).filter((k) => !order.includes(k)),
  ]
  return (
    <dl className="space-y-2 text-sm">
      {keys.map((k) => {
        const v = f[k]
        return (
          <div key={k}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {k}
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-neutral-800">
              {typeof v === "string"
                ? v
                : typeof v === "number" || typeof v === "boolean"
                  ? String(v)
                  : JSON.stringify(v, null, 2)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

function RulesList({
  rules,
}: {
  rules: { id: string; slug: string; ruleName: string; ruleType: string; status: string; rewardFormulaType: string; rewardFormulaPayload: unknown; confidenceScore: string }[]
}) {
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {rules.map((r) => (
        <li key={r.id} className="py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-900">{r.ruleName}</span>
                <StatusBadge status={r.status} />
                <Badge tone="gray">{r.ruleType}</Badge>
              </div>
              <div className="mt-0.5 font-mono text-xs text-neutral-500">
                {r.slug}
              </div>
              <FormulaSummary
                type={r.rewardFormulaType}
                payload={r.rewardFormulaPayload}
              />
            </div>
            <div className="shrink-0 text-right text-xs text-neutral-500">
              conf {Number(r.confidenceScore).toFixed(2)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function FormulaSummary({
  type,
  payload,
}: {
  type: string
  payload: unknown
}) {
  // Short, eyeballable summary per formula variant.
  const p = (payload ?? {}) as Record<string, unknown>
  let summary: string | null = null
  if (type === "simple_percent") {
    summary = `${((Number(p.rate) || 0) * 100).toFixed(2)}%`
  } else if (type === "points_per_hkd") {
    summary = `${p.points} ${p.currencySlug ?? "pts"} per HK$${p.perHkd}`
  } else if (type === "tiered_percent" || type === "tiered_points") {
    const tiers = Array.isArray(p.tiers) ? (p.tiers as unknown[]) : []
    summary = `${tiers.length} tiers, accrual: ${p.accrualPeriod}`
  } else if (type === "no_reward") {
    summary = `0 — ${p.reason ?? "no reward"}`
  } else {
    summary = type
  }
  return (
    <div className="mt-0.5 text-xs text-neutral-700">
      <span className="text-neutral-400">formula:</span> {summary}
    </div>
  )
}

function WelcomeOffersList({
  offers,
}: {
  offers: {
    id: string
    slug: string
    offerName: string
    offerType: string
    estimatedValueHkd: string | null
    tiers: unknown
    status: string
  }[]
}) {
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {offers.map((o) => (
        <li key={o.id} className="py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-900">{o.offerName}</span>
                <StatusBadge status={o.status} />
                <Badge tone="gray">{o.offerType}</Badge>
              </div>
              <div className="mt-0.5 font-mono text-xs text-neutral-500">
                {o.slug}
              </div>
            </div>
            {o.estimatedValueHkd ? (
              <div className="text-right text-sm">
                <div className="font-medium text-neutral-900">
                  HKD {Number(o.estimatedValueHkd).toLocaleString()}
                </div>
                <div className="text-xs text-neutral-500">estimated value</div>
              </div>
            ) : null}
          </div>
          {Array.isArray(o.tiers) ? (
            <div className="mt-1 text-xs text-neutral-600">
              {(o.tiers as { minSpendHkd: number; withinDays: number; reward: { type: string; amount?: number; description?: string } }[]).map((t, i) => (
                <div key={i}>
                  Spend HK${t.minSpendHkd.toLocaleString()} within {t.withinDays}{" "}
                  days → {formatReward(t.reward)}
                </div>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function formatReward(reward: { type: string; amount?: number; description?: string }) {
  switch (reward.type) {
    case "cashback_hkd":
      return `HK$${reward.amount} cashback`
    case "miles":
      return `${reward.amount} miles`
    case "points":
      return `${reward.amount} points`
    case "gift":
      return reward.description ?? "gift"
    case "fee_waiver":
      return "annual fee waiver"
    default:
      return reward.type
  }
}

function SourcesList({
  sources,
}: {
  sources: {
    id: string
    slug: string
    sourceType: string
    sourcePriority: number
    title: string
    url: string | null
    extractionFailed: boolean
    extractedText: string | null
  }[]
}) {
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {sources.map((s) => (
        <li key={s.id} className="py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-neutral-900">{s.title}</span>
                <Badge tone="blue">{s.sourceType}</Badge>
                <Badge tone="gray">priority {s.sourcePriority}</Badge>
                {s.extractionFailed ? (
                  <Badge tone="red">extract failed</Badge>
                ) : s.extractedText ? (
                  <Badge tone="green">
                    {s.extractedText.length.toLocaleString()} chars
                  </Badge>
                ) : (
                  <Badge tone="yellow">not extracted</Badge>
                )}
              </div>
              <div className="mt-0.5 font-mono text-xs text-neutral-500">
                {s.slug}
              </div>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-xs text-sky-700 hover:underline"
                >
                  {s.url} ↗
                </a>
              ) : null}
              {s.extractedText ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-700">
                    Preview extracted text
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 text-xs text-neutral-700">
                    {s.extractedText.slice(0, 2000)}
                    {s.extractedText.length > 2000 ? "\n… (truncated)" : ""}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function formatAnnualFee(v: string | null): string {
  if (v == null) return "—"
  const n = Number(v)
  if (Number.isNaN(n)) return v
  return n === 0 ? "Free" : `HKD ${n.toLocaleString()}`
}
