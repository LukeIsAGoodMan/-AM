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
import type { SourceListRow } from "@/lib/queries/sources"
import { Badge, StatusBadge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function SourcesTable({ rows }: { rows: SourceListRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState("")
  const [sourceTypeFilter, setSourceTypeFilter] = useState("__all__")
  const [extractionFilter, setExtractionFilter] = useState("__all__") // ok / failed / pending

  const sourceTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.sourceType))).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (sourceTypeFilter !== "__all__" && r.sourceType !== sourceTypeFilter)
        return false
      if (extractionFilter === "ok" && (r.extractionFailed || r.extractedChars === 0))
        return false
      if (extractionFilter === "failed" && !r.extractionFailed) return false
      if (
        extractionFilter === "pending" &&
        (r.extractionFailed || r.extractedChars > 0)
      )
        return false
      if (!s) return true
      return (
        r.title.toLowerCase().includes(s) ||
        r.slug.toLowerCase().includes(s) ||
        (r.url?.toLowerCase().includes(s) ?? false)
      )
    })
  }, [rows, search, sourceTypeFilter, extractionFilter])

  const columns = useMemo<ColumnDef<SourceListRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Source",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/sources/${row.original.slug}`}
              className="font-medium text-neutral-900 hover:underline"
            >
              {row.original.title}
            </Link>
            <div className="font-mono text-xs text-neutral-500">
              {row.original.slug}
            </div>
          </div>
        ),
      },
      {
        id: "card",
        header: "Card / issuer",
        cell: ({ row }) => {
          const r = row.original
          if (r.cardSlug && r.cardNameEn) {
            return (
              <Link
                href={`/cards/${r.cardSlug}`}
                className="text-sm text-neutral-700 hover:underline"
              >
                {r.cardNameEn}
                <div className="text-xs text-neutral-500">{r.issuerNameEn}</div>
              </Link>
            )
          }
          return (
            <span className="text-sm text-neutral-700">
              {r.issuerNameEn ?? "—"}
              <div className="text-xs text-neutral-500">(issuer-wide)</div>
            </span>
          )
        },
      },
      {
        id: "sourceType",
        accessorKey: "sourceType",
        header: "Type",
        cell: ({ getValue }) => <Badge tone="blue">{getValue<string>()}</Badge>,
      },
      {
        id: "sourcePriority",
        accessorKey: "sourcePriority",
        header: "Priority",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-xs">P{getValue<number>()}</span>
        ),
      },
      {
        id: "language",
        accessorKey: "language",
        header: "Lang",
        cell: ({ getValue }) => (
          <span className="text-xs text-neutral-600">{getValue<string>()}</span>
        ),
      },
      {
        id: "extraction",
        header: "Extraction",
        cell: ({ row }) => {
          const r = row.original
          if (r.extractionFailed)
            return <Badge tone="red">failed</Badge>
          if (r.extractedChars > 0) {
            return (
              <span className="flex items-center gap-1.5">
                <Badge tone="green">
                  {r.extractedChars.toLocaleString()} chars
                </Badge>
                <span className="text-xs text-neutral-500">
                  {r.chunkCount} chunks
                </span>
              </span>
            )
          }
          return <Badge tone="yellow">not attempted</Badge>
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => <StatusBadge status={getValue<string>()} />,
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
          placeholder="Search title / slug / url…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-neutral-200 bg-white px-2 py-1 text-sm shadow-sm focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">All source types</option>
          {sourceTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={extractionFilter}
          onChange={(e) => setExtractionFilter(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        >
          <option value="__all__">Extraction: any</option>
          <option value="ok">Extracted ok</option>
          <option value="failed">Failed</option>
          <option value="pending">Not attempted</option>
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
                    No sources match the current filters.
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
