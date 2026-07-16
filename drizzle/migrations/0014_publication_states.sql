-- Stage 1A (P18 · D28): controlled publication states.
--
-- reward_rules and cards gain an explicit authority state so the system
-- never falsely claims a legacy spreadsheet value or a historically
-- materialized rule passed the new authority policy (spec §3G).
--
-- CRITICAL: every existing row backfills to 'legacy_unverified', NOT 'auto'.
-- Legacy rows stay calculator-active for backward compat (is_active_for_
-- calculator defaults true) but are honestly labelled as never having passed
-- the Stage 1A authority checks.

-- reward_rules.publish_authority — how this rule earned its published status.
ALTER TABLE "reward_rules"
  ADD COLUMN "publish_authority" text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE "reward_rules"
  ADD CONSTRAINT "reward_rules_publish_authority_check"
  CHECK ("publish_authority" IN (
    'legacy_unverified',
    'auto',
    'provisional_pending_review',
    'provisional_conflict_pending_review',
    'candidate',
    'reviewer_approved',
    'reviewer_rejected'
  ));

-- reward_rules.is_active_for_calculator — a NEW gate on top of status.
-- Existing approved rules stay active (default true). Candidate / alt-mode /
-- reviewer-rejected rules are materialized with this false so the calculator
-- skips them while they stay visible in /rules.
ALTER TABLE "reward_rules"
  ADD COLUMN "is_active_for_calculator" boolean NOT NULL DEFAULT true;

-- cards.annual_fee_publish_authority — same honesty guarantee for the annual
-- fee value. Seed values are legacy_unverified until an authority check (§3E)
-- promotes them.
ALTER TABLE "cards"
  ADD COLUMN "annual_fee_publish_authority" text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_annual_fee_publish_authority_check"
  CHECK ("annual_fee_publish_authority" IN (
    'legacy_unverified',
    'auto',
    'provisional_pending_review',
    'provisional_conflict_pending_review',
    'candidate',
    'reviewer_approved',
    'reviewer_rejected'
  ));

-- source_claims / review_tasks: capture the reviewer email for the new
-- reject_claim + gate-created tasks (§3C — "store a reason and reviewer
-- email"). The reason reuses the existing reviewer_note / resolution_note
-- columns. No new tables — Stage 1B owns the durable override layer.
ALTER TABLE "source_claims" ADD COLUMN "reviewer_email" text;
ALTER TABLE "review_tasks" ADD COLUMN "reviewer_email" text;
