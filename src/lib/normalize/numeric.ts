// Numeric + percentage normalization (§3B point 1 · §4).
//
// Postgres `numeric` columns come back as strings ("100000.00"); YAML gives
// real numbers; the extractor sometimes emits "1,200" or "1.2%". Comparisons
// must treat these as the same value without ever guessing direction from
// magnitude (that guessing rule is forbidden by §4B — see ratio.ts).

// Values within ±5% count as agreeing (mirrors the aggregator's PRD §22.6
// tolerance). Below the absolute floor we require near-exact equality so a
// "5% of 0" check doesn't always pass.
export const NUMERIC_RELATIVE_TOLERANCE = 0.05
export const NUMERIC_ABSOLUTE_FLOOR = 0.001

// Coerce to a finite number, or null. Strips thousands separators. Does NOT
// interpret a trailing "%" — that is percentage semantics, handled by
// normalizePercentString so a bare "50" is never silently divided by 100.
export function normalizeNumeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string") {
    const t = v.trim().replace(/,/g, "")
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// True when the raw value is numeric (a number, or a string that parses to
// one). Used to decide whether two values should be compared numerically vs
// as strings.
export function isNumericValue(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v)
  if (typeof v === "string") return normalizeNumeric(v) !== null
  return false
}

export function numbersAgree(
  a: number,
  b: number,
  relTol: number = NUMERIC_RELATIVE_TOLERANCE,
  floor: number = NUMERIC_ABSOLUTE_FLOOR,
): boolean {
  const denom = Math.max(Math.abs(a), Math.abs(b), floor)
  return Math.abs(a - b) / denom <= relTol
}

// Parse an explicit percentage STRING ("1.2%") into a fraction (0.012).
// Returns null when the string carries no "%" — the caller must not assume a
// bare number is a percent. Kept separate from normalizeNumeric on purpose.
export function normalizePercentString(v: unknown): number | null {
  if (typeof v !== "string") return null
  const m = v.trim().match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  return m ? Number(m[1]) / 100 : null
}
