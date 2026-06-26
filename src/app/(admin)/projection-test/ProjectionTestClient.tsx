"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { NaiveSimulationEngine } from "@/lib/simulation/naive"
import type { Projection } from "@/lib/simulation/types"
import type {
  ProjectionTestCard,
  ProjectionTestData,
} from "@/lib/queries/projection-test"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Plan-mode prototype per roadmap M16 + PRD §20 step 7. Spending profile +
// horizon + welcome toggle → naive sim per card → ranked projection.
//
// The simulator is a class with an async API for Phase 2 forward-compat;
// today's NaiveSimulationEngine resolves synchronously. We instantiate one
// and call it sync-style in useMemo by unwrapping the already-settled
// promise via a microtask-free await pattern below.

const ENGINE = new NaiveSimulationEngine()

const DEFAULT_PROFILE: ProfileRow[] = [
  { categorySlug: "dining_local", monthlyHkd: 4000 },
  { categorySlug: "online_local", monthlyHkd: 3000 },
  { categorySlug: "supermarket", monthlyHkd: 2500 },
  { categorySlug: "general_overseas", monthlyHkd: 1500 },
]

const FIXTURES: Fixture[] = [
  {
    id: "demo-plan-mode",
    label: "PRD §20 step 8 — plan mode demo",
    description:
      "Dining 8000 + online 4000 + overseas 2000 per month. Long enough horizon to amortize the welcome offer.",
    profile: [
      { categorySlug: "dining_local", monthlyHkd: 8000 },
      { categorySlug: "online_local", monthlyHkd: 4000 },
      { categorySlug: "general_overseas", monthlyHkd: 2000 },
    ],
    monthsAhead: 12,
    includeWelcomeOffer: true,
  },
  {
    id: "modest-spender",
    label: "Modest local-only spender",
    description: "Light spend, all HK; tests low-balance behaviour.",
    profile: [
      { categorySlug: "dining_local", monthlyHkd: 1500 },
      { categorySlug: "supermarket", monthlyHkd: 2000 },
      { categorySlug: "public_transport", monthlyHkd: 500 },
    ],
    monthsAhead: 12,
    includeWelcomeOffer: false,
  },
  {
    id: "miles-collector",
    label: "Miles collector — travel-heavy",
    description: "Big overseas + airline / OTA spend.",
    profile: [
      { categorySlug: "travel_airline", monthlyHkd: 3000 },
      { categorySlug: "travel_ota", monthlyHkd: 2000 },
      { categorySlug: "general_overseas", monthlyHkd: 4000 },
      { categorySlug: "dining_overseas", monthlyHkd: 2000 },
    ],
    monthsAhead: 12,
    includeWelcomeOffer: true,
  },
]

type ProfileRow = { categorySlug: string; monthlyHkd: number }

type Fixture = {
  id: string
  label: string
  description: string
  profile: ProfileRow[]
  monthsAhead: number
  includeWelcomeOffer: boolean
}

