import Link from "next/link"
import { notFound } from "next/navigation"
import { getRuleDetail } from "@/lib/queries/rules"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { formulaSummary } from "@/components/admin/formula-summary"

export const dynamic = "force-dynamic"

export default async function RuleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const detail = await getRuleDetail(slug)
  if (!detail) notFound()

  const {
    rule,
    card,
    issuer,
    category,
    rewardCurrency,
    source,
    campaign,
    supersedesRule,
    supersededByRules,
  } = detail

  return (
    <div className="pb-12">
      <PageHeader
        title={rule.ruleName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={rule.status} />
            <Badge tone="gray">{rule.ruleType}</Badge>
            <Badge tone="blue">{rule.rewardFormulaType}</Badge>
            <span className="text-neutral-500">·</span>
            <Link
              href={`/cards/${card.slug}`}
              className="text-neutral-600 hover:underline"
            >
              {card.cardNameEn}
            </Link>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-500">{issuer.nameEn}</span>
            <span className="text-neutral-500">·</span>
            <span className="font-mono text-xs text-neutral-500">{rule.slug}</span>
          </span>
        }
        actions={
          <Link
            href={`/rules/${rule.slug}/edit`}
            className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            Edit
          </Link>
        }
      />

      <div className="grid gap-4 px-6 pt-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Reward formula</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium text-neutral-900">
              {formulaSummary(rule.rewardFormulaType, rule.rewardFormulaPayload)}
            </div>
            {rewardCurrency ? (
              <div className="mt-1 text-xs text-neutral-500">
                Currency:{" "}
                <span className="font-mono text-neutral-700">
                  {rewardCurrency.slug}
                </span>{" "}
                · 1 unit = HKD {Number(rewardCurrency.baseValueHkd).toFixed(3)}
              </div>
            ) : null}
            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Payload JSON
            </h4>
            <JsonBlock value={rule.rewardFormulaPayload} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conditions</CardTitle>
          </CardHeader>
          <CardContent>
            <Definitions
              items={[
                ["Category", category?.slug ?? "—"],
                ["Online", boolDisplay(rule.isOnline)],
                ["Overseas", boolDisplay(rule.isOverseas)],
                ["Foreign currency", boolDisplay(rule.isForeignCurrency)],
                ["Requires activation", rule.requiresActivation ? "yes" : "no"],
                ["Requires registration", rule.requiresRegistration ? "yes" : "no"],
                [
                  "Campaign",
                  campaign ? (
                    <span>
                      <span className="font-mono text-xs">{campaign.slug}</span>
                      <div className="text-xs text-neutral-500">
                        {campaign.campaignName}
                      </div>
                    </span>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cap + stacking</CardTitle>
          </CardHeader>
          <CardContent>
            <Definitions
              items={[
                [
                  "Cap amount",
                  rule.capAmountHkd
                    ? `HK$${Number(rule.capAmountHkd).toLocaleString()}`
                    : "—",
                ],
                ["Cap period", rule.capPeriod ?? "—"],
                ["Cap basis", rule.capBasis ?? "—"],
                ["Stacking policy", rule.stackingPolicy],
                ["Exclusive group", rule.exclusiveGroup ?? "—"],
                ["Priority", rule.priority],
                [
                  "Applies to (exclusion)",
                  rule.appliesTo && rule.appliesTo.length > 0 ? (
                    <span className="text-xs">{rule.appliesTo.join(", ")}</span>
                  ) : (
                    "—"
                  ),
                ],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 px-6 pt-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Provenance</CardTitle>
          </CardHeader>
          <CardContent>
            <Definitions
              items={[
                [
                  "Source",
                  source ? (
                    <Link
                      href={`/sources/${source.slug}`}
                      className="text-sky-700 hover:underline"
                    >
                      {source.title}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Confidence", Number(rule.confidenceScore).toFixed(3)],
                ["Effective start", rule.effectiveStart ?? "—"],
                ["Effective end", rule.effectiveEnd ?? "—"],
              ]}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Supersedes chain</CardTitle>
          </CardHeader>
          <CardContent>
            {supersedesRule ? (
              <div className="text-sm">
                <span className="text-neutral-500">Replaces:</span>{" "}
                <Link
                  href={`/rules/${supersedesRule.slug}`}
                  className="text-sky-700 hover:underline"
                >
                  {supersedesRule.ruleName}
                </Link>
                <span className="ml-2 font-mono text-xs text-neutral-500">
                  {supersedesRule.slug}
                </span>
              </div>
            ) : (
              <div className="text-sm text-neutral-500">
                Doesn&apos;t replace any earlier rule.
              </div>
            )}
            {supersededByRules.length > 0 ? (
              <div className="mt-2 space-y-1 text-sm">
                <span className="text-neutral-500">Replaced by:</span>
                {supersededByRules.map((r) => (
                  <div key={r.id}>
                    <Link
                      href={`/rules/${r.slug}`}
                      className="text-sky-700 hover:underline"
                    >
                      {r.ruleName}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-neutral-500">
                      {r.slug}
                    </span>
                    <span className="ml-2">
                      <StatusBadge status={r.status} />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {rule.notes ? (
              <>
                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Notes
                </h4>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">
                  {rule.notes}
                </pre>
              </>
            ) : null}
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

function boolDisplay(v: boolean | null): string {
  if (v === null) return "—"
  return v ? "yes" : "no"
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-80 overflow-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
