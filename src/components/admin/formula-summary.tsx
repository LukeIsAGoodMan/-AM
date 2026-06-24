// Short, eyeballable summary per reward_formula variant. Used in both the
// card detail page and the rules list/detail pages so the rendering stays
// consistent.

export function formulaSummary(
  type: string,
  payload: unknown,
): string {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (type) {
    case "simple_percent":
      return `${((Number(p.rate) || 0) * 100).toFixed(2)}%`
    case "points_per_hkd":
      return `${p.points ?? "?"} ${p.currencySlug ?? "pts"} per HK$${p.perHkd ?? "?"}`
    case "tiered_percent":
    case "tiered_points": {
      const tiers = Array.isArray(p.tiers) ? p.tiers.length : 0
      return `${tiers} tiers, accrual: ${p.accrualPeriod ?? "?"}`
    }
    case "no_reward":
      return `0 — ${p.reason ?? "no reward"}`
    case "fixed_bonus":
      return `${p.amount} ${p.currencySlug ?? "units"}`
    default:
      return type
  }
}

export function FormulaSummary({
  type,
  payload,
}: {
  type: string
  payload: unknown
}) {
  return (
    <span className="text-xs text-neutral-700">
      <span className="text-neutral-400">formula:</span>{" "}
      {formulaSummary(type, payload)}
    </span>
  )
}
