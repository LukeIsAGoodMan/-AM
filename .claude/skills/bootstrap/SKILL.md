---
name: bootstrap
description: Start a new Claude Code session for the -AM project on a single bounded work package. Restores cross-session state, reads only task-relevant specs/decisions, verifies the handoff against the repo, and prints a session contract before any code changes. Invoke manually as /bootstrap <work package>.
argument-hint: <bounded work package>
disable-model-invocation: true
---

# Bootstrap a session — work package: `$ARGUMENTS`

Recover state and open a session for the **single bounded work package** above. Do this in
order. Keep the main context lean — read only what this task needs; do **not** re-audit the
whole repo. If `$ARGUMENTS` is empty, ask the user for the one-line work package and stop.

1. **Read the working agreement:** root `CLAUDE.md`.
2. **Read the dynamic state:** `docs/claude/CURRENT.md`. Note the phase, blockers, and the
   "Next step" — including any **[UNRESOLVED]** owner-decision.
3. **Read only the task-relevant spec.** Match `$ARGUMENTS` to at most one or two of:
   `docs/stage-1a-spec.md` (extraction Stage 1A/1B), `docs/calculator-semantics.md`
   (calculator), `docs/prd.md` §N (product scope — targeted sections only),
   `docs/DEPLOY.md` (deploy), `docs/known-limits.md`. Read only the relevant sections.
4. **Read only the relevant decisions** in `docs/decisions.md` (grep for the D-numbers or
   milestone the task touches — e.g. D24–D29 for Stage 1A). Do not read the whole log.
5. **Check the repo state:** current branch, `git status --short`, and the last ~5 commits
   (`git log --oneline -5`).
6. **Verify the handoff against the repo.** Confirm `CURRENT.md`'s HEAD / branch / "recently
   completed" match git. If `CURRENT.md` claims a test passed, treat it as unverified until
   re-run — do not trust a stale green.
7. **If wide exploration is genuinely needed, use the Explore subagent** and bring back only
   the summary. Do not load full specs, logs, or history into the main context.
8. **Print a short session contract, then start.** Before editing any code, output:
   - **Deliverable:** the exact bounded outcome of this session.
   - **Constraints:** the guardrails that apply (from `CLAUDE.md` + relevant
     `.claude/rules/*.md` — e.g. YAML source-of-truth, migrations append-only, canary
     write-gates, never auto-reject conflicts).
   - **Relevant files:** the minimal set to touch/read.
   - **Required tests:** what must pass to call it done (e.g. `pnpm test`, `pnpm diagnose`).
   - **Explicit non-goals.**
   - **Conflicts:** any mismatch between the handoff (`CURRENT.md`) and repo evidence.
9. **If there is no unresolvable conflict, begin work immediately** after printing the
   contract — do not wait for reconfirmation. If the work package is blocked (e.g. it needs
   an owner decision that `CURRENT.md` flags as **[UNRESOLVED]**, or it is Stage 1B which is
   approval-gated per `stage-1a-spec.md §12`), surface that and stop before editing code.

Do **not** re-run the full project audit, and do **not** load every spec/log/decision at once.
