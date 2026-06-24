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
import type { RuleListRow } from "@/lib/queries/rules"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { formulaSummary } from "@/components/admin/formula-summary"
import { cn } from "@/lib/utils"

export function RulesTable({ rows }: { rows: RuleListRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState("")
  const [issuerFilter, setIssuerFilter] = useState("__all__")
  const [ruleTypeFilter, setRuleTypeFilter] = useState("__all__")
  const [statusFilter, setStatusFilter] = useState("__all__")
  const [onlineFilter, setOnlineFilter] = useState("__all__") // any / online / offline

  const issuers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.issuerSlug))).sort(),
    [rows],
  )
  const ruleTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.ruleType))).sort(),
    [rows],
  )
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((r) => r.status))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (issuerFilter !== "__all__" && r.issuerSlug !== issuerFilter)
        return false
      if (ruleTypeFilter !== "__all__" && r.ruleType !== ruleTypeFilter)
        return false
      if (statusFilter !== "__all__" && r.status !== statusFilter) return false
      if (onlineFilter === "online" && r.isOnline !== true) return false
      if (onlineFilter === "offline" && r.isOnline !== false) return false
      if (!s) return true
      return (
        r.ruleName.toLowerCase().includes(s) ||
        r.slug.toLowerCase().includes(s) ||
        r.cardNameEn.toLowerCase().includes(s)
      )
    })
  }, [rows, search, issuerFilter, ruleTypeFilter, statusFilter, onlineFilter])

  const columns = useMemo<ColumnDef<RuleListRow>[]>(
    () => [
      {
        id: "ruleName",
        accessorKey: "ruleName",
        header: "Rule",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/rules/${row.original.slug}`}
              className="font-medium text-neutral-900 hover:underline"
            >
              {row.original.ruleName}
            </Link>
            <div className="font-mono text-xs text-neutral-500">
              {row.original.slug}
            </div>
          </div>
        ),
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
            {row.original.cardNameEn}
            <div className="text-xs text-neutral-500">
              {row.original.issuerNameEn}
            </div>
          </Link>
        ),
      },
      {
        id: "ruleType",
        accessorKey: "ruleType",
        header: "Type",
        cell: ({ getValue }) => <Badge tone="gray">{getValue<string>()}</Badge>,
      },
      {
        id: "categorySlug",
        accessorKey: "categorySlug",
        header: "Category",
        cell: ({ getValue }) =>
          getValue<string | null>() ?? (
            <span className="text-neutral-400">—</span>
          ),
      },
      {
        id: "formula",
        accessorFn: (r) => formulaSummary(r.rewardFormulaType, r.rewardFormulaPayload),
        header: "Formula",
        cell: ({ row }) => (
          <span className="text-xs text-neutral-700">
            {formulaSummary(
              row.original.rewardFormulaType,
              row.original.rewardFormulaPayload,
            )}
          </span>
        ),
      },
      {
        id: "conditions",
        header: "Conditions",
        cell: ({ row }) => {
          const r = row.original
          const flags: string[] = []
          if (r.isOnline === true) flags.push("online")
          if (r.isOnline === false) flags.push("offline")
          if (r.isOverseas === true) flags.push("overseas")
          if (r.isOverseas === false) flags.push("local")
          if (r.isForeignCurrency === true) flags.push("FX")
          if (r.requiresActivation) flags.push("activation")
          if (r.requiresRegistration) flags.push("registration")
          return (
            <span className="text-xs text-neutral-600">
              {flags.length === 0 ? (
                <span className="text-neutral-400">—</span>
              ) : (
                flags.join(" · ")
              )}
            </span>
          )
        },
      },
      {
        id: "cap",
        header: "Cap",
        cell: ({ row }) => {
          const r = row.original
          if (!r.capAmountHkd) return <span className="text-neutral-400">—</span>
          return (
            <span className="text-xs text-neutral-700 tabular-nums">
              HK${Number(r.capAmountHkd).toLocaleString()}/{r.capPeriod}
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
        id: "confidence",
        accessorKey: "confidenceScore",
        header: "Conf",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs text-neutral-600">
            {Number(getValue<string>()).toFixed(2)}
          </span>
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
          placeholder="Search rule / card / slug…"
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
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <select
          value={ruleTypeFilter}
          onChange={(e) => setRuleTypeFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All rule types</option>
          {ruleTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={onlineFilter}
          onChange={(e) => setOnlineFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">Online: any</option>
          <option value="online">Online only</option>
          <option value="offline">Offline only</option>
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
                    No rules match the current filters.
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
