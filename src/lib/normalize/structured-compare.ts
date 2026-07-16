// Structured normalized comparison (§3B).
//
// Replaces the aggregator's `String(object)` array comparison (which turned
// every object into "[object Object]" so HK$500 cashback and HK$100 Octopus
// looked identical). Deep-compares two payloads and returns one of four
// relations:
//
//   equal          — same value everywhere they overlap, no extra info
//   more_complete  — one side fills in extra optional FIELDS; no disagreement
//   enrichment     — one side carries extra array COMPONENTS; no disagreement
//   conflict       — a real disagreement on a shared calculator-observed field
//
// Properties (all required by §3B):
//   1. field names normalized (perHkd == per_hkd == PerHKD)
//   2. numeric representations normalized ("100000.00" == 100000)
//   3. array ordering ignored
//   4. the four-way distinction above
//   5. a missing optional field is NEVER a contradiction
//   6. original payloads preserved on the result
//
// Reused by Stage 2 for welcome-offer component comparison — keep it payload-
// shape-agnostic (no hard-coded field lists beyond the identity discriminants
// used to match array components).

import { isNumericValue, normalizeNumeric, numbersAgree } from "./numeric"

export type CompareRelation =
  | "equal"
  | "more_complete"
  | "enrichment"
  | "conflict"

export interface ConflictDetail {
  path: string
  a: unknown
  b: unknown
  reason: "numeric" | "string" | "boolean" | "type" | "array-component"
}

export interface StructuredCompareResult {
  relation: CompareRelation
  // Which side carries strictly more information. null when equal or when the
  // only finding is a conflict.
  supersetSide: "a" | "b" | "both" | null
  conflicts: ConflictDetail[]
  // §3B point 6 — originals preserved verbatim.
  a: unknown
  b: unknown
}

export interface CompareOptions {
  // Canonicalized keys the comparison ignores entirely (informational text
  // the calculator never reads). The aggregator passes INFORMATIONAL_FIELDS.
  ignoreKeys?: ReadonlySet<string>
}

// Fields that IDENTIFY an array element as "the same component" across two
// sources (so a HK$500 tier lines up with a HK$500 tier, not a HK$100 one).
// Canonicalized. Element pairs that agree on these are the same component;
// disagreement on a non-identity field of a matched pair is a real conflict.
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "currency",
  "currencyslug",
  "type",
  "kind",
  "component",
  "offertype",
  "name",
  "categoryslug",
  "period",
  "basis",
  "minamounthkd",
  "minspendhkd",
  "withindays",
  "days",
  "tier",
])

interface WalkResult {
  conflicts: ConflictDetail[]
  aExtraFields: number
  bExtraFields: number
  aExtraComponents: number
  bExtraComponents: number
}

const EMPTY: WalkResult = {
  conflicts: [],
  aExtraFields: 0,
  bExtraFields: 0,
  aExtraComponents: 0,
  bExtraComponents: 0,
}

function merge(results: WalkResult[]): WalkResult {
  return results.reduce<WalkResult>(
    (acc, r) => ({
      conflicts: acc.conflicts.concat(r.conflicts),
      aExtraFields: acc.aExtraFields + r.aExtraFields,
      bExtraFields: acc.bExtraFields + r.bExtraFields,
      aExtraComponents: acc.aExtraComponents + r.aExtraComponents,
      bExtraComponents: acc.bExtraComponents + r.bExtraComponents,
    }),
    EMPTY,
  )
}

function conflict(
  path: string,
  a: unknown,
  b: unknown,
  reason: ConflictDetail["reason"],
): WalkResult {
  return { ...EMPTY, conflicts: [{ path, a, b, reason }] }
}

function isNil(v: unknown): boolean {
  return v === null || v === undefined
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function canonKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "")
}

// canonical-key → { key: original, value } for one object.
function canonMap(o: Record<string, unknown>): Map<string, { key: string; value: unknown }> {
  const m = new Map<string, { key: string; value: unknown }>()
  for (const [k, v] of Object.entries(o)) m.set(canonKey(k), { key: k, value: v })
  return m
}

// Stable normalized key for a scalar array element (for multiset matching).
function scalarKey(v: unknown): string {
  if (isNumericValue(v)) return `n:${normalizeNumeric(v)}`
  if (typeof v === "boolean") return `b:${v}`
  return `s:${String(v).trim().toLowerCase()}`
}

function isScalar(v: unknown): boolean {
  return !isPlainObject(v) && !Array.isArray(v)
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  opts: CompareOptions,
): WalkResult {
  if (isNil(a) && isNil(b)) return EMPTY
  // A missing / null value on one side is NOT a conflict — the other side
  // simply asserted more (§3B point 5).
  if (isNil(a)) return { ...EMPTY, bExtraFields: 1 }
  if (isNil(b)) return { ...EMPTY, aExtraFields: 1 }

  // Numeric (incl. numeric strings like "100000.00").
  if (isNumericValue(a) && isNumericValue(b)) {
    const na = normalizeNumeric(a)!
    const nb = normalizeNumeric(b)!
    return numbersAgree(na, nb) ? EMPTY : conflict(path, a, b, "numeric")
  }

  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
      ? EMPTY
      : conflict(path, a, b, "string")
  }

  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? EMPTY : conflict(path, a, b, "boolean")
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return walkArray(a, b, path, opts)
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    return walkObject(a, b, path, opts)
  }

  // Different shapes that we couldn't reconcile numerically → real conflict.
  return conflict(path, a, b, "type")
}

function walkObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  opts: CompareOptions,
): WalkResult {
  const am = canonMap(a)
  const bm = canonMap(b)
  const keys = new Set<string>([...am.keys(), ...bm.keys()])
  const results: WalkResult[] = []
  for (const ck of keys) {
    if (opts.ignoreKeys?.has(ck)) continue
    const ae = am.get(ck)
    const be = bm.get(ck)
    const childPath = path ? `${path}.${(ae ?? be)!.key}` : (ae ?? be)!.key
    if (ae && be) {
      results.push(walk(ae.value, be.value, childPath, opts))
    } else if (ae && !be) {
      results.push(isNil(ae.value) ? EMPTY : { ...EMPTY, aExtraFields: 1 })
    } else if (be && !ae) {
      results.push(isNil(be.value) ? EMPTY : { ...EMPTY, bExtraFields: 1 })
    }
  }
  return merge(results)
}

// True when two array elements are "the same component" (so a conflict on a
// value field is a real disagreement, not two separate components). Elements
// must share ≥1 identity key and agree on every shared identity key. When
// there is no identity overlap, they count as the same component only if a
// full walk finds no conflict.
function sameComponent(a: unknown, b: unknown, opts: CompareOptions): boolean {
  if (isPlainObject(a) && isPlainObject(b)) {
    const am = canonMap(a)
    const bm = canonMap(b)
    const sharedIdentity = [...IDENTITY_KEYS].filter(
      (k) => am.has(k) && bm.has(k),
    )
    if (sharedIdentity.length === 0) {
      return walk(a, b, "", opts).conflicts.length === 0
    }
    for (const k of sharedIdentity) {
      if (walk(am.get(k)!.value, bm.get(k)!.value, "", opts).conflicts.length > 0) {
        return false
      }
    }
    return true
  }
  return walk(a, b, "", opts).conflicts.length === 0
}

function score(w: WalkResult): number {
  return (
    w.conflicts.length * 1_000_000 +
    w.aExtraFields +
    w.bExtraFields +
    w.aExtraComponents +
    w.bExtraComponents
  )
}

function walkArray(
  a: unknown[],
  b: unknown[],
  path: string,
  opts: CompareOptions,
): WalkResult {
  // All-scalar arrays: order-insensitive multiset. Extra elements on either
  // side are enrichment, never a conflict (an exclusion scope of [dining] vs
  // [dining, hotel] is "one broader", not a contradiction).
  if (a.every(isScalar) && b.every(isScalar)) {
    const bCounts = new Map<string, number>()
    for (const v of b) bCounts.set(scalarKey(v), (bCounts.get(scalarKey(v)) ?? 0) + 1)
    let aExtra = 0
    for (const v of a) {
      const k = scalarKey(v)
      const c = bCounts.get(k) ?? 0
      if (c > 0) bCounts.set(k, c - 1)
      else aExtra += 1
    }
    let bExtra = 0
    for (const c of bCounts.values()) bExtra += c
    return {
      ...EMPTY,
      aExtraComponents: aExtra,
      bExtraComponents: bExtra,
    }
  }

  // Object/mixed arrays: greedily match each a-element to the best unused
  // b-element that is the same component. Unmatched elements are extra
  // components (enrichment). Matched pairs recurse — a value disagreement on
  // a matched pair is a real conflict.
  const usedB = new Array<boolean>(b.length).fill(false)
  const results: WalkResult[] = []
  a.forEach((ai, i) => {
    let bestJ = -1
    let bestW: WalkResult | null = null
    for (let j = 0; j < b.length; j++) {
      if (usedB[j]) continue
      if (!sameComponent(ai, b[j], opts)) continue
      const w = walk(ai, b[j], `${path}[${i}]`, opts)
      if (bestW === null || score(w) < score(bestW)) {
        bestW = w
        bestJ = j
      }
    }
    if (bestJ >= 0 && bestW) {
      usedB[bestJ] = true
      results.push(bestW)
    } else {
      results.push({ ...EMPTY, aExtraComponents: 1 })
    }
  })
  for (let j = 0; j < b.length; j++) {
    if (!usedB[j]) results.push({ ...EMPTY, bExtraComponents: 1 })
  }
  return merge(results)
}

export function compareStructured(
  a: unknown,
  b: unknown,
  opts: CompareOptions = {},
): StructuredCompareResult {
  const w = walk(a, b, "", opts)
  if (w.conflicts.length > 0) {
    return { relation: "conflict", supersetSide: null, conflicts: w.conflicts, a, b }
  }
  const aMore = w.aExtraFields + w.aExtraComponents > 0
  const bMore = w.bExtraFields + w.bExtraComponents > 0
  const hasComponentExtra = w.aExtraComponents + w.bExtraComponents > 0
  let relation: CompareRelation = "equal"
  let supersetSide: StructuredCompareResult["supersetSide"] = null
  if (aMore || bMore) {
    relation = hasComponentExtra ? "enrichment" : "more_complete"
    supersetSide = aMore && bMore ? "both" : aMore ? "a" : "b"
  }
  return { relation, supersetSide, conflicts: [], a, b }
}

// Boolean convenience for the aggregator's verdict: everything except a real
// conflict counts as "agrees" (equal / more_complete / enrichment). This
// preserves the current agree/contradict semantics while fixing the
// [object Object] array bug and the missing-optional-field false conflicts.
export function structuresAgree(
  a: unknown,
  b: unknown,
  opts: CompareOptions = {},
): boolean {
  return compareStructured(a, b, opts).relation !== "conflict"
}
