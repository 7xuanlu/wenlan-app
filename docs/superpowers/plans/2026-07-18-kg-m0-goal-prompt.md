# Goal prompt — rung M0 of the KG unified-model spec

Paste-ready dispatch prompt for running M0 as a long-horizon goal (background
job / goal command / `claude -p`). Pattern: **one rung = one goal** — never
"implement the whole spec" in one dispatch. When M0's PR merges, clone this
file for M1 and swap the scope block.

Routing note: with spec v3 as the contract, execution is Sonnet-tier work;
spend Opus at the gates (PR review), not on the typing.

---

Goal: ship rung M0 — "one write gate" — of the Wenlan unified knowledge-model
spec v3, as a green draft PR on the wenlan daemon repo (~/Repos/wenlan).

Contract (read first, in this order):
1. `docs/superpowers/plans/2026-07-18-kg-unified-model-spec.md` in wenlan-app
   (PR #95): §5 (write path & authority), §6.1 + §6.3 (idempotency receipts,
   SQLite discipline), the M0 row of §7, invariants 3, 10, 18.
2. The two review docs beside it — only the findings whose disposition column
   points at M0 or §5/§6.1/§6.3.
The spec is the single source of truth. Where the daemon's code contradicts
it, stop and report the conflict with file:line evidence — never improvise a
resolution.

Scope — M0 and nothing past it:
- One canonical page-write transaction: typed writer (human | agent |
  pipeline), `expected_version` CAS on every page mutation, and the
  direct-write-vs-revision-card ownership decision made INSIDE that CAS.
- `page_history` table written in the same transaction (Q4's decision).
  Markdown files become a repairable projection: temp-file rename on write,
  reconcile pass at startup.
- Changelog entry + version precondition on the manual edit route — the two
  things it actually lacks (GT2).
- Idempotency receipts (§6.1) for page mutations:
  `UNIQUE(caller_id, operation_id)`, stored response, replay on same-digest
  retry, conflict on digest mismatch.
- PRESERVE the `citations='[]'` reset on content change — it is an intentional
  invariant (db.rs contract comment), not a bug. Do not "fix" it.
Out of scope: everything in M1–M6 (schema folds, edges table, communities,
distill). If a change appears to require them, that is a stop condition, not
a license.

Floor — machine-checkable, every increment:
- TDD: failing test first. Mutation-prove each load-bearing test: break the
  product code, watch the test fail, restore it.
- `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D
  warnings`, `cargo fmt --check --all` — all green before every commit.
- Migration tested both ways: fresh-DB and upgraded-DB schemas agree; the
  daemon refuses to open a newer-schema database (§6.9).
- Crash-shaped tests: kill between prepare and finalize; retry the same
  `operation_id`; race a human edit against a refresh — every case converges
  with no duplicate side effects and no lost human prose.

Caps & rein: work in a worktree on branch `kg-m0-write-gate`; commit per green
increment with explicit paths; push and open a DRAFT PR when the acceptance
list is complete; never merge, never touch main, never weaken an existing
check to get green.

Stop and ask (needs input) only when: a wire-contract change would be visible
to the app; the spec conflicts with code reality; or three fix attempts on
one root cause have failed (then question the architecture, per
systematic-debugging).

Done = the draft PR is open and its description IS the M0 acceptance
checklist, each item checked with evidence (test names, gate output, migration
logs). A pushed branch without the checklist is not done.