export function ProjectionTestClient({ data }: { data: ProjectionTestData }) {
  const [profile, setProfile] = useState<ProfileRow[]>(DEFAULT_PROFILE)
  const [monthsAhead, setMonthsAhead] = useState(12)
  const [includeWelcomeOffer, setIncludeWelcomeOffer] = useState(true)
  const [activeFixtureId, setActiveFixtureId] = useState("")
  const [selectedCardSlugs, setSelectedCardSlugs] = useState<string[]>(() =>
    data.cards.map((c) => c.cardSlug),
  )
  const [startDate, setStartDate] = useState("2026-06-01")

  const monthlyTotalHkd = useMemo(
    () => profile.reduce((s, r) => s + (r.monthlyHkd || 0), 0),
    [profile],
  )

  // Per-card projection. The naive engine is sync under the hood but exposes
  // a Promise; for in-render computation we keep the synchronous derivation
  // and rely on .then being immediate. Acceptable in a useMemo because the
  // engine has no IO.
  const results = useMemo(() => {
    const selectedSet = new Set(selectedCardSlugs)
    const out: ComputedCard[] = []
    for (const card of data.cards) {
      if (!selectedSet.has(card.cardSlug)) continue
      const projection = projectSync(card, {
        profile,
        monthsAhead,
        includeWelcomeOffer,
        startDate,
      })
      out.push({ card, projection })
    }
    out.sort(
      (a, b) =>
        b.projection.totalRewardValueHkd - a.projection.totalRewardValueHkd,
    )
    return out
  }, [
    data.cards,
    selectedCardSlugs,
    profile,
    monthsAhead,
    includeWelcomeOffer,
    startDate,
  ])

  // Form mutators
  function addRow() {
    setProfile((p) => [...p, { categorySlug: "", monthlyHkd: 0 }])
  }
  function removeRow(i: number) {
    setProfile((p) => p.filter((_, idx) => idx !== i))
  }
  function patchRow(i: number, patch: Partial<ProfileRow>) {
    setProfile((p) =>
      p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    )
  }

  function applyFixture(fix: Fixture) {
    setActiveFixtureId(fix.id)
    setProfile(fix.profile)
    setMonthsAhead(fix.monthsAhead)
    setIncludeWelcomeOffer(fix.includeWelcomeOffer)
  }

  function toggleCard(slug: string) {
    setSelectedCardSlugs((cur) =>
      cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug],
    )
  }
  function setAllCards(on: boolean) {
    setSelectedCardSlugs(on ? data.cards.map((c) => c.cardSlug) : [])
  }

  // Find the global peak per-month reward so the sparkline bars share scale.
  const peakMonthlyHkd = useMemo(() => {
    let m = 0
    for (const r of results) {
      for (const v of r.projection.perMonthHkd) {
        if (v > m) m = v
      }
    }
    return m
  }, [results])

  return (
    <div className="grid gap-4 px-6 py-4 lg:grid-cols-12">
      {/* Left: fixtures + profile + settings */}
      <div className="space-y-4 lg:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle>Fixtures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <select
              value={activeFixtureId}
              onChange={(e) => {
                const fix = FIXTURES.find((f) => f.id === e.target.value)
                if (fix) applyFixture(fix)
                else setActiveFixtureId("")
              }}
              className={inputCls}
            >
              <option value="">— pick a scenario —</option>
              {FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            {activeFixtureId ? (
              <p className="text-xs text-neutral-600">
                {FIXTURES.find((f) => f.id === activeFixtureId)?.description}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Monthly spending profile —{" "}
              <span className="tabular-nums">
                HKD {monthlyTotalHkd.toLocaleString()}
              </span>
              /mo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-1.5">
              {profile.map((row, i) => (
                <li key={i} className="flex items-center gap-2">
                  <select
                    value={row.categorySlug}
                    onChange={(e) =>
                      patchRow(i, { categorySlug: e.target.value })
                    }
                    className={cn(inputCls, "flex-1")}
                  >
                    <option value="">— pick category —</option>
                    {data.categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.slug}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={row.monthlyHkd}
                    onChange={(e) =>
                      patchRow(i, { monthlyHkd: Number(e.target.value || 0) })
                    }
                    className={cn(inputCls, "w-24")}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    title="Remove row"
                    className="rounded border border-neutral-200 px-1.5 text-xs text-neutral-500 hover:bg-neutral-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              + add category
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Horizon</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Months ahead">
              <input
                type="number"
                min="1"
                max="60"
                value={monthsAhead}
                onChange={(e) =>
                  setMonthsAhead(Number(e.target.value || 12))
                }
                className={inputCls}
              />
            </Field>
            <Field label="Start date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeWelcomeOffer}
                onChange={(e) => setIncludeWelcomeOffer(e.target.checked)}
              />
              Include welcome offer (one-shot)
            </label>
          </CardContent>
        </Card>
      </div>

      {/* Middle: card multi-select */}
      <div className="space-y-4 lg:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>
              Cards ({selectedCardSlugs.length}/{data.cards.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAllCards(true)}
                className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setAllCards(false)}
                className="rounded border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50"
              >
                None
              </button>
            </div>
            <ul className="divide-y divide-neutral-100 text-sm">
              {data.cards.map((card) => {
                const selected = selectedCardSlugs.includes(card.cardSlug)
                return (
                  <li
                    key={card.cardSlug}
                    className={cn("py-1.5", !selected && "opacity-60")}
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleCard(card.cardSlug)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-neutral-900">
                            {card.cardNameEn}
                          </span>
                          {card.welcomeOffers.length > 0 ? (
                            <Badge tone="blue" className="text-[10px]">
                              welcome HKD{" "}
                              {card.welcomeOffers
                                .reduce((s, w) => s + w.estimatedValueHkd, 0)
                                .toLocaleString()}
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-[11px] text-neutral-500">
                          {card.issuerSlug} · {card.rules.length} rules
                        </span>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Right: projection results */}
      <div className="space-y-4 lg:col-span-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
        {results.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">
                Select at least one card to see a projection.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                Projections ({results.length}) — {monthsAhead}-month horizon
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {results.map((item, i) => (
                <ProjectionRow
                  key={item.card.cardSlug}
                  rank={i + 1}
                  item={item}
                  peakMonthlyHkd={peakMonthlyHkd}
                />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

type ComputedCard = {
  card: ProjectionTestCard
  projection: Projection
}

function projectSync(
  card: ProjectionTestCard,
  options: {
    profile: ProfileRow[]
    monthsAhead: number
    includeWelcomeOffer: boolean
    startDate: string
  },
): Projection {
  const monthlyByCategory: Record<string, number> = {}
  for (const r of options.profile) {
    if (!r.categorySlug || r.monthlyHkd <= 0) continue
    monthlyByCategory[r.categorySlug] =
      (monthlyByCategory[r.categorySlug] ?? 0) + r.monthlyHkd
  }
  return ENGINE.projectSync({
    cardId: card.cardSlug,
    rules: card.rules,
    welcomeOffers: card.welcomeOffers,
    profile: { monthlyByCategory },
    monthsAhead: options.monthsAhead,
    includeWelcomeOffer: options.includeWelcomeOffer,
    startDate: options.startDate,
  })
}

function ProjectionRow({
  rank,
  item,
  peakMonthlyHkd,
}: {
  rank: number
  item: ComputedCard
  peakMonthlyHkd: number
}) {
  const { card, projection } = item
  const welcomeShare =
    projection.totalRewardValueHkd > 0
      ? (projection.welcomeOfferContributionHkd /
          projection.totalRewardValueHkd) *
        100
      : 0
  const ongoing =
    projection.totalRewardValueHkd - projection.welcomeOfferContributionHkd

  return (
    <div className="rounded border border-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
        <span className="text-sm font-semibold tabular-nums text-neutral-500">
          #{rank}
        </span>
        <Link
          href={`/cards/${card.cardSlug}`}
          className="font-medium text-neutral-900 hover:underline"
        >
          {card.cardNameEn}
        </Link>
        <Badge tone="gray">{card.issuerSlug}</Badge>
        <span className="ml-auto text-base font-semibold tabular-nums text-neutral-900">
          HKD {projection.totalRewardValueHkd.toFixed(2)}
        </span>
      </div>
      <div className="px-3 py-2 text-xs text-neutral-700">
        <div className="flex items-center justify-between">
          <span>
            Ongoing: HKD {ongoing.toFixed(2)}
            {projection.welcomeOfferContributionHkd > 0 ? (
              <>
                {" "}
                + welcome HKD{" "}
                {projection.welcomeOfferContributionHkd.toFixed(2)} (
                {welcomeShare.toFixed(0)}%)
              </>
            ) : null}
          </span>
          {card.welcomeOffers.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700">
                {card.welcomeOffers.length} welcome offer
                {card.welcomeOffers.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-1 space-y-0.5">
                {card.welcomeOffers.map((w) => (
                  <li key={w.offerId} className="text-neutral-600">
                    {w.offerName} → HKD {w.estimatedValueHkd.toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="mt-2">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">
            Per-month reward
          </div>
          <Sparkline
            values={projection.perMonthHkd}
            peak={peakMonthlyHkd}
          />
        </div>

        {projection.caveats.length > 0 ? (
          <ul className="mt-2 space-y-0.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            {projection.caveats.map((c, i) => (
              <li key={i}>⚠ {c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function Sparkline({
  values,
  peak,
}: {
  values: number[]
  peak: number
}) {
  if (peak === 0) {
    return <div className="text-[11px] text-neutral-400">no reward earned</div>
  }
  return (
    <div className="mt-0.5 flex items-end gap-px" style={{ height: 36 }}>
      {values.map((v, i) => {
        const pct = peak === 0 ? 0 : (v / peak) * 100
        return (
          <div
            key={i}
            title={`Month ${i + 1}: HKD ${v.toFixed(2)}`}
            className="flex-1 rounded-sm bg-emerald-200 hover:bg-emerald-300"
            style={{ height: `${Math.max(2, pct)}%` }}
          />
        )
      })}
    </div>
  )
}

const inputCls =
  "w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600">{label}</label>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
