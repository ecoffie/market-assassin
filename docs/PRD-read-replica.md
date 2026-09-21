# PRD — Read Replica (Resilience Roadmap Phase 1)

**Author:** Eric Coffie + Claude
**Date:** 2026-07-05
**Status:** Scoped, not started — decision needed on the paid infra step
**Grounded in:** the 2026-07-04 resilience roadmap + a real audit of the read surface (2026-07-05).

---

## What a read replica is (plain version)

A read replica is a **second, continuously-synced copy of your Postgres database** that can only be read from, never written to. Supabase provisions and syncs it for you. You point your **heavy, read-only traffic** (the alert crons, briefing precompute, dashboards) at the replica, and keep **writes + user-facing reads** on the primary.

**Why this is the single most "HigherGov-tier" step:** the big GovCon data players (GovWin, HigherGov) don't have exotic infra — they have *a managed database with a replica so analytics never competes with live users*. This is that, for ~$70/mo.

---

## Why it matters here — grounded in the real failure

The June 30–July 3 outage was primarily a Supabase platform incident, but the **contributing risk** was load: heavy read jobs and live user traffic hit the **same single database instance**. Specifically:

- **`daily-alerts`** runs **150 users/batch × 4 times/day**, and each user triggers a read of the ~88K-row `sam_opportunities` table (before the FTS fix, a full scan). That's the exact class of query that competed with live users under memory pressure.
- **Briefing precompute, weekly-alerts, SAM sync, SOW embedding, forecast reads** — all bulk read jobs, all on the primary.
- **359 places in the code create a Supabase client** — today they ALL hit the one primary.

A replica moves that bulk read load OFF the instance serving live users. If the primary has a bad moment, **reads on the replica keep working** — which, combined with the last-good layer we already shipped, means the app stays up through more failure modes.

---

## The honest complication (why this is a *scoped* PRD, not a 1-hour job)

**There is no shared Supabase client factory.** All 359 client creations are ad-hoc `createClient(URL, KEY)` calls scattered across routes and libs. Supabase routes replica reads by **connecting to a different host** (the replica has its own connection string / a `?read-only` load-balanced endpoint). So "use the replica" is not a global switch — *something* has to choose the replica URL for the right calls.

This shapes the implementation: **we do NOT retrofit 359 call sites.** We introduce one factory and migrate only the ~10 heavy read paths to it. Everything else keeps using the primary, unchanged.

---

## Scope — 3 steps, smallest-blast-radius first

### Step 1 — Enable the replica (Supabase dashboard, ~5 min, ~$70/mo)
- Supabase → Database → **Replication / Read Replicas** → add one replica (same region).
- Supabase gives a replica connection endpoint. Add it as `SUPABASE_REPLICA_URL` in Vercel (anon/service keys are the same as primary).
- **No code ships yet** — nothing routes to it until Step 2. Zero risk.

### Step 2 — A read-client factory (small, additive)
- `src/lib/supabase/read-client.ts` — `getReadClient()` returns a client pointed at `SUPABASE_REPLICA_URL` when set, else falls back to the primary URL (so it's safe before/without a replica, and in preview/local).
- `getWriteClient()` = the primary, unchanged. Writes NEVER go to the replica.
- **Guardrail:** the factory is the only thing that reads `SUPABASE_REPLICA_URL`. If the env is unset, every call transparently uses the primary — so shipping this is a no-op until the replica exists.

### Step 3 — Migrate the ~10 heavy read paths (one at a time, measured)
Repoint ONLY these to `getReadClient()` — the bulk read jobs, never the write paths:
- `daily-alerts`, `weekly-alerts` (the biggest offenders — per-user sam_opportunities reads)
- `precompute-briefings` / `send-briefings-fast`, weekly + pursuit precompute
- forecast reads, recompete/mi-dashboard heavy list reads
- SOW/embedding read scans

**Replication lag caveat (the one real gotcha):** a replica is typically <1s behind the primary but can lag under load. So a path that WRITES and then immediately READS ITS OWN write must stay on the primary (or read the primary for that one call). The alert/briefing crons are pure reads of already-synced data → safe. We audit each path for read-after-write before moving it.

---

## What this is NOT (scope guardrails)
- **Not** a global switch — we migrate ~10 paths, not 359.
- **Not** a write path — writes stay on the primary, always.
- **Not** Phase 3 (Redis cache tier) or Phase 4 (managed Postgres SLA) — those come later, if revenue/contracts pull for them.
- **Not** required for the vault/trust/backup work already shipped — this is throughput + outage-resilience, separate concern.

---

## Cost / benefit

| | |
|---|---|
| **Cost** | ~$70/mo (one same-region replica). No engineering cost beyond ~half a day for Steps 2–3. |
| **Benefit** | Bulk read load off the live-user instance; reads survive a primary hiccup; headroom for the multi-client (NCMBC/enterprise) growth. The concrete "HigherGov-tier" line for the demo. |
| **Reversible?** | Fully — unset `SUPABASE_REPLICA_URL` and every path falls back to the primary. Drop the replica in the dashboard. |

## Recommendation
Do it **after** the demo, not before (no need to change infra the week of a demo). It's cheap, it's the right next architectural step, and it's low-risk because the factory falls back to the primary when the env is unset. Sequence: enable replica → ship the factory (no-op) → migrate `daily-alerts` first, watch it, then the rest.

## Success criteria
- [ ] `daily-alerts` reads hit the replica (verify via Supabase replica metrics showing query load).
- [ ] Primary instance CPU/memory during the morning alert window measurably drops.
- [ ] Zero read-after-write bugs (each migrated path audited as pure-read).
- [ ] Unsetting the env cleanly reverts every path to the primary (tested).
