import { describe, it, expect } from "vitest"
import { db } from "@/db/client"
import {
  PUBLICATION_STATES,
  CALCULATOR_ACTIVE_STATES,
  isPublicationState,
} from "@/lib/publication"

// P18 Stage 1A · spec §9 test #9 — legacy data defaults to `legacy_unverified`.
//
// The critical spec §3G / §12 requirement is that migration 0014 must NOT
// migrate historical rows to `auto`. We prove that structurally two ways:
//   1. the live column DEFAULT is 'legacy_unverified' (survives the canary
//      write, unlike an "all rows are legacy" row-count assertion);
//   2. the deterministic authority helpers treat legacy_unverified as active
//      (backward compat) while candidate / rejected never activate.

describe("P18 §9.9 — publication states + legacy default", () => {
  it("exposes the seven approved states with legacy_unverified first", () => {
    expect(PUBLICATION_STATES[0]).toBe("legacy_unverified")
    expect(PUBLICATION_STATES).toContain("auto")
    expect(PUBLICATION_STATES).toContain("provisional_pending_review")
    expect(PUBLICATION_STATES).toContain("provisional_conflict_pending_review")
    expect(PUBLICATION_STATES).toContain("candidate")
    expect(PUBLICATION_STATES).toContain("reviewer_approved")
    expect(PUBLICATION_STATES).toContain("reviewer_rejected")
    expect(isPublicationState("legacy_unverified")).toBe(true)
    expect(isPublicationState("totally_made_up")).toBe(false)
  })

  it("keeps legacy rules calculator-active but never activates candidates/rejects", () => {
    // Backward compat: legacy rows stay live (spec §3G).
    expect(CALCULATOR_ACTIVE_STATES.has("legacy_unverified")).toBe(true)
    expect(CALCULATOR_ACTIVE_STATES.has("auto")).toBe(true)
    expect(CALCULATOR_ACTIVE_STATES.has("provisional_pending_review")).toBe(true)
    // Candidates + rejects must NEVER be treated as calculator-live.
    expect(CALCULATOR_ACTIVE_STATES.has("candidate")).toBe(false)
    expect(CALCULATOR_ACTIVE_STATES.has("reviewer_rejected")).toBe(false)
  })

  it("migration 0014 defaults publish_authority columns to legacy_unverified, not auto", async () => {
    const rows = await db.execute(
      `SELECT table_name, column_name, column_default
         FROM information_schema.columns
        WHERE (table_name = 'reward_rules' AND column_name = 'publish_authority')
           OR (table_name = 'cards' AND column_name = 'annual_fee_publish_authority')
        ORDER BY table_name`,
    )
    const defaults = (rows.rows as { column_default: string }[]).map(
      (r) => r.column_default,
    )
    expect(defaults.length).toBe(2)
    for (const d of defaults) {
      expect(d).toContain("legacy_unverified")
      expect(d).not.toContain("auto")
    }
  })

  it("is_active_for_calculator defaults to true (legacy rows stay live)", async () => {
    const rows = await db.execute(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'reward_rules'
          AND column_name = 'is_active_for_calculator'`,
    )
    const def = (rows.rows[0] as { column_default: string } | undefined)
      ?.column_default
    expect(def).toContain("true")
  })
})
