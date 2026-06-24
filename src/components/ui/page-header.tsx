import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between border-b border-neutral-200 px-6 py-4",
        className,
      )}
    >
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        {subtitle ? (
          <div className="mt-0.5 text-sm text-neutral-500">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  )
}
