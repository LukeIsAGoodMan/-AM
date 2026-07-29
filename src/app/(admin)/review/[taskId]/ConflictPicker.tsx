"use client"

import { useState, useTransition } from "react"
import { resolveReviewTask } from "@/lib/actions/resolve-review-task"

export type ConflictVersion = {
  claimId: string
  payloadJson: string
  sourceTitle: string
  priorityLabel: string
  quote: string
  isSupporting: boolean
}

// The "placeholder with several versions" the PM asked for: each source's
// value is a selectable version. Picking one fills the editor; you can also
// type a value by hand (manual input). Apply writes it to the group's
// canonical payload (edit-gated), optionally approving → materializing a rule.
export function ConflictPicker({
  taskId,
  versions,
  currentCanonicalJson,
  canEdit,
}: {
  taskId: string
  versions: ConflictVersion[]
  currentCanonicalJson: string
  canEdit: boolean
}) {
  const [selected, setSelected] = useState<string>("__current__")
  const [draft, setDraft] = useState<string>(currentCanonicalJson)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function pick(id: string, json: string) {
    setSelected(id)
    setDraft(json)
    setMsg(null)
  }

  function validJson(): boolean {
    try {
      JSON.parse(draft)
      return true
    } catch (e) {
      setMsg({ ok: false, text: `Invalid JSON: ${(e as Error).message}` })
      return false
    }
  }

  function apply(alsoApprove: boolean) {
    if (!validJson()) return
    startTransition(async () => {
      const r1 = await resolveReviewTask(taskId, {
        kind: "edit_canonical",
        canonicalPayloadJson: draft,
      })
      if (!r1.ok) return setMsg({ ok: false, text: r1.error })
      if (!alsoApprove) return setMsg({ ok: true, text: "Canonical value updated." })
      const r2 = await resolveReviewTask(taskId, { kind: "approve" })
      setMsg(
        r2.ok
          ? { ok: true, text: r2.message }
          : { ok: false, text: r2.error },
      )
    })
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-amber-900">
          Resolve conflict — pick a version or enter your own
        </span>
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-1.5">
        {versions.map((v) => (
          <label
            key={v.claimId}
            className={`flex cursor-pointer gap-2 rounded border p-2 text-xs ${
              selected === v.claimId
                ? "border-amber-400 bg-white ring-1 ring-amber-300"
                : "border-neutral-200 bg-white/70 hover:border-neutral-300"
            }`}
          >
            <input
              type="radio"
              name="conflict-version"
              className="mt-0.5"
              checked={selected === v.claimId}
              onChange={() => pick(v.claimId, v.payloadJson)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1">
                <span
                  className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                    v.isSupporting ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                >
                  {v.isSupporting ? "supporting" : "outlier"}
                </span>
                <span className="text-neutral-500">{v.priorityLabel}</span>
                <span className="truncate text-neutral-700">· {v.sourceTitle}</span>
              </span>
              <span className="mt-1 block truncate font-mono text-[11px] text-neutral-800">
                {v.payloadJson.replace(/\s+/g, " ").slice(0, 120)}
              </span>
              {v.quote ? (
                <span className="mt-0.5 block truncate italic text-neutral-500">“{v.quote}”</span>
              ) : null}
            </span>
          </label>
        ))}

        <label
          className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-xs ${
            selected === "__manual__"
              ? "border-amber-400 bg-white ring-1 ring-amber-300"
              : "border-neutral-200 bg-white/70 hover:border-neutral-300"
          }`}
        >
          <input
            type="radio"
            name="conflict-version"
            checked={selected === "__manual__"}
            onChange={() => setSelected("__manual__")}
          />
          <span className="font-medium text-neutral-700">✎ Manual input (edit the JSON below)</span>
        </label>
      </div>

      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setSelected("__manual__")
          setMsg(null)
        }}
        spellCheck={false}
        rows={7}
        className="mt-2 w-full rounded border border-neutral-300 bg-white p-2 font-mono text-xs text-neutral-800"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canEdit || pending}
          onClick={() => apply(false)}
          className="rounded border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          Set as canonical
        </button>
        <button
          type="button"
          disabled={!canEdit || pending}
          onClick={() => apply(true)}
          className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Apply &amp; materialize → rule
        </button>
        {!canEdit ? (
          <span className="text-[11px] text-neutral-500">
            🔒 Unlock edit (top-right) to apply
          </span>
        ) : null}
        {msg ? (
          <span className={`text-[11px] ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}
