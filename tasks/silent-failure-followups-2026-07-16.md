# Silent-failure sweep — open follow-ups (2026-07-16)

## TL;DR

One session that started as "build a migration runner" turned up **four separate systems that were failing silently and reporting success**. All four are the same shape: *a failure rendered as a legitimate-looking value* — `Success. No rows returned`, `0 row(s)`, `fetchedAll = true`, `OK`.

The repairs are merged. **This doc is the part that is NOT done.** Same class as [`smart-profile-dead-table-findings.md`](./smart-profile-dead-table-findings.md) (2026-07-11) — a missing table returns `{ data: null, error }` rather than throwing, so everything downstream degrades quietly.

Every number below was checked against the live DB on 2026-07-16, not inferred.

---

## Open items, ranked

### 1. 🔴 The recompete cron is failing on 18% of NAICS — undiagnosed

`recompete_naics_sync`, live:

| last_result | count |
|---|---|
| `ok` | 64 |
| `error` | 14 |
| **attempted so far** | **78 of 477** |

Of the 14 errors:
- **1 is stale** — `541512: existing-row read failed: Bad Request` @ 22:25, the `.in()` URL overflow fixed by #297 (merged 02:44). It will clear on its next attempt; the queue self-heals by design.
- **13 are `fetch failed`** — and they are **clustered, not random**: six consecutive NAICS at 02:25:52 → 02:27:31, roughly 16s apart, every one failing. Two more at 00:27. That pattern says an entire run's fetches died together (USASpending down / rate-limiting / timeout), not flaky individual calls.

**Why it matters:** those NAICS keep stale rows and log zero changes. The queue rotates them to the back and retries, so this is *self-healing but silently lossy* — nothing escalates if it never succeeds.

**The real blocker: the error message is useless.** `fetch failed` is Node/undici's generic wrapper; the actual reason lives in `error.cause`, which the route discards. **Next step:** log `error.cause` (and any HTTP status) in the catch in `src/app/api/cron/sync-recompete-contracts/route.ts`, let one cycle run, then diagnose. Do not guess at rate-limiting before the cause is visible.

**Effort:** small change, then wait one cycle.

---

### 2. 🟠 PR #310 — the silent-zero push gate — unmerged

The only change from this session that **prevents** the next occurrence instead of fixing the last one. Adds rule 2 to `scripts/audit-supabase-errors.mjs`: a `{ count }` bound without `{ error }`, so a failed query's `count=null` becomes `0` via `count ?? 0`.

Runs as **step 3/6 of `.githooks/pre-push`** — fires without being invoked.

**Next step:** review + merge.

---

### 3. 🟠 155 grandfathered audit findings — gated, NOT fixed

