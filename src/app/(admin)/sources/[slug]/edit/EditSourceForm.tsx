"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { saveSourceEdit, type EditSourceInput } from "@/lib/actions/edit-source"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const SOURCE_TYPES = [
  "official_page",
  "official_pdf_tc",
  "official_app_screenshot",
  "official_open_api",
  "competitor_page",
  "forum_post",
  "reddit_post",
  "lihkg_post",
  "user_submission",
  "manual_note",
]

const LANGUAGES = ["en", "zh_hk", "zh_cn", "mixed", "unknown"]
const STATUSES = ["active", "archived", "needs_recheck"]

export function EditSourceForm({ source }: { source: EditSourceInput }) {
  const [form, setForm] = useState<EditSourceInput>(source)
  const [result, setResult] = useState<{ kind: "ok" | "error"; msg: string } | null>(
    null,
  )
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function patch<K extends keyof EditSourceInput>(
    key: K,
    value: EditSourceInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)
    startTransition(async () => {
      const res = await saveSourceEdit(form)
      if (res.ok) {
        setResult({
          kind: "ok",
          msg:
            res.updatedFields.length === 0
              ? "No changes to save."
              : `Saved. Updated: ${res.updatedFields.join(", ")}.`,
        })
        router.refresh()
      } else {
        setResult({ kind: "error", msg: res.error })
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/sources/${source.sourceSlug}`}
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
          {result.msg}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Source metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => patch("title", e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <select
                value={form.sourceType}
                onChange={(e) => patch("sourceType", e.target.value)}
                className={inputCls}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Priority (1=highest)"
              hint="Bands: 1–2 official, 3–4 official PDFs / app, 5–6 competitor / forum, 7–8 user."
            >
              <input
                type="number"
                min="1"
                max="8"
                value={form.sourcePriority}
                onChange={(e) =>
                  patch("sourcePriority", Number(e.target.value || 5))
                }
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="URL">
            <input
              value={form.url ?? ""}
              onChange={(e) => patch("url", e.target.value || null)}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Language">
              <select
                value={form.language}
                onChange={(e) => patch("language", e.target.value)}
                className={inputCls}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => patch("status", e.target.value)}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => patch("notes", e.target.value || null)}
              rows={3}
              className={inputCls}
            />
          </Field>
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-500">
        Extracted text, content hash, and retrieval timestamp are owned by{" "}
        <code>pnpm extract:sources</code> — not editable here. Same caveat as
        rules: YAML in <code>data/</code> is the source of truth; this form is
        an escape hatch.
      </p>
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
