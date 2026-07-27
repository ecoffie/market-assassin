# PRD: Data Invariants Watch — catch the software producing a wrong-but-valid outcome

**Status:** ☑ PRD · ☐ Approved to build
**Owner:** Eric / Claude
**Date:** 2026-07-27
**Trigger:** The NAICS family blow-out (fixed 2026-07-27) — one preset click silently
stored 51 codes on a user's profile. It ran for ~4 months, corrupted 1,144 profiles, and
was found only because Eric happened to screenshot a customer's settings page on his phone.

> Nightly job that asserts a small set of **data-shape invariants** and alerts to Slack the
> moment one breaks. Not "did the cron run" (the dispatcher watchdog owns that) — this is
> **"is the data the software produced still sane."** The bug class it targets is the one
> that passes every test, throws no error, and quietly writes wrong-but-valid rows.

---

## 1. Problem statement

**The failure mode we have no defense against.** Every existing check answers *did it run?*
— `dispatcher-watchdog` (job status), `db-health-watch` (reachability/latency/pressure),
`check-data-freshness` (is the source stale). All three would have reported **fully healthy**
throughout the NAICS incident. The jobs ran. The DB was fast. The data was fresh. It was
also **wrong**, and nothing in the stack was looking at its shape.

**Evidence it's real — the incident, measured:**

| Signal that existed in the DB the whole time | Value when found | Would a 1-line assertion have caught it? |
|---|---|---|
| Profiles holding an identical 51-code NAICS array | **710** | Yes — 710 identical arrays is impossible organically |
| Profiles over 25 NAICS codes | **1,089** (12% of profiles) | Yes |
| Largest single profile | **241 codes** | Yes |
| Profiles holding unusable 2–3 digit codes | **149** | Yes |
| Profiles whose targeting matched **nothing** | **16** | Yes |
| Share of alert volume from the bloated 12% | **82%** (52,017 of 63,202) | Yes — the loudest signal of all |

Every one of those is computable from tables we already have, with no new instrumentation.
**The data was screaming for four months and nothing was listening.**

**Why tests didn't catch it.** They passed — and were useless here. The unit suite asserted
`expandNAICSCodes('541512', false) === ['541512']`, which is true. The bug lived in an input
shape nobody thought to test (a 3-digit prefix). **Tests check the cases you imagined;
invariants check the shape of reality.** We need both, and we only have one.

**Secondary finds from the same investigation** (each its own silent wrongness, all still live):
- `alerts_opened_30d` = 0 and `last_click_at` = null for **all 1,792** alert-enabled users —
  the engagement columns are never written. We could not prove customer harm with data.
- **930 profiles** have no NAICS codes at all.
- **2 profiles** still have zero matchable codes after remediation.

---

## 2. Reuse check (what already exists — do NOT rebuild)

| Existing | What it gives us | Verdict |
|---|---|---|
| `src/app/api/cron/db-health-watch/route.ts` | KV-backed state, **transition-only alerting**, 30-min flap rate-limit, severity ladder | **Copy this shape exactly.** It already solved "don't spam a sustained incident." |
| `src/lib/ops-alert.ts` → `sendOpsAlert()` | Slack delivery to a watched channel | Reuse as-is (per the ops-alerts-to-Slack rule). |
| `cron_jobs` row + `/api/cron/dispatch` | Scheduling | Reuse. **No `vercel.json` cron** (100-cron cap rule). |
| `check-data-freshness` | Per-source staleness registry pattern | Reuse the registry *shape*; different subject. |
| `scripts/audit-supabase-errors.mjs` | Pre-push gate precedent | Model for the CI half (§6). |

Net new code is **one route + one registry file**. Everything else is composition.

---

## 3. Scope

### In scope (v1)
A single dispatcher-fired route, `/api/cron/data-invariants-watch`, that:
1. Evaluates a declarative registry of invariants (each = a name, a SQL/PostgREST probe, a
   threshold, a severity, and a one-line "what this means").
2. Compares each result to its threshold.
3. Alerts to Slack **on transition only** (ok→breach, breach→worse, breach→recovered).
4. Returns a JSON report so `?dry_run=true` is a usable manual audit.

### The v1 invariant registry

Thresholds are set from **today's post-remediation reality**, so a breach means real drift.

| # | Invariant | Threshold | Today | Catches |
|---|---|---|---|---|
| 1 | Profiles with >25 NAICS codes | < 3% of profiles-with-codes | 2.1% (200) | Family blow-out returning |
| 2 | Identical NAICS array shared by many profiles, **excluding the allowlist** | ≤ 20 profiles | 31 ⚠️ | Bulk seed / preset explosion |
| 3 | Profiles holding a 2–3 digit NAICS code | ≤ 5 | 1 | Unmapped preset leaking stubs |
| 4 | Profiles with codes but **zero** matchable (6-digit) codes | ≤ 5 | 2 | Targeting that silently matches nothing |
| 5 | Alert-volume concentration: share of sends from top 10% of profiles | < 40% | was 82% | The distribution tell — loudest signal |
| 6 | Alert-enabled users with zero engagement telemetry | < 90% | 100% ⚠️ | Dead instrumentation (currently breached) |
| 7 | Alerts ON but no NAICS **and** no keywords | ≤ 50 | **279** ⚠️ | Users who can never be matched |

**Invariant 2 needs an allowlist or it is useless.** Measured on real data, the top shared
arrays are:

| Profiles | Array | Verdict |
|---|---|---|
| **7,908** | `541512,541611,541330,541990,561210` | **Legitimate** — `DEFAULT_NAICS` from `scripts/batch-enroll-alerts.js` |
| **709** | `541330,541511,541512,541519,541611,541618,541690,541990` | **Legitimate** — output of our own 2026-07-27 remediation |
| 31 | `518210,541330,…` | Curated set + one extra — plausible |
| 23 | `561110,561210,…` | Curated 561 set |

