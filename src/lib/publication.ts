// Stage 1A (P18 · D28) — controlled publication states.
//
// Every materialized reward_rule and every card annual-fee value now carries
// an explicit authority state, so the system NEVER falsely claims a legacy
// spreadsheet value or a historically materialized rule passed the new
// authority policy (spec §3G).
//
// CRITICAL: migration 0014 backfills existing rows to `legacy_unverified`,
// NOT `auto`. Legacy rows stay calculator-active for backward compat but are
// honestly labelled as never having passed the Stage 1A authority checks.

export const PUBLICATION_STATES = [
  // Pre-existing data that has not passed the Stage 1A authority policy.
  // Default for every backfilled row. May remain calculator-active.
  "legacy_unverified",
  // Deterministically materialized by an authority rule this session
  // (e.g. an agreed cross-check group with sufficient source authority).
  "auto",
  // Published provisionally from a single current official source while a
  // lower-authority conflict is preserved for review.
  "provisional_pending_review",
  // Published provisionally but a real numeric conflict remains open.
  "provisional_conflict_pending_review",
  // Preserved as a candidate (e.g. single-source alternate reward mode).
  // NOT calculator-active until officially verified or reviewer-approved.
  "candidate",
  // A human reviewer explicitly approved it.
  "reviewer_approved",
  // A human reviewer explicitly rejected it.
  "reviewer_rejected",
] as const

export type PublicationState = (typeof PUBLICATION_STATES)[number]

export function isPublicationState(v: string): v is PublicationState {
  return (PUBLICATION_STATES as readonly string[]).includes(v)
}

// Which states the calculator treats as live. `is_active_for_calculator` on
// the row is the hard gate the calculator queries actually filter on — this
// list is the intent that decides how a writer SETS that flag when it
// materializes. legacy_unverified stays active (backward compat, spec §3G);
// candidate / reviewer_rejected never activate.
export const CALCULATOR_ACTIVE_STATES: ReadonlySet<PublicationState> = new Set([
  "legacy_unverified",
  "auto",
  "provisional_pending_review",
  "provisional_conflict_pending_review",
  "reviewer_approved",
])
