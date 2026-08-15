# PRD: Signal Resolution

**Status:** Draft — external source yield PENDING measurement
**Date:** 2026-08-15
**Owner:** Eric Coffie
**Prior art:** `tasks/PRD-federal-events-database.md` (scope guard — read it first), `tasks/target-market-research-roadmap.md` (Slices 4–5, shipped)

---

## TL;DR

We are not adding event sources. We are raising the **resolution** of procurement signals — how precisely we can name the buyer behind a signal.

> **"USACE Norfolk District Industry Day" is intelligence. "DoD Industry Day" isn't.**

The rename matters because it names the actual constraint. "Source Expansion" implies the problem is volume. Measurement says the problem is **specificity**: we can identify the department for 100% of events and the office for 40%.

---

## The measured baseline (2026-08-15, live `sam_events`)

97 upcoming attendable events (`industry_day` / `forecast` / `webinar` / `conference`):

| Level | Field | Coverage |
|---|---|---:|
| Department | `agency` | **100%** (97/97) |
| Requirement | `solicitation_number` | **82%** (80/97) |
| Bureau / Command | `inferred_dodaac` | **49%** (48/97) |
| Office | `inferred_office` | **40%** (39/97) |
| Program | *no field exists* | **0%** |

Across all 3,974 rows the office layer is thinner still — `industry_day` 27%, `forecast` 14%, `webinar` 14%, `conference` **0%**.

### Three findings that shape the work

**1. Resolution collapses at the bureau boundary, and the collapse is DoDAAC-shaped.**
100% → 82% → 49% is a cliff, not a gradient. The office layer exists almost entirely where a DoDAAC could be decoded, so office resolution is not uniformly hard — it is *specifically* a civilian-agency gap. Non-DoD agencies have no equivalent identifier in this data.

**2. The requirement layer outranks the office layer, which inverts the hierarchy.**
`solicitation_number` (82%) resolves better than `inferred_office` (40%). Some missing office data may be recoverable by joining to the parent notice rather than by new ingestion.

**3. Events with no procurement anchor carry no resolution at all.**
`conference` rows are 0% on DoDAAC, office, *and* solicitation. The event types least tied to a specific procurement are exactly the ones with no resolution.

### The structural ceiling

`federal_contacts` holds **209,373 rows / 12,081 distinct offices / 67 agencies** — a real resolution asset. But every row has `source = 'sam_opportunities_poc'`. **Office identity today is entirely SAM-derived.**

That is the finding that justifies this PRD: resolution cannot be improved by parsing SAM harder. It is capped by what SAM notices happen to carry. Breaking the ceiling requires a source that publishes office identity *natively* — which is why OSBP calendars rank first below. An office that publishes its own calendar **is** the resolution.

> ⚠️ The "170-command OSBP directory" referenced in `CLAUDE.md` is **not** in `federal_contacts`. Locate it or treat it as un-ingested before planning against it.

---

## The resolution hierarchy

```
Government
  └── Department      Department of Defense
      └── Agency      USACE
          └── Bureau  Norfolk District
              └── Office      Contracting Division
                  └── Program Waterfront Modernization
                      └── Requirement   W91234-26-R-0001
```

Every new source must enrich a named layer. A source that adds events but no layer is volume, not resolution.

**Program is deliberately un-scoped in Phase 1.** No field exists, and inferring one from titles would be an LLM-guessed fact — prohibited by rule #1. Program needs a real source (PEO listings, forecast records) before it becomes a layer.

---

## Phase 1 scope

### In

1. **Resolution Coverage as a measured metric** — the table above, computed on a schedule, per source and per layer. This is the deliverable that makes everything else decidable.
2. **Ingest sources that carry office identity natively**, priority order:
   1. Agency OSBP / small business office calendars
   2. APEX Accelerators
   3. SBA events
   4. Acquisition Gateway / forecast-linked events
3. **Provenance per event** (schema below), so a resolution claim is always traceable to a source.
4. **Recover office from the parent notice** where `solicitation_number` resolves it — cheap, uses data we already hold.

### Out

- **No `Register` CTA.** 0 of 91 upcoming rows carry a `registration_url`; a dead button damages trust. The honest UI is:
  > Industry Day — Aug 28
  > Department of Defense
  > Related to this opportunity
  > **View notice →**
- **No new events table.** `sam_events` is the table (scope guard, `PRD-federal-events-database.md`).
- **No parallel query path.** `queryScopedEvents` is the query. A flat-concatenating duplicate was written during #1117 and correctly rejected by `scoped-events.unit.test.ts`.
- **No Program layer.** See above.
- **No RFI deletion.** See "What we keep" below.

---

## Schema additions

Extend `sam_events` (never a new table). All nullable — **never infer a value to fill a column**:

