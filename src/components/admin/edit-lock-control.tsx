"use client"

import { useState, useTransition } from "react"
import { unlockEdit, lockEdit } from "@/lib/actions/edit-auth"

// Top-bar control: enter the shared password to unlock edit mode (sets a
// signed cookie), or lock it again. Viewing never needs this — only the
// mutating server actions check the cookie.
export function EditLockControl({ unlocked }: { unlocked: boolean }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (unlocked) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
          🔓 Edit unlocked
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => { await lockEdit() })}
          className="rounded border border-neutral-300 px-2 py-0.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          Lock
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const res = await unlockEdit(password)
          if (!res.ok) setError(res.error ?? "Failed")
          else setPassword("")
        })
      }}
    >
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-500">
        🔒 View only
      </span>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="edit password"
        className="w-32 rounded border border-neutral-300 px-2 py-0.5"
        autoComplete="off"
      />
      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="rounded bg-neutral-900 px-2 py-0.5 font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        Unlock edit
      </button>
      {error ? <span className="text-rose-600">{error}</span> : null}
    </form>
  )
}