Baselined so only *new* ones block: **77 swallowed-error** (rule 1, after #311 + the `.mjs` widening) and **78 silent-zero** (rule 2, PR #310). They are still there. Most are probably benign; some are probably real.

**The finding that matters most:** the two sites whose own comments say they were *fixed* are **still violations**:

| site | its comment | what actually happened |
|---|---|---|
| `admin/dashboard:1149` | *"With `count \|\| 0` below, all 8 of these silently rendered 0"* | switched to `getCountClient()`, still no `error` bound |
| `admin/mrr-goal:210` | *"`count \|\| 0` below was silently reporting 0 sends"* | same |

Both were repaired by routing around the **specific cause** (the replica 400s every HEAD — see memory `supabase-read-replica-gotchas`) while leaving the **class** intact. If the query fails for any *other* reason, they silently render 0 again.

**Next step:** triage the silent-zero 78 by the only question that matters — *is the zero load-bearing?* A displayed figure is cosmetic; a zero that drives a decision (`if (n === 0) skip`, `fetchedAll`, a cap check) is a live bug. Drive the baseline down; don't bulk-edit.

---

### 4. 🟠 The 128 baselined migrations are an ASSUMPTION, never verified

`schema_migrations` = 138 rows: **10 actually executed** by the runner, **128 `baselined = TRUE`**.

`baselined = TRUE` means *"adopted as history"* — a claim that the file ran, **not evidence**. Baseline executed no SQL. The whole reason `--except` exists is that this assumption was already proven false once: 10 migrations had never been applied, leaving 16 tables missing that live code was querying.

> **A clean `npm run migrate:status` means the LEDGER is consistent — NOT that the schema is complete.**

**If a table or column turns up missing later, suspect a baselined migration first.** Do not re-run it; write a new migration (the correct way to repair drift).

**Near-miss worth recording:** during this write-up I flagged `grouped_synthetic` as a missing column and was **wrong** — it's a *value* of `quality_flag`, not a column. That migration is fine. The lesson isn't "the ledger is broken," it's that this is now the *first* place to suspect, and suspicion must be checked before it's reported.

**Next step:** none required. Recorded so the assumption is visible instead of forgotten. Optional: a script that verifies each baselined migration's objects actually exist.

---

### 5. 🟡 `NEXT_PUBLIC_SUPABASE_URL` has a trailing newline

Resolves to **41 chars ending in `\n`**; the real URL is 40. Present in **both `.env.local` and Vercel** (Production).

Harmless *today* only because WHATWG URL parsing strips control characters — which is why nothing has broken. It is a latent landmine for any string comparison, cache key, or log line built from it. This is the exact gotcha the global CLAUDE.md warns about (`printf`, not `echo`, when setting env values).

**Next step:** re-set it with `printf 'https://krpyelfrbicmvsmwovti.supabase.co' | vercel env add NEXT_PUBLIC_SUPABASE_URL production`, fix the `.env.local` line, redeploy so the build picks it up.

---

### 6. ✅ ~~Rule 1 excludes `admin/`, `cron/`, `scripts/`~~ — DONE by #311 (another session)

Closed while this doc was being written. **#311** widened rule 1's scope and did it better than planned: it found that `SCAN_ROOTS` never walked `scripts/` **at all**, so dropping the `EXCLUDE` alone — the fix I was going to make — **would have changed nothing**. It also surfaced a scar I hadn't seen: `cron/snapshot-metrics` recorded a fabricated `0` for **nine days** (07-07 → 07-15, 190 emails erased).

**Still open, small:** #311 widened the *directories* but the walk matched only `.ts`/`.tsx`, so every `scripts/*.mjs` stayed invisible — blind a third way. PR #310 adds `.mjs` and surfaces 3 real swallowed-error sites rule 1 could never have seen:

```
scripts/e2e-paid-mfa-gate.mjs:91              (user_profiles)
scripts/populate-dodaac-directory.mjs:74      (dodaac_directory)
scripts/proposal-finetune/build-training-data.mjs:145 (mindy_rag_documents)
```

They're baselined, not fixed.

**Note:** rule 1's docstring still describes the pre-#311 behaviour ("Admin/cron/scripts are excluded…", "the 15 pre-existing sites") — both now stale. Worth a cleanup pass.

---

## Done this session (context for the above)

| # | what | verified how |
|---|---|---|
| #297 | `.in()` URL overflow — the change log could never run for any NAICS >500 contracts (`541512`, `236220`, `541611`, `541715`) | drove the real prod endpoint: `541614` synced **518 rows, 0 failures**; change log now has **32 rows**, was 0 |
| #298 | `npm run demo:reset` — one command for the 7-times-in-25-days reset loop | dry-run against the real demo account |
| #300 | migration runner + **3 months of drift repaired**: 10 migrations never applied, **16 tables missing** that live code queried | live DB **and** PostgREST: 16/16 present; `sam_sync_runs` 11→17 cols; `user_notification_settings` 69→70 |
| #307 | reset script: silent zero **cancelled the delete**; 8 of 23 tables never ran; `opportunity_shares` keys on `sharer_email` and had **never** been cleaned | dry-run: all 16 real tables report true counts |
| #308 | `federal-contacts`: unknown count made the API claim *"we fetched everything"* and report a partial page as complete | truth table; **behavior NOT verified on prod** — endpoint is 401 auth-gated and the null-count path can't be induced |
| #280 | closed — 129,281 real rows now carry an incumbent UEI (was 93 of 9,481 = 0.98%). The 9,388 without one are all explicitly `quality_flag`-quarantined | live DB |
| #309 | (another session) `drain-cta-tags` / `drain-seo-enrich`: a null count means UNKNOWN, not zero | — |
| #311 | (another session) audit stops skipping `admin/`, `cron/`, `scripts/` — see item 6 | — |

**Two sessions were fixing this class in parallel tonight** and neither knew. #310 was originally branched off older `main` and would have **reverted** #311 and #309; it's been rebuilt on top of them. Worth checking `git log origin/main` before assuming a branch is current.

## The pattern, stated once

Four systems, one root cause: **a failure that renders as a plausible value.**

- `Success. No rows returned` → the migration rolled back, or was never pasted
- `0 row(s)` → the table doesn't exist
- `fetchedAll = true` → we have no idea how many rows there are
- `OK — no findings` → the file is in an excluded directory

Each was fixed at the callsite before. Each came back. **The gate (#310) is the only version of this that stops recurring** — everything else in the table above is a repair, not a prevention.
