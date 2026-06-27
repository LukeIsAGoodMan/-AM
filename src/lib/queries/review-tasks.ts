import { eq, sql, desc, asc } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, issuers } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  reviewTasks,
} from "@/db/schema/extraction"

// Server query for the /review queue page (P5). Joins review_tasks to the
// task's card (always set), its cross_check_group (set when subjectGroupId
// is populated — true for all P4-auto-created tasks), and the issuer (for
// the human-readable column).
//
// The query returns ALL tasks regardless of status by default; client-side
// filters narrow to open/in_progress. That's fewer round trips than
// per-filter SQL and keeps the page snappy at the ~hundreds-of-tasks scale
// Phase 2 will land at. We'll add server-side pagination + filtering when
// the queue grows past ~2000 rows.

export type ReviewTaskRow = {
  taskId: string
  taskType: string // claim_review | conflict_resolution | cross_check_confirmation
  priority: string // low | normal | high | blocker
  status: string // open | in_progress | resolved | dismissed
  title: string
  description: string | null
  // Resolution metadata (null while open).
  resolvedAt: Date | null
  resolutionNote: string | null
  createdAt: Date
  updatedAt: Date
  // Card + issuer columns (always present — review_tasks.card_id is NOT NULL).
  cardId: string
  cardSlug: string
  cardNameEn: string
  issuerNameEn: string
  // Cross-check group columns. Null only for tasks created outside the
  // aggregator (e.g. a future manual-add-claim-review flow). P4 always
  // populates these.
  groupId: string | null
  groupStatus: string | null // agreed | single_source | conflict | superseded
  claimType: string | null
  keyDimension: string | null
  aggregateConfidence: string | null // numeric(4,3) returned as string
  supportingCount: number
  contradictingCount: number
}

export async function listReviewTasks(): Promise<ReviewTaskRow[]> {
  const rows = await db
    .select({
      taskId: reviewTasks.id,
      taskType: reviewTasks.taskType,
      priority: reviewTasks.priority,
      status: reviewTasks.status,
      title: reviewTasks.title,
      description: reviewTasks.description,
      resolvedAt: reviewTasks.resolvedAt,
      resolutionNote: reviewTasks.resolutionNote,
      createdAt: reviewTasks.createdAt,
      updatedAt: reviewTasks.updatedAt,
      cardId: cards.id,
      cardSlug: cards.slug,
      cardNameEn: cards.cardNameEn,
      issuerNameEn: issuers.nameEn,
      groupId: crossCheckGroups.id,
      groupStatus: crossCheckGroups.status,
      claimType: crossCheckGroups.claimType,
      keyDimension: crossCheckGroups.keyDimension,
      aggregateConfidence: crossCheckGroups.aggregateConfidence,
      // Postgres array_length returns NULL for empty arrays; coalesce to 0
      // so the client doesn't have to special-case it.
      supportingCount: sql<number>`COALESCE(array_length(${crossCheckGroups.supportingClaimIds}, 1), 0)::int`,
      contradictingCount: sql<number>`COALESCE(array_length(${crossCheckGroups.contradictingClaimIds}, 1), 0)::int`,
    })
    .from(reviewTasks)
    .innerJoin(cards, eq(reviewTasks.cardId, cards.id))
    .innerJoin(issuers, eq(cards.issuerId, issuers.id))
    // leftJoin: tasks for individual claims (P4 doesn't make those, but
    // future flows might) wouldn't have a group row.
    .leftJoin(
      crossCheckGroups,
      eq(reviewTasks.subjectGroupId, crossCheckGroups.id),
    )
    // High-priority conflicts first, then most recent. Status filtering is
    // client-side per the comment above.
    .orderBy(
      // Custom priority order via a CASE expression — text ordering would
      // put 'blocker' before 'high' alphabetically but 'normal' before
      // 'low' wrong-way around.
      sql`CASE ${reviewTasks.priority}
            WHEN 'blocker' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END`,
      desc(reviewTasks.createdAt),
      asc(reviewTasks.id),
    )

  return rows
}

// Summary counts used by the page header — "X open · Y conflicts · ...".
// Computed in-memory from the same list to avoid a second round trip; the
// list is bounded to a sane size by the time we'd need pagination anyway.
export type ReviewQueueSummary = {
  totalOpen: number
  openConflicts: number
  openSingleSource: number
  openAgreed: number
  inProgress: number
  resolved: number
  dismissed: number
}

export function summarizeQueue(rows: ReviewTaskRow[]): ReviewQueueSummary {
  let totalOpen = 0
  let openConflicts = 0
  let openSingleSource = 0
  let openAgreed = 0
  let inProgress = 0
  let resolved = 0
  let dismissed = 0
  for (const r of rows) {
    if (r.status === "open") {
      totalOpen += 1
      if (r.groupStatus === "conflict") openConflicts += 1
      else if (r.groupStatus === "single_source") openSingleSource += 1
      else if (r.groupStatus === "agreed") openAgreed += 1
    } else if (r.status === "in_progress") {
      inProgress += 1
    } else if (r.status === "resolved") {
      resolved += 1
    } else if (r.status === "dismissed") {
      dismissed += 1
    }
  }
  return {
    totalOpen,
    openConflicts,
    openSingleSource,
    openAgreed,
    inProgress,
    resolved,
    dismissed,
  }
}
