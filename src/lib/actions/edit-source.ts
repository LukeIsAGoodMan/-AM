"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db/client"
import { sourceDocuments } from "@/db/schema/catalog"

// M15 — light source edit. Sources don't carry the calculator's economic
// invariant (rules do); a source can be retitled / re-typed without any
// refusal logic. The big-ticket fields (extracted_text, content_hash,
// retrieved_at) are owned by the M8 extraction pipeline and intentionally
// not exposed here.

export type EditSourceInput = {
  sourceSlug: string
  title: string
  sourceType: string
  sourcePriority: number
  url: string | null
  language: string
  status: string
  notes: string | null
}

export type EditSourceResult =
  | { ok: true; updatedFields: string[] }
  | { ok: false; error: string }

const VALID_SOURCE_TYPES = [
  "official_page",
  "official_pdf_tc",
  "official_app_screenshot",
  "official_open_api",
  "competitor_page",
  "forum_post",
  "reddit_post",
  "lihkg_post",
  "user_submission",
  "manual_note",
]

const VALID_LANGUAGES = ["en", "zh_hk", "zh_cn", "mixed", "unknown"]
const VALID_STATUSES = ["active", "archived", "needs_recheck"]

export async function saveSourceEdit(
  input: EditSourceInput,
): Promise<EditSourceResult> {
  if (!VALID_SOURCE_TYPES.includes(input.sourceType)) {
    return { ok: false, error: `source_type '${input.sourceType}' is not a recognised value.` }
  }
  if (!VALID_LANGUAGES.includes(input.language)) {
    return { ok: false, error: `language '${input.language}' is not a recognised value.` }
  }
  if (!VALID_STATUSES.includes(input.status)) {
    return { ok: false, error: `status '${input.status}' is not a recognised value.` }
  }
  if (input.sourcePriority < 1 || input.sourcePriority > 8) {
    return { ok: false, error: "source_priority must be between 1 and 8." }
  }
  if (input.url && !isUrlish(input.url)) {
    return { ok: false, error: `url '${input.url}' is not a valid URL.` }
  }

  const existing = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.slug, input.sourceSlug))
  const current = existing[0]
  if (!current) {
    return { ok: false, error: `Source '${input.sourceSlug}' not found.` }
  }

  const updatedFields: string[] = []
  const tracked: { name: string; cur: unknown; next: unknown }[] = [
    { name: "title", cur: current.title, next: input.title },
    { name: "sourceType", cur: current.sourceType, next: input.sourceType },
    { name: "sourcePriority", cur: current.sourcePriority, next: input.sourcePriority },
    { name: "url", cur: current.url, next: input.url },
    { name: "language", cur: current.language, next: input.language },
    { name: "status", cur: current.status, next: input.status },
    { name: "notes", cur: current.notes, next: input.notes },
  ]
  for (const { name, cur, next } of tracked) {
    if (!shallowEq(cur, next)) updatedFields.push(name)
  }

  if (updatedFields.length === 0) {
    return { ok: true, updatedFields: [] }
  }

  await db
    .update(sourceDocuments)
    .set({
      title: input.title,
      sourceType: input.sourceType,
      sourcePriority: input.sourcePriority,
      url: input.url,
      language: input.language,
      status: input.status,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(sourceDocuments.slug, input.sourceSlug))

  revalidatePath("/sources")
  revalidatePath(`/sources/${input.sourceSlug}`)
  revalidatePath("/rules")
  return { ok: true, updatedFields }
}

function shallowEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == b
  return String(a) === String(b)
}

function isUrlish(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}
