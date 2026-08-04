---
paths:
  - "data/**"
  - "src/lib/import/**"
---

# `data/` YAML — source of truth

`data/` YAML is the **authoritative** catalog (issuers, cards, rules, sources, welcome offers,
currencies, campaigns). `pnpm import:data` does a full-sync into Postgres (insert / update /
archive-missing). The DB is derived; never treat a DB row as the source.

- **Economic change on an `approved` rule ⇒ refused.** `pnpm import:data` refuses to mutate an
  economic field on an already-approved rule. To change one, add a **new slug** and set
  `supersedesSlug` on it (the M6 supersede pattern) — do not edit the approved rule in place.
  The refuse set is `ECONOMIC_RULE_FIELDS` in `src/lib/import/syncer.ts`.
- **Slug format:** `<issuer-slug>-<card-name-slugified>` (e.g. `dbs-black-world-mastercard`).
- **Materialized rules are protected from the syncer.** Rules whose slug starts with `xchk__`
  are pipeline-owned; the syncer carves them out (`!slug.startsWith("xchk__")`) so `import:data`
  never archives them (D18). Don't remove that carve-out.
- **Validate before importing:** `pnpm validate:data` (Zod) → `pnpm import:data`. Re-import is
  idempotent; `valuesEqual` in the syncer does numeric coercion + sorted-key recursion because
  Postgres `numeric` returns strings and jsonb key order isn't preserved.
- Edit forms and server actions mirror the same refuse-on-approved guard (D9). Form edits do
  **not** write back to YAML (known limit) — YAML remains the record you must keep aligned.
