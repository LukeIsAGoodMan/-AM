# Ask Mike — HK Card Rewards

Internal admin + foundation layer for a future Hong Kong credit card rewards Q&A product.

See [docs/prd.md](./docs/prd.md) for product scope and architecture.
See [docs/roadmap.md](./docs/roadmap.md) for the milestone-level build plan.

## Stack

- Next.js 15 (App Router) + TypeScript strict
- Tailwind CSS v4
- Drizzle ORM + Postgres (Docker)
- Zod for runtime validation
- Vitest for unit tests

## Prerequisites

- Node 22+ (or 25)
- pnpm (`npm i -g pnpm`)
- Docker Desktop (for local Postgres)

## Getting started

```bash
pnpm install
docker compose up -d           # start Postgres
cp .env.example .env.local     # already done if you cloned this repo
pnpm db:migrate                # apply migrations (empty until M1)
pnpm test                      # smoke test
pnpm dev                       # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate migration from schema diff |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio (browse DB) |
| `pnpm db:push` | Push schema without migration (dev shortcut) |

## Project structure

```
src/
  app/            # Next.js App Router pages
  db/
    client.ts     # Drizzle + pg pool
    schema/
      catalog.ts  # Layer 2 — cards, rules, sources (M1+)
      user.ts     # Layer 7 — RESERVED, empty
  lib/            # shared libs (calculator, resolver, etc. — M1+)
docs/
  prd.md          # product requirements
  roadmap.md      # milestone plan
data/             # YAML source of truth for cards (M6+)
drizzle/
  migrations/     # generated migration SQL
docker-compose.yml
```

## Current milestone: M0 — Skeleton

See [docs/roadmap.md](./docs/roadmap.md#m0--skeleton-05d). Next: M1.
