-- Stage 1B core (P18 · D30): persistent rule identity + reviewer overrides.
--
-- Spec §6. A reward_rules ROW is disposable (recrawl / re-materialization / row
-- recreation / category correction churn it). The logical rule's IDENTITY must
-- survive that churn so overrides and future merge/split audit bind to something
-- stable, NOT to the regenerated row UUID (§6A, §12).
--
-- Dependency direction (D11): both tables live in the extraction namespace and
-- reference catalog (cards, reward_rules) one-way. There is deliberately NO
-- reward_rules.rule_identity_id column — that would invert the dependency. The
-- binding is owned here via origin_rule_id and mirrored durably in audit_metadata.

CREATE TABLE "rule_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "card_id" uuid NOT NULL,
  "origin_rule_id" uuid,
  "stable_scope_key" text NOT NULL,
  "status" text DEFAULT 'legacy_unreconciled' NOT NULL,
  "audit_metadata" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "rule_identities_status_check" CHECK ("status" IN ('legacy_unreconciled','active','reconciled','retired'))
);

ALTER TABLE "rule_identities"
  ADD CONSTRAINT "rule_identities_card_id_cards_id_fk"
  FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "rule_identities"
  ADD CONSTRAINT "rule_identities_origin_rule_id_reward_rules_id_fk"
  FOREIGN KEY ("origin_rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;

-- Idempotent 1:1 backfill guard: one legacy rule → at most one identity.
-- Partial so future identities with no origin rule never collide (§6C).
CREATE UNIQUE INDEX "rule_identities_origin_rule_unique"
  ON "rule_identities" USING btree ("origin_rule_id")
  WHERE "rule_identities"."origin_rule_id" IS NOT NULL;

CREATE INDEX "rule_identities_card_id_idx" ON "rule_identities" USING btree ("card_id");
CREATE INDEX "rule_identities_scope_key_idx" ON "rule_identities" USING btree ("stable_scope_key");

CREATE TABLE "reviewer_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "rule_identity_id" uuid NOT NULL,
  "field_path" text NOT NULL,
  "version_scope" text DEFAULT '' NOT NULL,
  "comparison_policy" text DEFAULT 'exact' NOT NULL,
  "override_value" jsonb NOT NULL,
  "baseline_value" jsonb,
  "reason" text NOT NULL,
  "reviewer_email" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviewer_overrides_status_check" CHECK ("status" IN ('active','superseded','withdrawn')),
  CONSTRAINT "reviewer_overrides_comparison_policy_check" CHECK ("comparison_policy" IN ('exact','numeric_abs','numeric_pct','set_equal'))
);

ALTER TABLE "reviewer_overrides"
  ADD CONSTRAINT "reviewer_overrides_rule_identity_id_rule_identities_id_fk"
  FOREIGN KEY ("rule_identity_id") REFERENCES "public"."rule_identities"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "reviewer_overrides_identity_field_idx"
  ON "reviewer_overrides" USING btree ("rule_identity_id","field_path");

-- At most one ACTIVE override per (identity, field, version scope). version_scope
-- is NOT NULL DEFAULT '' so this equality is clean (no Postgres NULL-distinct hole).
CREATE UNIQUE INDEX "reviewer_overrides_active_unique"
  ON "reviewer_overrides" USING btree ("rule_identity_id","field_path","version_scope")
  WHERE "reviewer_overrides"."status" = 'active';
