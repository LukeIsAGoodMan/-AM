import type { ResolvedCandidate } from "./resolved-rule"

// PRD §8.2 step 5.
//
// Group candidates by exclusive_group (or the rule's own id if it's not in
// any group), then apply the group's stacking policy:
//
//   additive            — keep all candidates in the group
//   max_only_in_group   — keep the one with the highest HKD value (tiebreak: priority asc)
//   replaces_base       — drop any base_earn candidates already selected,
//                         then add this group's candidates
//
// Groups are iterated by ascending priority (lower number first), making
// `replaces_base` deterministic — base earn must have been added before the
// replacement group's iteration replaces it.

export function resolveStacking(
  candidates: ResolvedCandidate[],
): ResolvedCandidate[] {
  if (candidates.length === 0) return candidates

  const groups = new Map<string, ResolvedCandidate[]>()
  for (const c of candidates) {
    const key = c.rule.exclusiveGroup ?? `__rule__${c.rule.ruleId}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(c)
    else groups.set(key, [c])
  }

  const ordered = [...groups.values()].sort(
    (a, b) => groupPriority(a) - groupPriority(b),
  )

  let selected: ResolvedCandidate[] = []
  for (const group of ordered) {
    const policy = group[0]?.rule.stackingPolicy ?? "additive"
    switch (policy) {
      case "additive":
        selected.push(...group)
        break
      case "max_only_in_group":
        selected.push(pickMax(group))
        break
      case "replaces_base":
        selected = selected.filter((c) => c.rule.ruleType !== "base_earn")
        selected.push(...group)
        break
    }
  }

  return selected
}

function groupPriority(group: ResolvedCandidate[]): number {
  let min = Number.POSITIVE_INFINITY
  for (const c of group) {
    if (c.rule.priority < min) min = c.rule.priority
  }
  return min
}

function pickMax(group: ResolvedCandidate[]): ResolvedCandidate {
  let best = group[0]
  if (!best) {
    throw new Error("pickMax called on empty group")
  }
  for (let i = 1; i < group.length; i++) {
    const c = group[i]
    if (!c) continue
    if (c.rewardHkd > best.rewardHkd) {
      best = c
    } else if (c.rewardHkd === best.rewardHkd && c.rule.priority < best.rule.priority) {
      best = c
    }
  }
  return best
}
