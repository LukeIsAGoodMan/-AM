"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  resolveReviewTask,
  type ResolveAction,
  type ResolveResult,
} from "@/lib/actions/resolve-review-task"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// P6 — reviewer action panel. Drives `resolveReviewTask` for the five
// action kinds (approve / reject / mark_conflict / edit_canonical / reopen).
//
// Mirrors the EditRuleForm pattern: vanilla useState + useTransition,
// banner shows ok/error from the server action, page reloads after success
// so the new task / group / claim state is visible.
//
// UX rule: open tasks show the full action set; resolved/dismissed tasks
// only expose Reopen (so a misclick is recoverable without psql).

export function ReviewTaskActions({
  taskId,
  taskStatus,
  groupStatus,
  canonicalPayloadJson,
  hasGroup,
  resolutionNote,
  resolvedAt,
}: {
  taskId: string
  taskStatus: string
  groupStatus: string | null
  canonicalPayloadJson: string
  hasGroup: boolean
  resolutionNote: string | null
  resolvedAt: Date | null
}) {
  const isOpen = taskStatus === "open" || taskStatus === "in_progress"
  const [note, setNote] = useState("")
  const [canonicalDraft, setCanonicalDraft] = useState(canonicalPayloadJson)
  const [canonicalEditing, setCanonicalEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ResolveResult | null>(null)
  const router = useRouter()

  function run(action: ResolveAction) {
    setResult(null)
    startTransition(async () => {
      const res = await resolveReviewTask(taskId, action)
      setResult(res)
      if (res.ok) {
        // Refresh so the new status (resolved / conflict / etc.) shows up
        // in the header and the claim cards' status badges update.
        router.refresh()
        if (action.kind === "edit_canonical") setCanonicalEditing(false)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {result ? (
          <div
            className={cn(
              "rounded border px-3 py-2 text-sm",
              result.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800",
            )}
          >
            {result.ok ? result.message : result.error}
          </div>
        ) : null}

        {isOpen ? (
          <>
            <div>
              <label className="block text-xs font-medium text-neutral-600">
                Reviewer note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Reason for approval / rejection / conflict mark…"
                className={inputCls}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run({ kind: "approve", note: note.trim() || undefined })
                }
                className={btnPrimary}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run({ kind: "reject", note: note.trim() || undefined })
                }
                className={btnDanger}
              >
                Reject
              </button>
              {hasGroup && groupStatus !== "conflict" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run({
                      kind: "mark_conflict",
                      note: note.trim() || undefined,
                    })
                  }
                  className={btnWarn}
                >
                  Mark as conflict
                </button>
              ) : null}
            </div>

            {hasGroup ? (
              <div className="space-y-2 border-t border-neutral-200 pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-neutral-600">
                    Edit canonical payload
                  </label>
                  {!canonicalEditing ? (
                    <button
                      type="button"
                      className="text-xs text-sky-700 hover:underline"
                      onClick={() => setCanonicalEditing(true)}
                    >
                      edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-neutral-500 hover:underline"
                      onClick={() => {
                        setCanonicalEditing(false)
                        setCanonicalDraft(canonicalPayloadJson)
                      }}
                    >
                      cancel
                    </button>
                  )}
                </div>
                {canonicalEditing ? (
                  <>
                    <textarea
                      value={canonicalDraft}
                      onChange={(e) => setCanonicalDraft(e.target.value)}
                      rows={8}
                      className={cn(inputCls, "font-mono text-xs")}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run({
                          kind: "edit_canonical",
                          canonicalPayloadJson: canonicalDraft,
                          note: note.trim() || undefined,
                        })
                      }
                      className={btnSecondary}
                    >
                      Save canonical payload
                    </button>
                  </>
                ) : (
                  <p className="text-[11px] text-neutral-500">
                    Override the aggregator's canonical reading before
                    approving. Must be a JSON object. P7 will use the saved
                    canonical to materialize the reward_rule.
                  </p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-2">
            <div className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              Task <strong>{taskStatus}</strong>
              {resolvedAt ? (
                <> at {new Date(resolvedAt).toISOString().slice(0, 16).replace("T", " ")}</>
              ) : null}
              {resolutionNote ? (
                <div className="mt-1 italic text-neutral-600">
                  “{resolutionNote}”
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run({ kind: "reopen" })}
              className={btnSecondary}
            >
              Reopen task
            </button>
            <p className="text-[11px] text-neutral-500">
              Reopens the task and reverts the affected claims back to{" "}
              <code>pending_review</code>. Use for misclicks; the aggregator
              can re-decide if you re-run <code>pnpm p4:aggregate</code>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const inputCls =
  "mt-1 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none"

const btnBase =
  "rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
const btnPrimary = cn(btnBase, "bg-emerald-600 text-white hover:bg-emerald-700")
const btnDanger = cn(btnBase, "bg-rose-600 text-white hover:bg-rose-700")
const btnWarn = cn(btnBase, "bg-amber-500 text-white hover:bg-amber-600")
const btnSecondary = cn(
  btnBase,
  "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50",
)
