"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { calculate, type UserCardContext } from "@/lib/calculator/calculate"
import { explainCalculate, type RuleOutcome } from "@/lib/calculator/explain"
import { synthesizeCaveats } from "@/lib/calculator/caveats"
import { HardcodedMerchantResolver } from "@/lib/resolver/hardcoded"
import type { TransactionContext } from "@/lib/schemas/transaction"
import type { RewardResult } from "@/lib/schemas/result"
import type {
  CalcTestCampaign,
  CalcTestCard,
  CalcTestCategory,
  CalcTestData,
  CalcTestSourceInfo,
} from "@/lib/queries/calculator-test"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formulaSummary } from "@/components/admin/formula-summary"
import { cn } from "@/lib/utils"
import { FIXTURES, type Fixture } from "./fixtures"

// Resolver is a static map → safe to instantiate once at module scope and
// reuse across renders. Calling resolve() is sync work behind an async API,
// so we read .categorySlug synchronously via the SEED_MERCHANTS map indirectly.
const RESOLVER = new HardcodedMerchantResolver()

type TriState = "true" | "false" | "unknown"
type RegionInput = "HK" | "MAINLAND_CHINA" | "MACAU" | "OVERSEAS" | "UNKNOWN"

type FormState = {
  amountHkd: string
  merchantName: string
  categoryOverride: string // "" = let resolver fill
  currency: string
  isOnline: TriState
  isForeignCurrency: TriState
  countryRegion: RegionInput
  transactionDate: string
  // Display-only — resolver-derived category + confidence shown back to the user.
  // Populated in derivedTxn.
}

const EMPTY_FORM: FormState = {
  amountHkd: "1000",
  merchantName: "",
  categoryOverride: "",
  currency: "HKD",
  isOnline: "unknown",
  isForeignCurrency: "unknown",
  countryRegion: "HK",
  transactionDate: "2026-06-24",
}

type PerCardContext = {
  activatedRuleIds: string[]
  activatedCampaignIds: string[]
  selectedCategorySlugs: string[]
}

function emptyCtx(): PerCardContext {
  return {
    activatedRuleIds: [],
    activatedCampaignIds: [],
    selectedCategorySlugs: [],
  }
}

