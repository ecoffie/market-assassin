# FROZEN — SBA certification freshness layer (future infrastructure)

**Status: FROZEN 2026-08-25 by Eric. Do NOT resume without an explicit new decision.**

> "No new Rule-of-Two or SBA-data capabilities unless they are required to close an
> existing bug. We are back in bug-fix mode."

## Why frozen

This track began as a narrow correctness fix (8(a) eligibility) and grew into a
certification data architecture. The 8(a) fix SHIPPED and is verified. Everything after
it was making the data layer more elegant while user-visible Mindy defects stayed open.
Scope discipline, not a technical failure.

## What SHIPPED and stays live

**PR #1341 — 8(a) requires a CURRENT certification.** Merged, production-verified.
- 8(a) pool 5,510 → 4,066 (1,444 false-current eligibilities removed, 26.2%)
- **0 of 30** real Rule-of-Two determinations flipped
- KILIUDA excluded from current eligibility, still historically visible
- Verification is re-runnable: `node scripts/verify-8a-certcurrency.mjs`
- HUBZone/WOSB/SDVOSB/VOSB deliberately untouched

## What is BUILT but UNCOMMITTED (deliberately)

Working tree only; none of it is on a branch:
- `supabase/migrations/20260825_sba_certification_status.sql` — **APPLIED to prod**,
  table exists and is verified, currently holding 1,288 rows (644 UEIs). Additive and
  inert: nothing reads it.
- `src/lib/sba/certification-api.ts` — SBA client (keep-alive pooling, UA, 4-way outcome)
- `scripts/resolve-sba-certifications.ts` — resumable drain + circuit breaker
- `scripts/sam-vs-sba-census.ts` — the SAM-vs-SBA cross-tab, never run

The migration is applied but UNREAD by any product code, so the frozen state is safe.
If the table is ever dropped, drop the migration file with it.

## What was LEARNED (the durable value — do not re-derive)

1. **SAM field 117 is NOT a certification-currency source.** It carries an expiry date,
   not a state. SBA terminates 8(a) participation EARLY (graduation, withdrawal,
   termination), so a firm can be out of the program while its stored expiry still reads
   future. Measured: **18 of 150 (12%)** firms our date rule calls "current 8(a)" are
   EXPIRED per SBA → ~490 residual false-current in the live 4,066 pool. **The shipped
   filter under-removes; it never over-removes (0 of 150 wrongly excluded).** It is a
   safe, conservative interim rule.

2. **HUBZone must NEVER inherit the 8(a) rule.** Only 12.6% of HUBZone tokens carry a
   date. Applying the same filter would drop 4,007 of 4,405 firms — **96% of that loss
   is `unknown`, not `expired`** — and would flip **7 of 48** real Rule-of-Two markets
   (236220/VA 39→0). That converts "we don't know" into "not eligible": evidence failure
   rendered as a fact about the world.

3. **`no_record` in SBA corroborates a lapse; it is not "unknown".** Asymmetry test:
   "no SBA record" is 52.7%/41.3% in SAM-*expired* cells and 0.0%/6.0% in SAM-*current*
   cells. SBA does not retain lapsed program entries. 27% of those firms still carry
   OTHER SBA certs, so the profile resolves — retention, not a bad identifier.

4. **Read SBA's `active`/`status` flag, never `exitDate`.** A record can be status
   "Expired" with a FUTURE exitDate (observed live on FEDSCALE).

5. **Deliberate slow pacing can be the BUG.** SBA sits behind CloudFront: a cold
   connection costs **20-26 seconds**, a warm one 13-40ms. Pacing at 5 req/s let the
   socket go cold between calls, so the drain paid setup on nearly every request — 12x
   slower than its own limit, and `unresolved` climbed 1% → 35% as setup exceeded the
   timeout. **Connection reuse is the real politeness lever; it loads SBA LESS than
   repeated TLS renegotiation.** Reproducible with curl, so not a Node defect.

6. **`node:https` needs an explicit User-Agent** — CloudFront 403s without one, and
   global `fetch` sets it implicitly. Dropping to a pooled agent silently broke every
   call until that was added.

7. **A burst benchmark does not measure sustained behaviour.** "122 req/s clean" was
   measured on warm connections and told us nothing about a paced drain. Reported as a
   floor, then wrongly used to design pacing.

## Where the drain stopped

**644 of 9,418 UEIs resolved (6.8%).** Halted because SBA's search index went persistently
degraded — `HTTP 500 "No matching MeiliSearch document found for uei = ..."` on the whole
endpoint, including public profiles reachable from SBA's own UI that had resolved minutes
earlier. Not our traffic; not a rate limit. Health probe: 0/8 across all three classes.

## If this is ever resumed

`wait → tiny health probe (3 classes) → proving batch 100-200 → commit the transport →
resume from checkpoint → reconcile → census → THEN decide whether 8(a) switches to SBA`

The census script is written and type-clean. **Do not switch `market-research.ts` to SBA
status without the full census** — sample estimates (12%) are not a census.
