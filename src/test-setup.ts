import { config } from "dotenv"

// Vitest test setup — load .env.local so DB-touching tests (P1 schema smoke,
// future Phase 2 cross-check tests) can reach the local Postgres. Pure tests
// don't care; the dotenv call is a no-op if there's nothing to load.

config({ path: ".env.local" })
