---
paths:
  - "src/db/**"
  - "drizzle/**"
---

# Database — schema + migrations

Drizzle ORM + Postgres 16. Schema lives in `src/db/schema/`: `catalog.ts` (Layer 2 —
issuers/cards/rules/sources), `extraction.ts` (Phase 2 / Stage 1A tables), `user.ts` (Layer 7,
reserved). Migrations are in `drizzle/migrations/` (`0000`…`0014`, append-only).

- **Migrations are append-only.** Never edit or delete an already-applied `00NN_*.sql`. Change
  the schema in `src/db/schema/`, then `pnpm db:generate` to emit the next numbered migration,
  then `pnpm db:migrate`. Editing an applied migration desyncs every environment.
- **`next build` does NOT run migrations** (per `docs/DEPLOY.md`). Apply each new migration to
  hosted DBs manually with `pnpm db:migrate`.
- **`catalog.ts` never imports from `extraction.ts`** — the catalog must not depend on the
  extraction namespace (D11). Keep the dependency direction one-way.
- Schema evolves behind the `ResolvedRule` seam (PRD §8.5) so `calculate()` doesn't change with
  the schema. Prefer a jsonb payload change + a new decision entry over a breaking column change.
- DB-touching tests + `pnpm diagnose` need a live Postgres: `docker compose up -d` (`:5432`) or a
  `DATABASE_URL` in `.env.local`. `src/test-setup.ts` loads `.env.local` for tests.