export function CalculatorTestClient({ data }: { data: CalcTestData }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [selectedCardSlugs, setSelectedCardSlugs] = useState<string[]>(() =>
    data.cards.map((c) => c.cardSlug),
  )
  const [perCardCtx, setPerCardCtx] = useState<Record<string, PerCardContext>>(
    {},
  )
  const [activeFixtureId, setActiveFixtureId] = useState<string>("")
  const [compareSlugs, setCompareSlugs] = useState<[string | null, string | null]>(
    [null, null],
  )

  // Derived: resolved transaction with category + confidence.
  const txn = useMemo<TransactionContext | null>(() => {
    const amount = Number(form.amountHkd)
    if (!Number.isFinite(amount) || amount < 0) return null

    const out: TransactionContext = {
      amountHkd: amount,
      transactionDate: form.transactionDate,
      currency: form.currency || undefined,
      countryRegion: form.countryRegion === "UNKNOWN" ? "UNKNOWN" : form.countryRegion,
      isOnline: triToBool(form.isOnline),
      isForeignCurrency: triToBool(form.isForeignCurrency),
    }

    if (form.categoryOverride.trim() !== "") {
      out.categorySlug = form.categoryOverride.trim()
      // Override is treated as 1.0 (trusted upstream).
    } else if (form.merchantName.trim() !== "") {
      const merchant = form.merchantName.trim()
      const res = RESOLVER.resolveSync(merchant)
      out.merchantName = merchant
      out.categorySlug = res.categorySlug
      out.categoryResolutionConfidence = res.confidence
    }

    return out
  }, [form])

  // Derived: ranked results per selected card.
  const ranked = useMemo(() => {
    if (!txn) return []
    const selectedSet = new Set(selectedCardSlugs)
    const items = data.cards
      .filter((c) => selectedSet.has(c.cardSlug))
      .map((card) => computeCard(card, txn, perCardCtx[card.cardSlug] ?? emptyCtx()))
    items.sort((a, b) => b.result.rewardValueHkd - a.result.rewardValueHkd)
    return items
  }, [txn, data.cards, selectedCardSlugs, perCardCtx])

  // Helpers
  function applyFixture(fix: Fixture) {
    const f = fix.formInput
    setActiveFixtureId(fix.id)
    setForm({
      amountHkd: String(f.amountHkd),
      merchantName: f.merchantName ?? "",
      categoryOverride: f.categoryOverride ?? "",
      currency: f.currency ?? "HKD",
      isOnline: boolToTri(f.isOnline),
      isForeignCurrency: boolToTri(f.isForeignCurrency),
      countryRegion: (f.countryRegion ?? "HK") as RegionInput,
      transactionDate: f.transactionDate ?? "2026-06-24",
    })

    // Pre-populate per-card contexts from fixture.
    const nextCtx: Record<string, PerCardContext> = {}
    for (const [cardSlug, ctx] of Object.entries(fix.cardContexts ?? {})) {
      const campaignIds = (ctx.activatedCampaignSlugs ?? [])
        .map((slug) => data.campaigns.find((c) => c.slug === slug)?.id)
        .filter((id): id is string => !!id)
      nextCtx[cardSlug] = {
        activatedRuleIds: ctx.activatedRuleIds ?? [],
        activatedCampaignIds: campaignIds,
        selectedCategorySlugs: ctx.selectedCategorySlugs ?? [],
      }
    }
    setPerCardCtx(nextCtx)
  }

  function clearForm() {
    setActiveFixtureId("")
    setForm(EMPTY_FORM)
    setPerCardCtx({})
  }

  function toggleCard(slug: string) {
    setSelectedCardSlugs((cur) =>
      cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug],
    )
  }

  function setAllCards(on: boolean) {
    setSelectedCardSlugs(on ? data.cards.map((c) => c.cardSlug) : [])
  }

  function updateCardCtx(
    cardSlug: string,
    patch: Partial<PerCardContext>,
  ) {
    setPerCardCtx((cur) => ({
      ...cur,
      [cardSlug]: {
        ...(cur[cardSlug] ?? emptyCtx()),
        ...patch,
      },
    }))
  }

  function toggleCompare(slug: string) {
    setCompareSlugs(([a, b]) => {
      if (a === slug) return [b, null]
      if (b === slug) return [a, null]
      if (a === null) return [slug, b]
      if (b === null) return [a, slug]
      // Both filled — replace b.
      return [a, slug]
    })
  }

  return (
    <div className="grid gap-4 px-6 py-4 lg:grid-cols-12">
      {/* Left: form + fixtures */}
      <div className="space-y-4 lg:col-span-3">
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
                else clearForm()
              }}
              className="w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-sm"
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
            ) : (
              <p className="text-xs text-neutral-500">
                Pick one to pre-fill the form, or enter values manually below.
              </p>
            )}
            <button
              type="button"
              onClick={clearForm}
              className="text-xs text-neutral-600 underline hover:text-neutral-900"
            >
              Clear
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transaction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Amount (HKD)">
              <input
                type="number"
                min="0"
                step="1"
                value={form.amountHkd}
                onChange={(e) =>
                  setForm({ ...form, amountHkd: e.target.value })
                }
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
              />
            </Field>
            <Field
              label="Merchant name"
              hint={
                form.categoryOverride
                  ? "Ignored — category override is set."
                  : "Leave blank for category-only matching, or type a HK merchant (Klook, Foodpanda, IRD…)."
              }
            >
              <input
                type="text"
                value={form.merchantName}
                onChange={(e) =>
                  setForm({ ...form, merchantName: e.target.value })
                }
                disabled={!!form.categoryOverride}
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50 disabled:text-neutral-400"
              />
            </Field>
            <Field
              label="Category override"
              hint="When set, bypass the merchant resolver (confidence treated as 1.00)."
            >
              <select
                value={form.categoryOverride}
                onChange={(e) =>
                  setForm({ ...form, categoryOverride: e.target.value })
                }
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
              >
                <option value="">— use resolver —</option>
                {data.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.slug}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Currency">
                <input
                  type="text"
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value.toUpperCase() })
                  }
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="Region">
                <select
                  value={form.countryRegion}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      countryRegion: e.target.value as RegionInput,
                    })
                  }
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                >
                  <option value="HK">HK</option>
                  <option value="MAINLAND_CHINA">Mainland China</option>
                  <option value="MACAU">Macau</option>
                  <option value="OVERSEAS">Overseas</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Online">
                <TriSelect
                  value={form.isOnline}
                  onChange={(v) => setForm({ ...form, isOnline: v })}
                />
              </Field>
              <Field label="Foreign FX">
                <TriSelect
                  value={form.isForeignCurrency}
                  onChange={(v) => setForm({ ...form, isForeignCurrency: v })}
                />
              </Field>
            </div>
            <Field label="Date">
              <input
                type="date"
                value={form.transactionDate}
                onChange={(e) =>
                  setForm({ ...form, transactionDate: e.target.value })
                }
                className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
              />
            </Field>
          </CardContent>
        </Card>

        <ResolvedTxnSummary txn={txn} />
      </div>

      {/* Middle: card selection + per-card controls */}
      <div className="space-y-4 lg:col-span-4">
        <Card>
          <CardHeader>
            <CardTitle>Cards ({selectedCardSlugs.length}/{data.cards.length})</CardTitle>
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
              {data.cards.map((card) => (
                <CardSelectRow
                  key={card.cardSlug}
                  card={card}
                  campaigns={data.campaigns}
                  categories={data.categories}
                  selected={selectedCardSlugs.includes(card.cardSlug)}
                  ctx={perCardCtx[card.cardSlug] ?? emptyCtx()}
                  onToggle={() => toggleCard(card.cardSlug)}
                  onCtxChange={(patch) => updateCardCtx(card.cardSlug, patch)}
                  compareState={compareStateFor(card.cardSlug, compareSlugs)}
                  onToggleCompare={() => toggleCompare(card.cardSlug)}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Right: compare panel (when active) + ranked output. With 11 cards
          the ranking gets tall, so the column scrolls independently — and
          compare goes on top because that's where the user's attention is
          when they've pinned two cards for comparison. */}
      <div className="space-y-4 lg:col-span-5 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
        {compareSlugs[0] && compareSlugs[1] && txn ? (
          <ComparePanel
            txn={txn}
            cardA={
              ranked.find((r) => r.card.cardSlug === compareSlugs[0]) ??
              computeFromData(data, compareSlugs[0], txn, perCardCtx)
            }
            cardB={
              ranked.find((r) => r.card.cardSlug === compareSlugs[1]) ??
              computeFromData(data, compareSlugs[1], txn, perCardCtx)
            }
            sourcesById={data.sourcesById}
          />
        ) : null}

        {!txn ? (
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">
                Enter a valid amount to compute rewards.
              </p>
            </CardContent>
          </Card>
        ) : ranked.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-neutral-500">Select at least one card.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Ranking ({ranked.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ranked.map((item, i) => (
                <RankRow
                  key={item.card.cardSlug}
                  rank={i + 1}
                  item={item}
                  sourcesById={data.sourcesById}
                />
              ))}
            </CardContent>
          </Card>
        )}

        {compareSlugs[0] && compareSlugs[1] ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Why this lost</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-500">
                Click ↔ next to two cards to compare rule-by-rule decisions.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-neutral-600">{label}</label>
      <div className="mt-0.5">{children}</div>
      {hint ? <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  )
}