| Column | Type | Note |
|---|---|---|
| `registration_url` | text | **nullable, never inferred.** Absent ≠ empty string. |
| `source_url` | text | the page this event was read from |
| `source_type` | text | `sam` \| `osbp` \| `apex` \| `sba` \| `gateway` |
| `organizer` | text | the publishing body |
| `resolution_level` | text | deepest layer confidently identified |
| `start_time` / `end_time` | timestamptz | current `event_date` is date-only |
| `is_virtual` | boolean | |
| `related_forecast_id` | text | link to `agency_forecasts` |
| `last_verified_at` | timestamptz | freshness for scraped rows |

Ship as one idempotent migration through the runner (`npm run migrate`), never the clipboard.

> **Debt to clear first:** `solicitation_number`, `inferred_dodaac`, `inferred_office`, `inferred_subagency` exist in production with **no migration file**. Applied out-of-band; a fresh environment cannot be rebuilt today. Add `ADD COLUMN IF NOT EXISTS` for them in the same migration.

---

## What we keep: the 87% RFI result

3,471 of 3,974 rows are `rfi`. Measured: across 445 upcoming `rfi` rows, a 20-pattern event-signal scan (industry day, matchmaking, pre-bid, site visit, symposium, town hall…) returned **zero** hits. They are correctly classified sources-sought notices, not misclassified events. **There is no hidden pool of events to recover — no classifier work is needed.**

Do not delete them. They are evidence for Buyer Intelligence:

> SAM engagement happens primarily through market-research notices, not scheduled attendance events.

An office that posts 18 sources-sought and hosts 4 industry days behaves differently from one that goes straight to solicitation.

⚠️ **That is a hypothesis, not yet a metric.** Before it becomes a Buyer Intelligence signal it needs (a) a denominator — total notices from that office, since raw counts track office size, not behavior — and (b) a de-duplication check, because a sources-sought notice can itself *announce* an industry day, double-counting one engagement. Measure before publishing.

---

## External source yield — PENDING

**No numbers here yet.** Measurement in flight; do not plan against assumed yield.

| Source | Machine-readable feed | Upcoming events | Registration URL | Office-level specificity | Difficulty |
|---|---|---|---|---|---|
| OSBP / OSDBU calendars | TBD | TBD | TBD | TBD | TBD |
| APEX Accelerators | TBD | TBD | TBD | TBD | TBD |
| SBA events | TBD | TBD | TBD | TBD | TBD |
| Acquisition Gateway | TBD | TBD | TBD | TBD | TBD |

**The tension to design for:** the sources most likely to carry registration URLs (associations, APEX, SBA) are the *least* likely to carry office identity — an APEX matchmaking event is hosted by APEX, not by USACE Norfolk District. OSBP calendars are the probable best-of-both, being published *by* a named small-business office.

**Go/no-go:** a source earns ingestion only if it materially improves registration-URL coverage **or** office-level resolution. Volume alone does not qualify.

---

## Acceptance criteria

1. Resolution Coverage table computed from live data, per layer and per source, reproducible on demand.
2. Every ingested event carries `source_type` + `source_url`; provenance is never inferred.
3. `registration_url` populated **only** where the source actually publishes one — measured, not guessed.
4. Office-level coverage for newly ingested events reported honestly, including when it is worse than SAM's 40%.
5. No `Register` CTA ships in Phase 1.
6. The out-of-band columns have a migration file; a fresh environment rebuilds cleanly.
7. Existing contracts hold: `scoped-events.unit.test.ts` passes; single-tier matching preserved.

---

## Why this matters

**Instead of:** "We collect procurement data."
**We can say:** "We continuously improve the resolution of public procurement signals — from department-level events down to the contracting office and program, when the underlying data supports it."

That clause — *when the underlying data supports it* — is the honest part, and it is only defensible because the coverage table makes the limit visible.

### The next Observatory family

Participation · Competition · Behavior → **Resolution**

"How precisely can we identify the buyer?" is a measurable property of the data itself. It tells us where the next engineering investment should go, and almost nobody else publishes it.

---

## Don't reinvent (scope guard)

When future work touches this, **DO NOT**:

- Create a new events table — extend `sam_events`
- Write a second events query — `queryScopedEvents` is it, and its single-tier contract is enforced by tests
- Narrow `normalizeAgencyKey` to fix one caller — `daily-alerts`, `find-agencies`, `send-notifications` depend on its broad recall. Map at the call site, as `EVENT_AGENCY_TERM` does in `src/app/api/federal-events/route.ts`
- Add a `vercel.json` cron — insert a `cron_jobs` row **after** the route is live and returns 200 on prod
- Infer a `registration_url`, an office, or a program. Absent is a fact; a guess is a defect
