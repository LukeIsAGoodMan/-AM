// Phase 2 — RESERVED, do not implement during MVP.
// When the time comes, define (per PRD §22.5):
//   - source_claims          (one row per source per claim)
//   - extraction_runs        (one row per LLM extraction job)
//   - cross_check_groups     (per-card per-claim_type cluster + verdict)
//   - review_tasks           (human work items for approve/reject/conflict)
//   - reward_rule_sources    (join table: rule → all supporting sources)
//
// Physical isolation rule: Phase 2 tables may reference catalog tables
// (cards, source_documents, reward_rules) but catalog tables MUST NOT
// reference Phase 2 tables. This keeps MVP code from accidentally
// depending on extraction infrastructure.

export {}
