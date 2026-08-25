# ACTIVE WORK — thread ownership

**Read this before touching SAM entity fields.** Two threads are working the same decision area;
this file says who owns what so neither overwrites the other.

Last updated: **2026-08-24**

---

## The completion rule (enforced)

> **Work is not complete because it is committed or pushed. It is complete only when its commit
> is reachable from `origin/main`, or an open PR explicitly owns it.**

Check it: `node scripts/check-orphaned-branch.mjs` (or `--all`).
Verdicts: **MERGED** / **IN REVIEW** / **ORPHANED (exit 1)**.

This rule exists because it already cost real work: the `purpose_of_registration` migration was
written, committed, pushed and reported as done — but **no PR was ever opened**, so it never
reached main, every later branch cut from main silently lacked it, and `db:check` found the
column did not exist.

⚠️ The guard is squash-merge aware. A squash merge **rewrites the commit**, so
`merge-base --is-ancestor` says "not merged" for work that genuinely is. The naive version
reported **490 of 537** branches as orphaned, including one merged minutes earlier.

---

## Thread 2 — DEFECT-10 exception semantics / count integrity

**Status: FINISHING.** Owns the remaining unmerged count fix (`ce8fa21f`).

Its current semantics are already live and correct; the **caveat numbers are understated**
because of the PostgREST 1,000-row cap. That fix lands first because it corrects absolute
exception counts in the same decision area Thread 1 is about to write to.

**Do not** let another thread modify exception counting until this merges.

---

## Thread 1 — certification dates + purpose-of-registration

**Status: HOLD** — waiting on Thread 2 to merge. Nothing is discarded or rewritten.

### Landed and verified

| item | state |
|---|---|
| `purpose_of_registration` migration | **applied**, column verified via `db:check` |
| `certification_records` migration | **applied**, column verified via `db:check` |
| certification-date parser + preservation | merged (PR #1328) |
| `naicsException` four-state preservation | merged (PR #1323) |
| backfill runner | **PR #1333, IN REVIEW — not run** |

### Measured evidence (still valid after a rebase — no need to re-derive)

- **507 firms (17.1% of certified) carry an EXPIRED cert; 467 have an ACTIVE SAM registration**,
  so nothing else flags them.
- Sharp cases: **KILIUDA CONSULTING** (8(a), expired 2023-01-11) and
  **ALASKA PROFESSIONAL CONSTRUCTION** (HUBZone, expired 2024-03-19) — both `Active`.
- Dry run reproduces it: **current 1,398 / expired 496 / unknown 1,246**, `Z1` 27.9% / `Z2` 72.0%.
  The 16-cert delta from the audit's 1,382/512 is **correct**: the backfill evaluates against
  `asOf = 2026-08-02` (the snapshot date), not today.

### Resume sequence — in this order

1. Thread 2 merges `ce8fa21f`.
2. `git fetch origin` and rebase `feat/sam-cert-backfill` onto current `main`.
3. **Verify the diff is still only certification/purpose work, with ZERO deletions of
   Thread 2 / SAM decision-chain files.**
4. Re-run the dry run against the rebased code.
5. Only if the three-state counts still reconcile → run the full 910K backfill.
6. Then measure which live surfaces the expired/unknown certs reach — **before** changing any
   of them.

### Invariants nobody may break

- **`certifications[]` is NOT touched.** It stays the has/had compatibility field. The new
  column answers the *different* question: is it **currently valid**.
- **`unknown` is never rendered as `current`.** 89% of HUBZone tokens carry no date; their
  currency is genuinely unknown.
- **A certification label proves the program was asserted; it does not prove the certification
  is currently valid.**
- No eligibility logic reads `certification_records` yet. Wiring is a later, measured step.

---

## Not started

**Identity / hierarchy** (parent, predecessor, duplicate entities) — worth measuring, but it
ranks below certification dates, which already produced actual eligibility errors. JV/entity
structure was measured and came in at **0.11% of scoped pools** — real but narrow; do not
promote it above cert dates.
