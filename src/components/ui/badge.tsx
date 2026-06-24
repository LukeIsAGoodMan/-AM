import { cn } from "@/lib/utils"

const tones = {
  default: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  yellow: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  gray: "bg-neutral-50 text-neutral-500 ring-neutral-200",
} as const

export type BadgeTone = keyof typeof tones

export function Badge({
  tone = "default",
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

// Convention-mapped helper for the workflow status enum.
export function StatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "active" || status === "approved"
      ? "green"
      : status === "draft" || status === "pending_review"
        ? "yellow"
        : status === "archived" || status === "discontinued"
          ? "gray"
          : status === "rejected" || status === "conflict"
            ? "red"
            : "default"
  return <Badge tone={tone}>{status}</Badge>
}
