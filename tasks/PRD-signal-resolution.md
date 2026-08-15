# PRD: Signal Resolution

**Status:** Draft — source yield measured 2026-08-15; priority order revised by the data
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

That is the finding that justifies this PRD: resolution cannot be improved by parsing SAM harder. It is capped by what SAM notices happen to carry. Breaking the ceiling requires a source that publishes office identity *natively* — an office that publishes its own calendar **is** the resolution. The measurement below shows this is scarcer than expected: of six sources checked, only VA OSDBU names the buying office, and it carries just 9 events.

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
   1. **SBA** — the only volume source (1,050), but filter hard: most rows are small-business education, not procurement engagement
   2. **VA OSDBU** — only 9 events, but the only source that beats the 40% office baseline
   3. **GSA** — 48 events, ~33% registration, no office naming; marginal
   4. **DoD/DLA PDF spike** — the web calendar is WAF-blocked; DLA's FY2026 calendar is a PDF (unverified)

   *Dropped from Phase 1 by measurement:* APEX Accelerators (no national feed, ~95 sites, stale samples) and Acquisition Gateway (JS-only SPA; `hallways.cap.gsa.gov` dead in DNS).
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

## External source yield — MEASURED 2026-08-15

Every cell below is a real fetch, not an estimate.

| Source | Feed | Upcoming events | Registration URL | Office specificity | Difficulty |
|---|---|---:|---:|---|---|
| **SBA** | no API (JSON:API 401); server-rendered HTML | **1,050** | **100% carry a link** (90% true registration) | ~15% federal office; 20/20 name a host org | **EASY** |
| **VA OSDBU** | no API; server-rendered | **9** | **present**, real WebEx URLs | **STRONG** — e.g. "VHA P&LO RPO West (NCO 17)" | **EASY** |
| GSA | no API; server-rendered | 48 | ~33% (2/6 sampled) | **none** — no region/office named | MEDIUM |
| APEX Accelerators | none; `/events` 404, JS + Cloudflare | **0 nationally** (~95 separate center sites) | varies per center | weak — APEX center ≠ buying office | **HARD** |
| DoD OSBP | **cannot verify** — Akamai 403 (WAF, not robots) | unverified | unverified | unverified | **BLOCKED** |
| Acquisition Gateway | JS-only SPA; `hallways.cap.gsa.gov` **dead in DNS** | **0 scrapable** | n/a | n/a | **BLOCKED** |

### This inverts the planned priority order

Phase 1 was drafted as OSBP → APEX → SBA → Gateway. Measurement reverses it:

- **SBA and VA are the only sources that close the registration gap.** Both deliver ~100% registration-URL coverage against SAM's 0 of 91.
- **VA is the only source that beats the 40% office baseline** — it names the actual buying office ("VHA P&LO RPO West (NCO 17)"), which is precisely the resolution target. But it is only **9 events**.
- **APEX and Acquisition Gateway are not ingestible** as planned. APEX has no national aggregation (~95 heterogeneous center sites) and sampled events were **stale** — one "upcoming" event dated February 2024; another calendar empty.
- **DoD OSBP is edge-blocked by a WAF**, not a robots rule. DLA publishes an FY2026 calendar as a **PDF**, so a PDF-parse spike may exist — unverified.

### The tension was real, and it resolved against volume

The predicted trade-off held: **the high-volume source has the weak resolution, and the high-resolution source has almost no volume.** SBA's 1,050 events are mostly hosted by *resource partners* (SCORE, SBDC, WBC) — not buying offices — and most are small-business education ("Developing a Business Plan"), not procurement engagement. **Filter hard or Phase 1 floods the table with non-procurement rows and resolution coverage gets worse, not better.**

VA is the opposite: 9 events, best-in-class specificity.

**Revised order: SBA (volume, filtered hard) → VA (quality) → GSA (marginal) → DoD/DLA PDF spike. Drop APEX and Acquisition Gateway from Phase 1.**

**Go/no-go:** a source earns ingestion only if it materially improves registration-URL coverage **or** office-level resolution. Volume alone does not qualify — and SBA is the live test of that rule, since unfiltered it adds volume while *lowering* average resolution.

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
