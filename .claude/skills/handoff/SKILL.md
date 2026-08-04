---
name: handoff
description: Wrap up a Claude Code session for the -AM project when context is nearly full, the work package is done, or you're switching sessions. Re-checks git, decides what's truly done and truly tested, rewrites docs/claude/CURRENT.md, and prints the next /bootstrap command. Does not modify product code. Invoke manually as /handoff.
disable-model-invocation: true
---

# Handoff — write accurate cross-session state

Produce a clean, truthful handoff so the next session resumes without the old chat. Do **not**
modify product code, tests, schema, or `data/` YAML during a handoff.

1. **Re-check the repo:** current branch, `git status --short`, `git diff --stat`, and the
   specific diff for the files this session touched (`git diff -- <paths>`).
2. **Decide what is truly complete** — compare the diff to the session's stated deliverable.
   Half-finished work is described as in-progress, not done.
3. **Decide what was truly tested** — only tests/`diagnose`/`verify:ui` actually run *and
   observed this session* count. If it wasn't run, say so.
4. **Run only safe, small verification if needed** to close a gap (e.g. `pnpm typecheck`, a
   single targeted `pnpm test`). Skip long/expensive runs; never run the extraction pipeline
   or a canary write as part of a handoff.
5. **Rewrite `docs/claude/CURRENT.md`** so it reflects reality now. Keep:
   - current goal / phase; accepted decisions in play; key constraints;
   - files changed this session and why; **actual** test results (with the fact you ran them);
   - blockers; the precise next step.
   Delete: stale plans, duplicate logs, abandoned approaches, and exploration detail that
   doesn't affect the next step. Keep it short — it is state, not a dev log.
6. **Mark epistemic status** in the file: **[FACT]** (verified this session) vs
   **[ASSUMPTION]** vs **[UNRESOLVED]**. Never record an unrun test as passing.
7. **Update the header:** set "Last updated" to today, and refresh Branch / HEAD from step 1.
8. **If a load-bearing decision was made this session,** confirm it was appended to
   `docs/decisions.md` (its own convention) — `CURRENT.md` points to decisions, it doesn't
   replace them.

Then print, in the chat:

- **Work package status** — done / in-progress / blocked.
- **Tests run this session + their results** (or "none run").
- **Unresolved blockers.**
- **Suggested next command**, in the form:
  `/bootstrap <next bounded work package>`
