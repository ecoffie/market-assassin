# Scope: restore the KV → Supabase access DR fallback (safely)

**Status:** Phase 1 (shadow telemetry) shipping now. Phases 0 & 2 deferred.
**Owner:** Eric / Claude. **Created:** 2026-07-14.

## Background — how we got here

`src/lib/kv-resilience.ts` wraps all six access checks (Market Assassin, briefings,
content generator, contractor DB, recompete, OH Pro) in a circuit-breaker +
LRU-cache + "fall back to Supabase if KV misses" pattern. The Supabase fallback
(`getAccessFromSupabase`) selected **four columns that don't exist** on
`user_profiles` (`market_assassin_tier`, `market_assassin_expires`,
`access_content_generator`, `access_oh_pro`). Postgres rejected the whole query
with `42703` on **every KV miss** → thousands of errors/day (the bulk of the
project's Postgres error volume). The function returned `null` anyway, so:

> **KV has been the SOLE source of truth for access all along. The Supabase DR
> fallback has never actually granted anything.**

PR #185 (merged, deployed) made `getAccessFromSupabase` return `null` explicitly —
stops the error storm, preserves the exact behavior (KV miss ⇒ no fallback grant),
zero access-control change. That is the current production state.

## Why not just "fix the columns"?

Because a *working* fallback is a behavior change with real over-grant risk:

- The old code fired the fallback on **every `result === null`** from `resilientGet`
  — i.e. on every ordinary **cache/KV miss**, not just when KV is actually *down*.
  So a repaired fallback would consult `user_profiles` constantly and start granting
  access from it in normal operation.
- Per the global access rules, `user_profiles` boolean flags are **"often EMPTY for
  real customers"** — KV is the primary gate, Supabase is a secondary/triple-write
  store that is frequently out of sync. Trusting it as a grant source without
  reconciliation would both **over-grant** (stale/loose rows) and **under-grant**
  (empty rows for paying customers who only exist in KV).

So restoring DR resilience needs two things the disable-fix skips: **correct
columns** AND **KV↔Supabase reconciliation** first — plus a gating change so the
fallback fires only on a genuine KV **outage**, not on every miss.

## The corrected column mapping

| Access type       | Old (wrong) column           | Real `user_profiles` column   | Notes                          |
|-------------------|------------------------------|-------------------------------|--------------------------------|
| Market Assassin   | `market_assassin_tier`       | `ma_tier`                     | `'free'`/null ⇒ no grant       |
| MA expiry         | `market_assassin_expires`    | *(none exists)*               | no expiry column — treat as ∞  |
| Briefings (Pro)   | `briefings_access`           | `access_briefings`            | honor `briefings_expires_at`   |
| Content generator | `access_content_generator`   | `content_generator_access`    |                                |
| Contractor DB     | `contractor_db_access`       | `access_contractor_db`        |                                |
| Recompete         | `recompete_access`           | `access_recompete`            |                                |
| OH Pro            | `oh_pro_access`              | `access_hunter_pro`           |                                |

## Rollout plan

### Phase 1 — Shadow telemetry (THIS PR, `feat/kv-fallback-shadow`)
Additive, non-enforcing. On live **sampled** traffic, read the *corrected* Supabase
columns and log KV-vs-Supabase agreement per access type. Enforcement stays KV-only.

- Flag-gated: `KV_FALLBACK_SHADOW=on` (default off ⇒ complete no-op: no client, no
  query, no log). Sample rate `KV_FALLBACK_SHADOW_SAMPLE` (default `0.05`).
- Emits `[kv-shadow] {type, kv, supabase, agree}` to logs. Never throws, never
  touches the access decision. 10s per-email cache so one request = ≤1 Supabase read.
- **Goal:** answer "if the fallback were repaired, how often would it agree with
  KV?" *before* letting it grant. High disagreement ⇒ reconcile first; high
  agreement ⇒ Phase 2 is low-risk.
- **How to run:** `KV_FALLBACK_SHADOW=on` in Vercel Prod, let it collect, then read
  the `[kv-shadow]` lines (Vercel logs). Turn the flag off to stop.

### Phase 0 — Reconciliation (prerequisite for enforcement, deferred)
Before any Supabase read is allowed to *grant*: backfill KV → Supabase so every live
KV grant has a matching `user_profiles` row/flag, and fix the triple-write path so
new purchases write all three stores atomically (never `continue` past a Supabase
failure and skip the KV write — but also don't leave Supabase permanently behind).
Driven by what Phase 1 disagreement reveals.

### Phase 2 — Enforce, outage-gated (deferred)
Re-enable a real fallback that:
1. Uses the corrected columns (table above).
2. Fires **only on a genuine KV outage** (circuit breaker OPEN), NOT on every miss —
   change the trigger so a normal miss returns "no access" as it does today.
3. Ships behind its own flag with a fast rollback.

## Risks / mitigations

- **Over-grant from stale Supabase rows** → Phase 0 reconciliation + outage-only gating.
- **Under-grant (empty Supabase rows for KV-only customers)** → same; measured in Phase 1.
- **Perf / added Supabase load** → sampled + short-cached in Phase 1; outage-only in Phase 2.
- **Shadow noise** → single-line JSON tag `[kv-shadow]`, sampled at 5%.

## Open questions
- Confirm `ma_tier` values in the wild (`'standard'`/`'premium'`/`'free'`/null?) — the
  shadow treats any non-`'free'`, non-null `ma_tier` as granted.
- Is there any MA expiry signal at all, or is MA access effectively permanent once set?
- Do we ever want briefings expiry enforced from Supabase, or is KV TTL the only clock?
