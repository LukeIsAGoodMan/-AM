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
import type { CardListRow } from "@/lib/queries/cards"
import { StatusBadge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function CardsTable({ rows }: { rows: CardListRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "status", desc: false },
    { id: "issuerSlug", desc: false },
  ])
  const [search, setSearch] = useState("")
  const [issuerFilter, setIssuerFilter] = useState<string>("__all__")
  const [statusFilter, setStatusFilter] = useState<string>("__all__")

  const issuers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.issuerSlug))).sort(),
    [rows],
  )
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (issuerFilter !== "__all__" && r.issuerSlug !== issuerFilter) return false
      if (statusFilter !== "__all__" && r.status !== statusFilter) return false
      if (!s) return true
      return (
        r.cardNameEn.toLowerCase().includes(s) ||
        (r.cardNameZh?.toLowerCase().includes(s) ?? false) ||
        r.slug.toLowerCase().includes(s)
      )
    })
  }, [rows, search, issuerFilter, statusFilter])

  const columns = useMemo<ColumnDef<CardListRow>[]>(
    () => [
      {
        id: "cardNameEn",
        accessorKey: "cardNameEn",
        header: "Card",
        cell: ({ row }) => (
          <Link
            href={`/cards/${row.original.slug}`}
            className="font-medium text-neutral-900 hover:underline"
          >
            {row.original.cardNameEn}
            {row.original.cardNameZh ? (
              <span className="ml-2 text-xs text-neutral-500">
                {row.original.cardNameZh}
              </span>
            ) : null}
          </Link>
        ),
      },
      { id: "issuerSlug", accessorKey: "issuerNameEn", header: "Issuer" },
      {
        id: "network",
        accessorKey: "network",
        header: "Network",
        cell: ({ getValue }) =>
          getValue<string | null>() ?? <span className="text-neutral-400">—</span>,
      },
      {
        id: "annualFeeHkd",
        accessorKey: "annualFeeHkd",
        header: "Annual fee",
        cell: ({ getValue }) => {
          const v = getValue<string | null>()
          if (!v) return <span className="text-neutral-400">—</span>
          const n = Number(v)
          if (Number.isNaN(n)) return v
          return n === 0 ? "Free" : `HKD ${n.toLocaleString()}`
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
      },
      {
        id: "approvedRuleCount",
        accessorFn: (r) => `${r.approvedRuleCount}/${r.ruleCount}`,
        header: "Rules (approved / total)",
        cell: ({ row }) => (
          <span className="tabular-nums">
            <strong>{row.original.approvedRuleCount}</strong>
            <span className="text-neutral-400"> / {row.original.ruleCount}</span>
          </span>
        ),
      },
      {
        id: "sourceCount",
        accessorKey: "sourceCount",
        header: "Sources",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{getValue<number>()}</span>
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
          placeholder="Search by name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-neutral-200 bg-white px-2 py-1 text-sm shadow-sm focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={issuerFilter}
          onChange={(e) => setIssuerFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All issuers</option>
          {issuers.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
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
                        {{
                          asc: "↑",
                          desc: "↓",
                        }[h.column.getIsSorted() as string] ?? null}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2">
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
                    No cards match the current filters.
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
