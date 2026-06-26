import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { cards, rewardRules, sourceDocuments } from "./catalog"

// Phase 2 — multi-source extraction + cross-check (PRD §22).
//
// Physical isolation rule (decisions.md D7 mirror, D11):
//   - Extraction tables MAY reference catalog tables (cards, source_documents,
//     reward_rules).
//   - Catalog tables MUST NOT reference extraction tables.
// Enforced by file structure + import direction (catalog.ts never imports
// from this file).
//
// Lifecycle for a claim (PRD §22.4):
//   1. extraction_runs row created when an LLM (or manual) extraction starts.
//   2. source_claims rows created with extraction_run_id pointing at it,
//      status='draft' → 'pending_review'.
//   3. Aggregator scans pending claims, groups by (card, claim_type,
//      key_dimension) into cross_check_groups, decides agreed / single_source
//      / conflict, auto-creates review_tasks where needed.
//   4. Reviewer approves; the group's canonical_payload becomes a reward_rule,
//      with reward_rule_sources join rows tying every supporting claim's
//      source to the new rule.

// ─────────────────────────────────────────────────────────────────────────────
// extraction_runs — one row per extraction job. Lets us replay history when
// a prompt or model changes, and surfaces cost on the dashboard (P10).

export const extractionRuns = pgTable("extraction_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").references(() => sourceDocuments.id, {
    // Keep cost / history record even if the source row is rotated.
    onDelete: "set null",
  }),
  modelId: text("model_id").notNull(), // 'claude-opus-4-7-2026-06' / 'manual' / 'parser:hsbc-tc-v1'
  promptVersion: text("prompt_version").notNull(),
  // Hash of (chunk_id + prompt_version) so re-runs over the same input dedup.
  inputHash: text("input_hash").notNull(),
  claimsEmitted: integer("claims_emitted").default(0).notNull(),
  costUsdCents: integer("cost_usd_cents"),
  // Latency surfaces alongside cost so we can spot when the model is
  // slowing down without bumping price (PRD §22.10 #5).
  latencyMs: integer("latency_ms"),
  status: text("status").default("pending").notNull(), // pending / succeeded / failed / partial
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  index("extraction_runs_source_id_idx").on(table.sourceId),
  index("extraction_runs_started_at_idx").on(table.startedAt),
])

export type ExtractionRun = typeof extractionRuns.$inferSelect
export type NewExtractionRun = typeof extractionRuns.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// source_claims — one structured assertion extracted from one source.
//
// The same logical rule (HSBC Red online 4%) may have 3+ claim rows, one
// from each source that asserts it. The cross-check aggregator (P4)
// reconciles them into cross_check_groups.

export const sourceClaims = pgTable("source_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Restrict delete: a claim without a source loses its citation and would
  // contaminate the audit trail. Force the operator to detach claims first
  // before deleting a source.
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sourceDocuments.id, { onDelete: "restrict" }),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  // earn_rate / cap / exclusion / welcome_offer / category_definition /
  // annual_fee / eligibility. Free-text for now; Phase 2.5 may tighten.
  claimType: text("claim_type").notNull(),
  // Shape mirrors reward_rules.reward_formula_payload + flattened conditions.
  // Validated at write time by P2's Zod schema (extraction prompt output).
  structuredPayload: jsonb("structured_payload").notNull(),
  // The actual quote from the source — for the reviewer to see what the
  // LLM was looking at. Should always be a substring of source_chunks.text.
  extractedTextSnippet: text("extracted_text_snippet").notNull(),
  extractionRunId: uuid("extraction_run_id").references(
    () => extractionRuns.id,
    // Preserve claim even if run is purged.
    { onDelete: "set null" },
  ),
  // 'manual' | 'claude-opus-4-7-2026-06' | 'parser:hsbc-tc-v1'. Free-text
  // so we don't need a migration each time a new model lands.
  extractedBy: text("extracted_by").notNull(),
  // Extractor's self-reported confidence. Differs from the aggregated
  // confidence the cross-check group computes — see PRD §22.6.
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 })
    .default("0.500")
    .notNull(),
  status: text("status").default("draft").notNull(), // draft / pending_review / approved / rejected / superseded
  // Lazy-populated by aggregator (P4). Null until grouping happens.
  crossCheckGroupId: uuid("cross_check_group_id").references(
    (): AnyPgColumn => crossCheckGroups.id,
    { onDelete: "set null" },
  ),
  reviewerNote: text("reviewer_note"),
  // No FK — user table doesn't exist yet (Layer 7 reserved). Store the id.
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  index("source_claims_card_id_claim_type_idx").on(table.cardId, table.claimType),
  index("source_claims_status_idx").on(table.status),
  index("source_claims_group_id_idx").on(table.crossCheckGroupId),
  index("source_claims_source_id_idx").on(table.sourceId),
])