Both large clusters are *intended* seeds. A naive "identical arrays are suspicious" check
would fire forever on 7,908 rows and be muted within a week. The invariant must hold a small
**allowlist of known-good arrays** (the enrollment default + each curated coverage set) and
alert only on an unrecognized cluster. **This is the single most important design detail in
the build** — and it is only knowable by measuring first, which is the same discipline whose
absence caused the original bug.

**Invariant 6 ships breached on purpose** — it makes the dead engagement columns visible
instead of letting them rot silently for another four months.

**Invariant 7 ships breached at 279** (measured, not estimated). Threshold set at 50 so the
number must come *down*; these users have alerts enabled and no possible way to be matched.

### Out of scope (v1)
- Auto-remediation. This **detects and reports**; a human decides. (Bulk writes need approval
  per the ask-before-bulk rule — an auto-fixer would violate it by construction.)
- ML/statistical anomaly detection. Explicit thresholds are debuggable at 2am; a model is not.
- Invariants on non-user tables (`sam_opportunities`, `federal_contacts`). Add in v2 once the
  pattern proves out — `gov-buyers-data-quality-2026-07-26.md` already documents a 34% defect
  rate there, so there's a clear v2 backlog.
- A dashboard. Slack + the JSON endpoint is enough for v1.

---

## 4. Design

**Route:** `src/app/api/cron/data-invariants-watch/route.ts`
**Registry:** `src/lib/data-invariants/registry.ts` — invariants as data, not code, so adding
one is a 6-line object, not a new function.

```ts
type Invariant = {
  id: string;                    // 'naics.bloated_profiles'
  label: string;                 // human sentence for the Slack line
  severity: 'warn' | 'critical';
  probe: () => Promise<number>;  // returns the measured value
  threshold: number;
  compare: 'lte' | 'lt' | 'gte'; // measured vs threshold
  means: string;                 // "what broke if this trips" — goes in the alert
};
```

**Why a registry and not ad-hoc queries:** the point is that adding an invariant after the
*next* incident costs 6 lines. If it costs a new route, nobody will do it, and this becomes
another one-off.

**Alerting.** Transition-only via KV (`db-health-watch` pattern). Breach → one Slack alert
naming the invariant, measured vs threshold, and `means`. Sustained breach → silent. Recovery
→ one "resolved" line. Prevents the exact stale-status spam we fixed on the dispatcher
watchdog yesterday.

**Schedule.** Daily via a `cron_jobs` row (`0 13 * * *` = 9am ET). Cheap: 7 aggregate counts.

**Timestamps.** ET + UTC in every Slack line (per the ET+UTC rule).

**Auth.** Bearer `CRON_SECRET` (dispatcher) or `?password=ADMIN_PASSWORD` (manual), matching siblings.

---

## 5. The generalizable rule (why this is worth building)

Three rules fall out of the NAICS post-mortem. #1 is this PRD; #2 and #3 are cheap add-ons.

1. **Assert the distribution, not just the unit.** A correct function composed into a wrong
   system is invisible to unit tests. Shape checks catch it. *(This build.)*
2. **Amplification guard on write paths.** No single user action should multiply stored values
   >5×. One click → 51 codes is 51×. Log/alert when a persist path writes N values from M
   inputs where N/M > 5. Catches the *category*, not this instance. *(§6, phase 2.)*
3. **Identical-blob detection is a free bulk-bug tripwire.** 710 byte-identical arrays can
   never be organic. Invariant 2 generalizes to any user-owned array/JSON column.

---

## 6. Phases

**Phase 1 — the watch (this build).** Registry + route + `cron_jobs` row. 7 invariants.
Verify by running `?dry_run=true` against prod and confirming measured values match
hand-written SQL. **Acceptance:** every invariant's measured value equals an independent
query; a deliberately lowered threshold produces exactly one Slack alert, and a second run
produces none.

**Phase 2 — write-path amplification guard.** Shared helper in the persist paths
(`normalizeNAICSForPersist` and siblings) that warns when output/input > 5×.

**Phase 3 — CI invariant.** Add to the pre-push gate: fail if a new persist path writes a
user-owned array without going through a normalize/cap helper. Mirrors
`audit-supabase-errors.mjs` (which already hard-blocks the `{data}`-without-`{error}` bug).

---

## 7. Acceptance criteria

- [ ] `/api/cron/data-invariants-watch?dry_run=true` returns all 7 invariants with measured values
- [ ] Every measured value verified against an independent hand-written SQL query
- [ ] Invariant 2 does **not** trip on the 717 legitimately-identical curated arrays
- [ ] Breach fires exactly one Slack alert; sustained breach fires none; recovery fires one
- [ ] Scheduled via a `cron_jobs` row — no `vercel.json` cron added
- [ ] Slack lines carry ET + UTC
- [ ] Invariants 2 and 6 correctly report as **currently breached** on first run (they are)

## 8. Open questions

1. **Invariant 6 (dead engagement telemetry) — fix or drop?** The columns exist and are never
   written. Either wire open/click tracking or delete the columns. Alerting on a metric we've
   chosen not to collect is noise. *Needs Eric's call.*
2. **279 alert-enabled users with no NAICS and no keywords** (measured) — they have alerts ON
   and cannot be matched by anything. Prompt in-app, email them, or auto-disable alerts until
   they set targeting? Sending nothing forever is the worst of the three.
3. **Alert channel** — same `SLACK_OPS_CHANNEL` as the dispatcher watchdog, or its own? Data
   drift is less urgent than an outage; a separate channel may prevent alert fatigue.
