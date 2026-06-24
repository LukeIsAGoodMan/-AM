"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { saveRuleEdit, type EditRuleInput } from "@/lib/actions/edit-rule"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Vanilla state + Zod parse on submit (no react-hook-form — the field
// count is small and the syncer already owns the validation rules).
// On save the page reloads itself so the new DB state is visible.

const RULE_TYPES = [
  "base_earn",
  "category_bonus",
  "selected_category_bonus",
  "online_bonus",
  "overseas_bonus",
  "foreign_currency_bonus",
  "merchant_bonus",
  "campaign_bonus",
  "exclusion",
  "fee_waiver",
  "other",
]

const STACKING_POLICIES = ["additive", "max_only_in_group", "replaces_base"] as const

const CAP_PERIODS = [
  "transaction",
  "day",
  "month",
  "quarter",
  "year",
  "campaign",
  "none",
]

const CAP_BASES = ["spending", "reward", "transaction_count"]

type EditableRule = EditRuleInput

type Lookups = {
  currencies: { slug: string; nameEn: string }[]
  categories: { slug: string; nameEn: string }[]
  sources: { slug: string; title: string }[]
  campaigns: { slug: string; name: string }[]
}

export function EditRuleForm({
  rule,
  lookups,
}: {
  rule: EditableRule
  lookups: Lookups
}) {
  const [form, setForm] = useState<EditableRule>(rule)
  const [appliesToText, setAppliesToText] = useState(
    rule.appliesTo?.join(", ") ?? "",
  )
  const [result, setResult] = useState<{
    kind: "ok" | "error"
    msg: string
    detail?: string[]
  } | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function patch<K extends keyof EditableRule>(key: K, value: EditableRule[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)

    const payload: EditableRule = {
      ...form,
      appliesTo:
        appliesToText.trim() === ""
          ? null
          : appliesToText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
    }

    startTransition(async () => {
      const res = await saveRuleEdit(payload)
      if (res.ok) {
        setResult({
          kind: "ok",
          msg:
            res.updatedFields.length === 0
              ? "No changes to save."
              : `Saved. Updated ${res.updatedFields.length} field(s).`,
          detail: res.updatedFields,
        })
        router.refresh()
      } else {
        setResult({
          kind: "error",
          msg: res.error,
          detail: res.changedEconomicFields,
        })
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/rules/${rule.ruleSlug}`}
          className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium text-white",
            pending ? "bg-neutral-400" : "bg-neutral-900 hover:bg-neutral-700",
          )}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {result ? (
        <div
          className={cn(
            "rounded border px-3 py-2 text-sm",
            result.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800",
          )}
        >
          <div>{result.msg}</div>
          {result.detail && result.detail.length > 0 ? (
            <div className="mt-1 text-xs">
              {result.kind === "ok" ? "Changed: " : "Economic fields changed: "}
              <code>{result.detail.join(", ")}</code>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity + status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Rule name">
              <input
                value={form.ruleName}
                onChange={(e) => patch("ruleName", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field
              label="Status"
              hint="Approved + a source is required for the calculator to use this rule."
            >
              <select
                value={form.status}
                onChange={(e) =>
                  patch("status", e.target.value as EditableRule["status"])
                }
                className={inputCls}
              >
                <option value="draft">draft</option>
                <option value="approved">approved</option>
                <option value="archived">archived</option>
              </select>
            </Field>
            <Field label="Rule type" hint="Economic — gated on approved.">
              <select
                value={form.ruleType}
                onChange={(e) => patch("ruleType", e.target.value)}
                className={inputCls}
              >
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes">
              <textarea
                value={form.notes ?? ""}
                onChange={(e) => patch("notes", e.target.value || null)}
                rows={2}
                className={inputCls}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reward formula</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label="Payload JSON"
              hint="Discriminated union — schema validated on save. Example: {&quot;type&quot;:&quot;simple_percent&quot;,&quot;rate&quot;:0.04}"
            >
              <textarea
                value={form.rewardFormulaPayloadJson}
                onChange={(e) =>
                  patch("rewardFormulaPayloadJson", e.target.value)
                }
                rows={10}
                className={cn(inputCls, "font-mono text-xs")}
              />
            </Field>
            <Field label="Reward currency">
              <SlugSelect
                value={form.rewardCurrencySlug}
                onChange={(v) => patch("rewardCurrencySlug", v)}
                options={lookups.currencies}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conditions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Category">
              <SlugSelect
                value={form.categorySlug}
                onChange={(v) => patch("categorySlug", v)}
                options={lookups.categories}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Online">
                <TriSelect
                  value={form.isOnline}
                  onChange={(v) => patch("isOnline", v)}
                />
              </Field>
              <Field label="Overseas">
                <TriSelect
                  value={form.isOverseas}
                  onChange={(v) => patch("isOverseas", v)}
                />
              </Field>
              <Field label="FX">
                <TriSelect
                  value={form.isForeignCurrency}
                  onChange={(v) => patch("isForeignCurrency", v)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <CheckboxField
                label="Requires activation"
                value={form.requiresActivation}
                onChange={(v) => patch("requiresActivation", v)}
              />
              <CheckboxField
                label="Requires registration"
                value={form.requiresRegistration}
                onChange={(v) => patch("requiresRegistration", v)}
              />
              <CheckboxField
                label="Requires selected category"
                value={form.requiresSelectedCategory}
                onChange={(v) => patch("requiresSelectedCategory", v)}
              />
            </div>
            <Field
              label="Campaign"
              hint="Calculator skips this rule unless campaign is in user's activatedCampaignIds."
            >
              <SlugSelect
                value={form.campaignSlug}
                onChange={(v) => patch("campaignSlug", v)}
                options={lookups.campaigns.map((c) => ({
                  slug: c.slug,
                  nameEn: c.name,
                }))}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cap + stacking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cap amount (HKD)">
                <input
                  type="number"
                  step="0.01"
                  value={form.capAmountHkd ?? ""}
                  onChange={(e) =>
                    patch("capAmountHkd", e.target.value === "" ? null : e.target.value)
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Cap reward (units)">
                <input
                  type="number"
                  step="0.01"
                  value={form.capRewardAmount ?? ""}
                  onChange={(e) =>
                    patch("capRewardAmount", e.target.value === "" ? null : e.target.value)
                  }
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cap period">
                <SelectOrNull
                  value={form.capPeriod}
                  onChange={(v) => patch("capPeriod", v)}
                  options={CAP_PERIODS}
                />
              </Field>
              <Field label="Cap basis">
                <SelectOrNull
                  value={form.capBasis}
                  onChange={(v) => patch("capBasis", v)}
                  options={CAP_BASES}
                />
              </Field>
            </div>
            <Field label="Stacking policy">
              <select
                value={form.stackingPolicy}
                onChange={(e) =>
                  patch(
                    "stackingPolicy",
                    e.target.value as EditableRule["stackingPolicy"],
                  )
                }
                className={inputCls}
              >
                {STACKING_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Exclusive group">
                <input
                  value={form.exclusiveGroup ?? ""}
                  onChange={(e) =>
                    patch("exclusiveGroup", e.target.value || null)
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Priority">
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) =>
                    patch("priority", Number(e.target.value || 100))
                  }
                  className={inputCls}
                />
              </Field>
            </div>
            <Field
              label="Exclusion targets (comma-separated rule_types)"
              hint="Only for ruleType='exclusion'. Each value matches another rule's ruleType."
            >
              <input
                value={appliesToText}
                onChange={(e) => setAppliesToText(e.target.value)}
                className={inputCls}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Provenance + dates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field
              label="Source"
              hint="Required when status=approved. Drop-down shows sources scoped to this rule's card."
            >
              <SlugSelect
                value={form.sourceSlug}
                onChange={(v) => patch("sourceSlug", v)}
                options={lookups.sources.map((s) => ({
                  slug: s.slug,
                  nameEn: s.title,
                }))}
              />
            </Field>
            <Field label="Confidence score (0–1)">
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={form.confidenceScore}
                onChange={(e) =>
                  patch("confidenceScore", Number(e.target.value))
                }
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Effective start">
                <input
                  type="date"
                  value={form.effectiveStart ?? ""}
                  onChange={(e) =>
                    patch("effectiveStart", e.target.value || null)
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Effective end">
                <input
                  type="date"
                  value={form.effectiveEnd ?? ""}
                  onChange={(e) =>
                    patch("effectiveEnd", e.target.value || null)
                  }
                  className={inputCls}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reminder</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-600">
              YAML in <code>data/</code> is the source of truth. Edits here
              live only in the DB; running <code>pnpm import:data</code> will
              revert them if the same change isn't also in the YAML.
            </p>
            <p className="mt-2 text-sm text-neutral-600">
              <Badge tone="yellow">approved rules</Badge> refuse silent
              economic changes — if you change a rate, condition, cap,
              stacking policy, or campaign id on an approved rule, demote it
              to <code>draft</code> first, or rename the slug in YAML and
              re-import.
            </p>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

const inputCls =
  "w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none"

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
      <label className="block text-xs font-medium text-neutral-600">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p>
      ) : null}
    </div>
  )
}

function CheckboxField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-1.5 text-xs text-neutral-700">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  )
}

function TriSelect({
  value,
  onChange,
}: {
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <select
      value={value === null ? "__null__" : String(value)}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === "__null__" ? null : v === "true")
      }}
      className={inputCls}
    >
      <option value="__null__">— (any)</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  )
}

function SlugSelect({
  value,
  onChange,
  options,
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: { slug: string; nameEn: string }[]
}) {
  return (
    <select
      value={value ?? "__null__"}
      onChange={(e) =>
        onChange(e.target.value === "__null__" ? null : e.target.value)
      }
      className={inputCls}
    >
      <option value="__null__">— (none)</option>
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.slug} {o.nameEn ? `— ${o.nameEn}` : ""}
        </option>
      ))}
    </select>
  )
}

function SelectOrNull({
  value,
  onChange,
  options,
}: {
  value: string | null
  onChange: (v: string | null) => void
  options: string[]
}) {
  return (
    <select
      value={value ?? "__null__"}
      onChange={(e) =>
        onChange(e.target.value === "__null__" ? null : e.target.value)
      }
      className={inputCls}
    >
      <option value="__null__">— (none)</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