export type SourceClaim = typeof sourceClaims.$inferSelect
export type NewSourceClaim = typeof sourceClaims.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// cross_check_groups — verdict per (card, claim_type, key_dimension).
//
// UNIQUE (card_id, claim_type, key_dimension) so the aggregator's upsert is
// idempotent — re-running P4 over the same pending claim set produces no
// duplicates. key_dimension is the discriminator within a claim_type
// (e.g. 'category_slug=online_local' so two category bonuses on the same
// card don't collide into one group).

export const crossCheckGroups = pgTable("cross_check_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  claimType: text("claim_type").notNull(),
  keyDimension: text("key_dimension").notNull(),
  status: text("status").default("open").notNull(), // open / agreed / single_source / conflict / superseded
  // The agreed value once cross-check converges. Null while still 'open'
  // or 'conflict' unresolved.
  canonicalPayload: jsonb("canonical_payload"),
  // Weighted aggregate per PRD §22.6 formula.
  aggregateConfidence: numeric("aggregate_confidence", { precision: 4, scale: 3 })
    .default("0.000")
    .notNull(),
  // Claims that contribute to canonical_payload (kept in sync by aggregator).
  // Stored as uuid[] for read-side simplicity — the source_claims table
  // also points back via cross_check_group_id for the reverse lookup.
  supportingClaimIds: uuid("supporting_claim_ids").array().default(sql`'{}'::uuid[]`).notNull(),
  contradictingClaimIds: uuid("contradicting_claim_ids").array().default(sql`'{}'::uuid[]`).notNull(),
  approvedRuleId: uuid("approved_rule_id").references(
    (): AnyPgColumn => rewardRules.id,
    // Allow the rule to be deleted; group's history preserves the trail.
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex("cross_check_groups_unique_dim").on(
    table.cardId,
    table.claimType,
    table.keyDimension,
  ),
  index("cross_check_groups_status_idx").on(table.status),
])

export type CrossCheckGroup = typeof crossCheckGroups.$inferSelect
export type NewCrossCheckGroup = typeof crossCheckGroups.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// review_tasks — human work items. Phase 2 makes three types:
//   - claim_review                 single claim approve / reject
//   - conflict_resolution          multiple sources disagree
//   - cross_check_confirmation     agreement found, confirm canonical value
//
// One of (subject_claim_id, subject_group_id) is non-null. Both is rare but
// allowed for the confirmation task (it cites the winning claim AND the
// group). Neither is forbidden — caller's responsibility, not DB CHECK,
// since the constraint is fuzzy.

export const reviewTasks = pgTable("review_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskType: text("task_type").notNull(),
  priority: text("priority").default("normal").notNull(), // low / normal / high / blocker
  cardId: uuid("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  subjectClaimId: uuid("subject_claim_id").references(() => sourceClaims.id, {
    onDelete: "cascade",
  }),
  subjectGroupId: uuid("subject_group_id").references(() => crossCheckGroups.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").default("open").notNull(), // open / in_progress / resolved / dismissed
  resolvedBy: uuid("resolved_by"), // no FK, see source_claims.reviewedBy note
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  index("review_tasks_status_priority_idx").on(table.status, table.priority),
  index("review_tasks_card_id_idx").on(table.cardId),
])

export type ReviewTask = typeof reviewTasks.$inferSelect
export type NewReviewTask = typeof reviewTasks.$inferInsert

// ─────────────────────────────────────────────────────────────────────────────
// reward_rule_sources — m:n join between an approved rule and every source
// that supports it. The rule itself keeps a scalar source_id (the highest-
// priority supporting source — the "primary citation"). This table holds
// the rest for provenance display on the rule detail page.

export const rewardRuleSources = pgTable("reward_rule_sources", {
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => rewardRules.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sourceDocuments.id, { onDelete: "cascade" }),
  // Which specific claim from this source backed the rule (when known).
  // Null when the source was added manually rather than via a claim.
  supportingClaimId: uuid("supporting_claim_id").references(
    () => sourceClaims.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  primaryKey({ columns: [table.ruleId, table.sourceId] }),
  index("reward_rule_sources_source_id_idx").on(table.sourceId),
])

export type RewardRuleSource = typeof rewardRuleSources.$inferSelect
export type NewRewardRuleSource = typeof rewardRuleSources.$inferInsert