function TriSelect({
  value,
  onChange,
}: {
  value: TriState
  onChange: (v: TriState) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TriState)}
      className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
    >
      <option value="true">true</option>
      <option value="false">false</option>
      <option value="unknown">unknown</option>
    </select>
  )
}

function ResolvedTxnSummary({ txn }: { txn: TransactionContext | null }) {
  if (!txn) return null
  if (!txn.merchantName && !txn.categorySlug) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolved</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-xs">
        {txn.merchantName ? (
          <Row k="Merchant" v={txn.merchantName} />
        ) : null}
        <Row k="Category" v={txn.categorySlug ?? "—"} />
        {txn.categoryResolutionConfidence !== undefined ? (
          <Row
            k="Category conf."
            v={
              <>
                {txn.categoryResolutionConfidence.toFixed(2)}{" "}
                <ConfidenceBadge score={txn.categoryResolutionConfidence} />
              </>
            }
          />
        ) : (
          <Row k="Category conf." v="1.00 (override)" />
        )}
      </CardContent>
    </Card>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{k}</span>
      <span className="text-neutral-800">{v}</span>
    </div>
  )
}

function CardSelectRow({
  card,
  campaigns,
  categories,
  selected,
  ctx,
  onToggle,
  onCtxChange,
  compareState,
  onToggleCompare,
}: {
  card: CalcTestCard
  campaigns: CalcTestCampaign[]
  categories: CalcTestCategory[]
  selected: boolean
  ctx: PerCardContext
  onToggle: () => void
  onCtxChange: (patch: Partial<PerCardContext>) => void
  compareState: "A" | "B" | null
  onToggleCompare: () => void
}) {
  // Card-specific controls — only render when the underlying rules need them.
  const gatedRules = card.rules.filter(
    (r) => r.requiresActivation || r.requiresRegistration,
  )
  const selectedCategoryRules = card.rules.filter(
    (r) => r.requiresSelectedCategory && r.categorySlug !== null,
  )
  const cardCampaigns = campaigns.filter(
    (c) => c.cardSlug === card.cardSlug || c.cardSlug === null,
  )
  const ctxActiveCount =
    ctx.activatedRuleIds.length +
    ctx.activatedCampaignIds.length +
    ctx.selectedCategorySlugs.length

  return (
    <li className={cn("py-2", !selected && "opacity-60")}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900">{card.cardNameEn}</span>
            <Badge tone="gray">{card.issuerSlug}</Badge>
            {ctxActiveCount > 0 ? (
              <Badge tone="green" className="text-[10px]">
                ctx +{ctxActiveCount}
              </Badge>
            ) : null}
            <button
              type="button"
              onClick={onToggleCompare}
              title={
                compareState
                  ? `Selected for compare slot ${compareState}. Click to clear.`
                  : "Add to side-by-side compare."
              }
              className={cn(
                "ml-auto rounded border px-1.5 py-0.5 text-xs",
                compareState
                  ? "border-sky-300 bg-sky-50 text-sky-700"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50",
              )}
            >
              ↔ {compareState ?? ""}
            </button>
          </div>

          {selected && (gatedRules.length || selectedCategoryRules.length || cardCampaigns.length) ? (
            <div className="mt-1 space-y-1 rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-xs">
              {selectedCategoryRules.length > 0 ? (
                <SelectedCategoriesPicker
                  cardRules={selectedCategoryRules}
                  categories={categories}
                  selected={ctx.selectedCategorySlugs}
                  onChange={(slugs) =>
                    onCtxChange({ selectedCategorySlugs: slugs })
                  }
                />
              ) : null}
              {gatedRules.length > 0 ? (
                <ActivationToggles
                  rules={gatedRules}
                  activated={ctx.activatedRuleIds}
                  onChange={(ids) => onCtxChange({ activatedRuleIds: ids })}
                />
              ) : null}
              {cardCampaigns.length > 0 ? (
                <CampaignToggles
                  campaigns={cardCampaigns}
                  activated={ctx.activatedCampaignIds}
                  onChange={(ids) => onCtxChange({ activatedCampaignIds: ids })}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function SelectedCategoriesPicker({
  cardRules,
  categories,
  selected,
  onChange,
}: {
  cardRules: { ruleId: string; ruleName: string; categorySlug: string | null }[]
  categories: CalcTestCategory[]
  selected: string[]
  onChange: (slugs: string[]) => void
}) {
  // Universe of pickable categories = those any selected-category rule on
  // this card references. (Cards typically let users pick N from a fixed set.)
  const universe = Array.from(
    new Set(
      cardRules
        .map((r) => r.categorySlug)
        .filter((s): s is string => s !== null),
    ),
  )
  // Plus any other category in the taxonomy so user can experiment.
  const otherCategories = categories
    .map((c) => c.slug)
    .filter((s) => !universe.includes(s))

  function toggle(slug: string) {
    onChange(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug],
    )
  }

  return (
    <div>
      <div className="font-semibold text-neutral-700">
        Selected categories ({selected.length})
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {universe.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => toggle(slug)}
            className={cn(
              "rounded border px-1.5 py-0.5",
              selected.includes(slug)
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100",
            )}
          >
            {slug}
          </button>
        ))}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-neutral-500 hover:text-neutral-700">
          + add other category…
        </summary>
        <div className="mt-1 flex flex-wrap gap-1">
          {otherCategories.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
              className={cn(
                "rounded border px-1.5 py-0.5",
                selected.includes(slug)
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100",
              )}
            >
              {slug}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

function ActivationToggles({
  rules,
  activated,
  onChange,
}: {
  rules: { ruleId: string; ruleName: string }[]
  activated: string[]
  onChange: (ids: string[]) => void
}) {
  function toggle(id: string) {
    onChange(
      activated.includes(id)
        ? activated.filter((x) => x !== id)
        : [...activated, id],
    )
  }
  return (
    <div>
      <div className="font-semibold text-neutral-700">
        Activated rules ({activated.length}/{rules.length})
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {rules.map((r) => (
          <li key={r.ruleId} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={activated.includes(r.ruleId)}
              onChange={() => toggle(r.ruleId)}
            />
            <span className="text-neutral-700">{r.ruleName}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CampaignToggles({
  campaigns,
  activated,
  onChange,
}: {
  campaigns: CalcTestCampaign[]
  activated: string[]
  onChange: (ids: string[]) => void
}) {
  function toggle(id: string) {
    onChange(
      activated.includes(id)
        ? activated.filter((x) => x !== id)
        : [...activated, id],
    )
  }
  return (
    <div>
      <div className="font-semibold text-neutral-700">
        Activated campaigns ({activated.length}/{campaigns.length})
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {campaigns.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={activated.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span className="text-neutral-700">{c.name}</span>
            <span className="font-mono text-[10px] text-neutral-400">
              {c.slug}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RankRow({
  rank,
  item,
  sourcesById,
}: {
  rank: number
  item: ComputedCard
  sourcesById: Record<string, CalcTestSourceInfo>
}) {
  return (
    <div className="rounded border border-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
        <span className="text-sm font-semibold tabular-nums text-neutral-500">
          #{rank}
        </span>
        <Link
          href={`/cards/${item.card.cardSlug}`}
          className="font-medium text-neutral-900 hover:underline"
        >
          {item.card.cardNameEn}
        </Link>
        <Badge tone="gray">{item.card.issuerSlug}</Badge>
        <span className="ml-auto text-base font-semibold tabular-nums text-neutral-900">
          HKD {item.result.rewardValueHkd.toFixed(2)}
        </span>
        <ConfidenceBadge score={item.result.confidenceScore} />
      </div>
      <div className="px-3 py-2">
        {item.result.breakdown.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No reward rules matched this transaction.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {item.result.breakdown.map((b) => {
              const src = b.sourceId ? sourcesById[b.sourceId] : undefined
              return (
                <li
                  key={b.ruleId}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-neutral-800">{b.ruleName}</div>
                    <div className="text-[11px] text-neutral-500">
                      <Badge tone="gray">{b.ruleType}</Badge>{" "}
                      {b.rewardUnits.toFixed(2)} {b.rewardCurrencySlug} · conf{" "}
                      {b.confidenceScore.toFixed(2)}
                      {src ? (
                        <>
                          {" · "}
                          <Link
                            href={`/sources/${src.slug}`}
                            className="text-sky-700 hover:underline"
                          >
                            {src.title}
                          </Link>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-neutral-700">
                    HKD {b.rewardHkd.toFixed(2)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {item.caveats.length > 0 ? (
          <ul className="mt-2 space-y-1 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
            {item.caveats.map((c, i) => (
              <li key={i}>⚠ {c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function ComparePanel({
  txn,
  cardA,
  cardB,
  sourcesById,
}: {
  txn: TransactionContext
  cardA: ComputedCard
  cardB: ComputedCard
  sourcesById: Record<string, CalcTestSourceInfo>
}) {
  const winnerSlug =
    cardA.result.rewardValueHkd >= cardB.result.rewardValueHkd
      ? cardA.card.cardSlug
      : cardB.card.cardSlug

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Why this lost — {cardA.card.cardNameEn} vs {cardB.card.cardNameEn}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <CompareColumn
            item={cardA}
            isWinner={cardA.card.cardSlug === winnerSlug}
            sourcesById={sourcesById}
          />
          <CompareColumn
            item={cardB}
            isWinner={cardB.card.cardSlug === winnerSlug}
            sourcesById={sourcesById}
          />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Transaction: HKD {txn.amountHkd}, category {txn.categorySlug ?? "—"},
          online {String(txn.isOnline)}, fx {String(txn.isForeignCurrency)},
          region {txn.countryRegion ?? "—"}.
        </p>
      </CardContent>
    </Card>
  )
}

function CompareColumn({
  item,
  isWinner,
  sourcesById,
}: {
  item: ComputedCard
  isWinner: boolean
  sourcesById: Record<string, CalcTestSourceInfo>
}) {
  return (
    <div className="rounded border border-neutral-200">
      <div
        className={cn(
          "flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5",
          isWinner ? "bg-emerald-50" : "bg-neutral-50",
        )}
      >
        <Link
          href={`/cards/${item.card.cardSlug}`}
          className="font-medium text-neutral-900 hover:underline"
        >
          {item.card.cardNameEn}
        </Link>
        <span className="ml-auto text-sm font-semibold tabular-nums text-neutral-900">
          HKD {item.result.rewardValueHkd.toFixed(2)}
        </span>
        {isWinner ? <Badge tone="green">winner</Badge> : null}
      </div>
      <ul className="divide-y divide-neutral-100 text-xs">
        {item.explanations.length === 0 ? (
          <li className="px-3 py-2 text-neutral-500">No approved rules on this card.</li>
        ) : (
          item.explanations.map((ex) => {
            const src = ex.rule.sourceId
              ? sourcesById[ex.rule.sourceId]
              : undefined
            return (
              <li key={ex.rule.ruleId} className="px-3 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <OutcomeIcon outcome={ex.outcome} />
                      <span className="font-medium text-neutral-800">
                        {ex.rule.ruleName}
                      </span>
                    </div>
                    <div className="ml-5 text-[11px] text-neutral-500">
                      <Badge tone="gray">{ex.rule.ruleType}</Badge>{" "}
                      {formulaSummary(formulaTypeOf(ex.rule), ex.rule.formula)}
                      {src ? (
                        <>
                          {" · "}
                          <Link
                            href={`/sources/${src.slug}`}
                            className="text-sky-700 hover:underline"
                          >
                            {src.slug}
                          </Link>
                        </>
                      ) : null}
                    </div>
                    <div className="ml-5 text-[11px] text-neutral-700">
                      {explainOutcome(ex.outcome)}
                    </div>
                  </div>
                  {ex.outcome.kind === "included" ? (
                    <span className="shrink-0 text-xs tabular-nums text-emerald-700">
                      +HKD {ex.outcome.rewardHkd.toFixed(2)}
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}

function OutcomeIcon({ outcome }: { outcome: RuleOutcome }) {
  if (outcome.kind === "included")
    return <span className="text-emerald-600">✓</span>
  if (outcome.kind === "needs_activation" || outcome.kind === "needs_selected_category" || outcome.kind === "needs_campaign_opt_in")
    return <span className="text-amber-500">○</span>
  if (outcome.kind === "excluded_by")
    return <span className="text-rose-600">⊘</span>
  return <span className="text-neutral-400">✗</span>
}

function ConfidenceBadge({ score }: { score: number }) {
  const level: "high" | "medium" | "low" =
    score >= 0.85 ? "high" : score >= 0.6 ? "medium" : "low"
  const tone = level === "high" ? "green" : level === "medium" ? "yellow" : "red"
  return <Badge tone={tone}>{level}</Badge>
}

// ─────────────────────────────────────────────────────────────────────────────
// Computation helpers

type ComputedCard = {
  card: CalcTestCard
  result: RewardResult
  caveats: string[]
  explanations: ReturnType<typeof explainCalculate>
}

function computeCard(
  card: CalcTestCard,
  txn: TransactionContext,
  ctx: PerCardContext,
): ComputedCard {
  const userCtx: UserCardContext = {
    cardId: card.cardSlug,
    activatedRuleIds: ctx.activatedRuleIds,
    activatedCampaignIds: ctx.activatedCampaignIds,
    selectedCategorySlugs: ctx.selectedCategorySlugs,
  }
  const result = calculate(card.cardSlug, card.rules, txn, userCtx)
  const explanations = explainCalculate(card.rules, txn, userCtx)
  const caveats = synthesizeCaveats({ txn, result, cardRules: card.rules })
  return { card, result, caveats, explanations }
}

function computeFromData(
  data: CalcTestData,
  slug: string | null,
  txn: TransactionContext,
  ctxMap: Record<string, PerCardContext>,
): ComputedCard {
  const card =
    data.cards.find((c) => c.cardSlug === slug) ??
    ({
      cardSlug: slug ?? "unknown",
      cardNameEn: "(missing)",
      cardNameZh: null,
      issuerSlug: "—",
      issuerNameEn: "—",
      rules: [],
    } as CalcTestCard)
  return computeCard(card, txn, ctxMap[card.cardSlug] ?? emptyCtx())
}

function compareStateFor(
  slug: string,
  pair: [string | null, string | null],
): "A" | "B" | null {
  if (pair[0] === slug) return "A"
  if (pair[1] === slug) return "B"
  return null
}

function triToBool(t: TriState): boolean | undefined {
  if (t === "true") return true
  if (t === "false") return false
  return undefined
}

function boolToTri(b: boolean | undefined): TriState {
  if (b === true) return "true"
  if (b === false) return "false"
  return "unknown"
}

function explainOutcome(o: RuleOutcome): string {
  switch (o.kind) {
    case "not_approved":
      return "Rule not approved."
    case "no_match_category":
      return `Category mismatch: rule needs ${o.ruleValue}, txn was ${o.txnValue ?? "(none)"}.`
    case "no_match_online":
      return `Online mismatch: rule needs ${o.ruleValue}, txn was ${strOrUnknown(o.txnValue)}.`
    case "no_match_overseas":
      return `Overseas mismatch: rule needs ${o.ruleValue}, txn was ${strOrUnknown(o.txnValue)}.`
    case "no_match_fx":
      return `FX mismatch: rule needs ${o.ruleValue}, txn was ${strOrUnknown(o.txnValue)}.`
    case "needs_activation":
      return "Rule requires opt-in / activation."
    case "needs_selected_category":
      return `Rule requires "${o.ruleCategory ?? "(none)"}" to be among the user's selected categories.`
    case "needs_campaign_opt_in":
      return "Rule belongs to a campaign that hasn't been opted into."
    case "excluded_by":
      return `Disabled by exclusion: ${o.byRuleName}.`
    case "zero_reward":
      return o.reason === "cap_exhausted"
        ? "Cap already exhausted for the period."
        : "Formula evaluated to 0 (or rule is an exclusion)."
    case "included":
      return `Applied — earned ${o.rewardUnits.toFixed(2)} units.`
  }
}

function strOrUnknown(v: boolean | undefined): string {
  if (v === undefined) return "unknown"
  return String(v)
}

// ResolvedRule.formula is the parsed payload but the type tag lives on the
// rule. The formulaSummary helper expects a string type — derive it from the
// discriminated union.
function formulaTypeOf(rule: { formula: { type: string } }): string {
  return rule.formula.type
}
