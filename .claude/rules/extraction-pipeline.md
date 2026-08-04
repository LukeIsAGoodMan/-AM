---
paths:
  - "src/lib/extraction/**"
  - "src/lib/normalize/**"
  - "scripts/p2-dry-run.ts"
  - "scripts/p3-run-extraction.ts"
  - "scripts/p4-aggregate.ts"
  - "scripts/p7-materialize.ts"
  - "scripts/materialize-canary.ts"
  - "scripts/audit-diff.ts"
  - "scripts/reject-claim.ts"
---

# Extraction / cross-check pipeline (Phase 2 + Stage 1A)

Flow: **source chunks → LLM extract (`p3`) → cross-check aggregate (`p4`) → human review →
materialize (`p7`) → `reward_rules`**. Spec: `docs/stage-1a-spec.md`. Decisions: D11–D29.
`docs/roadmap.md` does **not** cover this work — trust the spec + decisions + git log.

**Core principle: the LLM extracts; humans approve.** An LLM never writes to `reward_rules`
directly. Claims flow through cross-check verdicts and the `/review` queue first.

## Blocking rules (do not violate)

- **Canary is the only Stage 1A write path, dry-run by default.** `scripts/materialize-canary.ts`
  needs THREE deliberate flags to write: `--enable-write` **and** an on-allowlist `--card-slug`
  (**Amex Explorer / Blue Cash only**) **and** `--max-write-count N`. The pure gates live in
  `src/lib/extraction/canary.ts` and are unit-tested — don't weaken them (D29, spec §12).
- **Never run full-DB materialization**, and never re-run `p3`/`p4`/`p7` on non-canary cards.
  "Do NOT allow an accidental Stage 1A command to update all cards" (spec §12).
- **Never auto-reject conflicts; preserve outliers.** Conflicting standard claims (e.g. the
  HK$9,500 annual-fee outlier) are retained for investigation, not deleted (D25/D29). Don't
  silently resolve a material conflict.
- **Provisional publication, never silent `auto`.** Even a clean official match publishes as
  `provisional_pending_review` with a review task; legacy rows default to `legacy_unverified`.
  The 7 publish-authority states are in `src/lib/publication.ts` (D28).
- **"Don't take the first positive number" (§3E).** Annual fee: classify by cardholderType /
  feeKind / effectiveScope first; only `primary + standard_annual_fee + current` may set
  `cards.annual_fee_hkd`. HK$0 = first-year *waiver*, never a conflicting standard fee (D25).
- **Don't normalize ratios by numeric size**, don't hardcode HSBC 2.4%/3.6%, and don't treat an
  Asia-Miles→HKD value as an issuer fact (spec §12). Off-taxonomy currency slugs are refused by
  the materializer/calculator FK guard (D19) — add the slug to `data/reward_currencies/` or
  reclassify; never insert a rule with a NULL currency for a `points_per_hkd` formula.

Pipeline runs cost real LLM spend and mutate DB state — treat every `p3`/`p4`/`p7`/canary
invocation as a deliberate, reviewed action, and snapshot with `scripts/audit-diff.ts`.
