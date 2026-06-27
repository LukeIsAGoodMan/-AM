"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import type { ReviewTaskRow } from "@/lib/queries/review-tasks"
import { Badge, StatusBadge, type BadgeTone } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// P5 — review queue table. Mirrors RulesTable / SourcesTable conventions:
// client-side filtering on small-to-mid datasets, dense one-row-per-task
// layout, links into card / group detail (group detail is P6).
//
// Default view = open tasks. The "Status" filter exposes resolved /
// dismissed for audit, but reviewers usually only care about open.

const PRIORITY_TONE: Record<string, BadgeTone> = {
  blocker: "red",
  high: "red",
  normal: "blue",
  low: "gray",
}

const TASK_TYPE_TONE: Record<string, BadgeTone> = {
  conflict_resolution: "red",
  cross_check_confirmation: "green",
  claim_review: "yellow",
}

function shortDate(d: Date | null): string {
  if (!d) return "—"
  const date = typeof d === "string" ? new Date(d) : d
  return date.toISOString().slice(0, 10)
}

export function ReviewQueueTable({ rows }: { rows: ReviewTaskRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState("")
  // Default: just open tasks. Reviewers can opt into the wider view.
  const [statusFilter, setStatusFilter] = useState("open")
  const [taskTypeFilter, setTaskTypeFilter] = useState("__all__")
  const [priorityFilter, setPriorityFilter] = useState("__all__")
  const [cardFilter, setCardFilter] = useState("__all__")

  const cardSlugs = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cardSlug))).sort(),
    [rows],
  )
  const taskTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.taskType))).sort(),
    [rows],
  )
  const priorities = useMemo(
    () => Array.from(new Set(rows.map((r) => r.priority))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== "__all__" && r.status !== statusFilter) return false
      if (taskTypeFilter !== "__all__" && r.taskType !== taskTypeFilter)
        return false
      if (priorityFilter !== "__all__" && r.priority !== priorityFilter)
        return false
      if (cardFilter !== "__all__" && r.cardSlug !== cardFilter) return false
      if (!s) return true
      return (
        r.title.toLowerCase().includes(s) ||
        r.cardSlug.toLowerCase().includes(s) ||
        r.cardNameEn.toLowerCase().includes(s) ||
        (r.claimType?.toLowerCase().includes(s) ?? false) ||
        (r.keyDimension?.toLowerCase().includes(s) ?? false)
      )
    })
  }, [rows, search, statusFilter, taskTypeFilter, priorityFilter, cardFilter])

  const columns = useMemo<ColumnDef<ReviewTaskRow>[]>(
    () => [
      {
        id: "priority",
        accessorKey: "priority",
        header: "Pri",
        cell: ({ getValue }) => {
          const v = getValue<string>()
          return <Badge tone={PRIORITY_TONE[v] ?? "default"}>{v}</Badge>
        },
      },
      {
        id: "taskType",
        accessorKey: "taskType",
        header: "Task",
        cell: ({ getValue }) => {
          const v = getValue<string>()
          // Compact label — the full type is long.
          const label =
            v === "conflict_resolution"
              ? "conflict"
              : v === "cross_check_confirmation"
                ? "confirm"
                : v === "claim_review"
                  ? "review"
                  : v
          return <Badge tone={TASK_TYPE_TONE[v] ?? "default"}>{label}</Badge>
        },
      },
      {
        id: "card",
        accessorKey: "cardNameEn",
        header: "Card",
        cell: ({ row }) => (
          <Link
            href={`/cards/${row.original.cardSlug}`}
            className="text-sm text-neutral-700 hover:underline"
          >
            <div className="font-medium text-neutral-900">
              {row.original.cardNameEn}
            </div>
            <div className="text-xs text-neutral-500">
              {row.original.issuerNameEn}
            </div>
          </Link>
        ),
      },
      {
        id: "claimType",
        accessorKey: "claimType",
        header: "Claim type",
        cell: ({ getValue }) =>
          getValue<string | null>() ? (
            <Badge tone="gray">{getValue<string>()}</Badge>
          ) : (
            <span className="text-neutral-400">—</span>
          ),
      },
      {
        id: "keyDimension",
        accessorKey: "keyDimension",
        header: "Dimension",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-neutral-700">
            {getValue<string | null>() ?? "—"}
          </span>
        ),
      },
      {
        id: "groupStatus",
        accessorKey: "groupStatus",
        header: "Verdict",
        cell: ({ row }) => {
          const s = row.original.groupStatus
          if (!s) return <span className="text-neutral-400">—</span>
          return <StatusBadge status={s} />
        },
      },
      {
        id: "support",
        header: "Supp / Cont",
        cell: ({ row }) => {
          const r = row.original
          return (
            <span className="text-xs text-neutral-700 tabular-nums">
              <span className="text-emerald-700">{r.supportingCount}</span>
              {" / "}
              <span
                className={cn(
                  r.contradictingCount > 0
                    ? "text-rose-700 font-semibold"
                    : "text-neutral-400",
                )}
              >
                {r.contradictingCount}
              </span>
            </span>
          )
        },
      },
      {
        id: "aggregateConfidence",
        accessorKey: "aggregateConfidence",
        header: "Conf",
        cell: ({ getValue }) => {
          const v = getValue<string | null>()
          if (v === null) return <span className="text-neutral-400">—</span>
          return (
            <span className="tabular-nums text-xs text-neutral-700">
              {Number(v).toFixed(2)}
            </span>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
      },
      {
        id: "created",
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs text-neutral-500 tabular-nums">
            {shortDate(getValue<Date | null>())}
          </span>
        ),
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) =>
          row.original.groupId ? (
            <Link
              href={`/review/${row.original.taskId}`}
              className="text-xs font-medium text-sky-700 hover:underline"
            >
              open →
            </Link>
          ) : (
            <span className="text-neutral-300">—</span>
          ),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <input
          type="text"
          placeholder="Search title / card / dimension…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-neutral-200 bg-white px-2 py-1 text-sm shadow-sm focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          value={taskTypeFilter}
          onChange={(e) => setTaskTypeFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All types</option>
          {taskTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All priorities</option>
          {priorities.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={cardFilter}
          onChange={(e) => setCardFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All cards</option>
          {cardSlugs.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="ml-auto text-xs text-neutral-500">
          {filtered.length} of {rows.length}
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      onClick={h.column.getToggleSortingHandler()}
                      className={cn(
                        "border-b border-neutral-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500",
                        h.column.getCanSort() && "cursor-pointer select-none",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: "↑", desc: "↓" }[
                          h.column.getIsSorted() as string
                        ] ?? null}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-top">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-6 text-center text-sm text-neutral-500"
                  >
                    No tasks match the current filters. Try widening status
                    to "All statuses".
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
