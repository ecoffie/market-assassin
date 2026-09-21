# Data Quality Audit — All Sources (2026-06-19)

**Why:** We grounded Market Research's LIVE-query numbers (June 17-18). This is the
follow-on "truth audit" of the CACHED/synced tables those + other surfaces read from.
**Run it yourself:** `npx tsx scripts/data-quality-audit.ts` (read-only, re-runnable).

**Key distinction the audit surfaced:** *bad rows in a table ≠ bad data reaching users.*
Several issues are real in the table but already filtered out before they hit the UI.
Each finding below notes whether it's USER-FACING.

---

## 🔴 HIGH — corrupt values that LEAK to the UI (fixed)

| Source | Issue | Count | User-facing? | Fix |
|--------|-------|------:|--------------|-----|
| recompete_opportunities | Implausible values (>$100B: $2.8T Carahsoft, $1T Wheelhouse) | 2 | **YES** — sort to top of the value view | ✅ quarantine flag |
| recompete_opportunities | Round-number placeholder values ($100M/$1B exact, parse artifacts) | 84 | **YES** — look fake on screen | ✅ quarantine flag |

**Status:** FIXED via `quality_flag` quarantine. Migration `20260619_recompete_quality_flag.sql`
(hand-run) flags the 86 rows; the Expiring Contracts query now filters `quality_flag IS NULL`.
Reversible — nothing deleted; re-derive correct values from USASpending later.

---

## 🟡 MED — real gaps (not corruption); ranked

| Source | Issue | Count | User-facing? | Plan |
|--------|-------|------:|--------------|------|
| recompete_opportunities | Already-expired rows in the table | 2,624 (28%) | **NO** — list query already filters `expiry > today` | Optional cleanup; not urgent. Single-by-ID path could still show one. |
| sam_opportunities | `sub_tier` null on 100% of rows — no service-branch granularity | 99,260 | Indirect — **blocks Navy/Army/AF slicing** (the Navy Gold Coast demo) | Sync fix: populate sub_tier from agency_hierarchy. Scoped, not yet built. |
| federal_contacts | Null contact_email | 82,017 (60%) | **YES** — the "125K contacts" includes ~54K actually-emailable | Be honest in marketing: cite contactable count separately. Enrichment is a project. |

---

## 🟢 LOW — known / expected (not corruption)

| Source | Note |
|--------|------|
| agency_forecasts | pop_state null on 4,219; set_aside_type null on 3,878 — filters work on populated rows (~half). Known. |
| sam_opportunities | 66,304 archived/expired retained (fine — list filters active-only) |
| sam_events | 1,141 past events (fine if "upcoming" views filter by date — verify) |
| sba_goaling (192), agency_intelligence (557) | present, FY2023/curated reference. OK. |

---

## What this changes about "we grounded everything"

Market Research's **live numbers** ARE grounded (that work holds). This audit covers the
**separate cached layer** — different pipelines. The honest summary:
- The ONLY corruption actually reaching users was the 86 recompete value rows → now quarantined.
- The bigger items (sub_tier granularity, contact emails) are **gaps, not lies** — features
  that don't cover everything, which is fine if we don't overclaim.

## Follow-ups (ranked) — SWEEP COMPLETE 2026-06-19
1. ✅ DONE: quarantine recompete corrupt values — 91 rows flagged (2 implausible + 84
   placeholder + 5 all-9s sentinel); query filters `quality_flag IS NULL`. Real $50-82B
   GWAC ceilings (GDIT/IBM/Accenture) deliberately LEFT IN — they're legitimate.
2. ✅ DONE: sam_opportunities sub_tier — backfilled 99,095/99,260 rows from
   agency_hierarchy[1] (Navy 11,316 / DLA 43,342 / Army 9,172 / AF 5,746). Sync patched
   so new rows populate it. Navy Gold Coast demo unblocked.
3. ✅ DONE (UI): federal_contacts — 135,954 total but 53,937 emailable (40%). Panel now
   shows "X with email on file" honestly; API returns emailableTotal. Marketing copy
   left for the content team (separate pass).
4. ⬜ Optional/low: purge/re-derive the 2,624 expired recompete rows (already hidden by
   the date filter — cosmetic).
5. ⬜ TODO: add these checks to `verify-data-truth.ts` so they're caught on every deploy
   (the durable fix — prevents the next silent data rot).

## Lesson logged
For a 99K-row column transform, the in-database SQL UPDATE is the right tool — the
row-by-row tsx loop timed out at ~13K (rule #7 nuance: bulk *transform* = SQL; bulk
*per-record API logic* = local runner). The bulk SQL finished the rest instantly.

*Audit script: `scripts/data-quality-audit.ts`. Migration: `20260619_recompete_quality_flag.sql`.*
