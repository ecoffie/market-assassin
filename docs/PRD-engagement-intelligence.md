# PRD — Engagement Intelligence (the fifth pillar)

**Status:** Phase 1 SHIPPED (the graph). Phases 2–4 planned, gated on usage.
**Author:** Eric Coffie (direction) · drafted 2026-08-15
**One-line purpose:** *Tell contractors where and how to engage buyers **before** the solicitation.*

---

## The pillar

Mindy already answers four questions. This is the fifth, and nothing in the stack answered it:

| Pillar | Answers |
|---|---|
| Market Intelligence | **where** demand is |
| Buyer Intelligence | **who** is buying |
| Opportunity Intelligence | **what** to pursue |
| Company Intelligence (Vault) | **what you can do** |
| **Engagement Intelligence** | **when and how to meet them** |

Engagement is the pre-solicitation layer: every meaningful interaction between a public buyer and
a supplier before an RFP exists. That is where most bids are actually decided, and it is the one
axis no GovCon platform has assembled alongside the other four.

---

## The organizing principle: the GRAPH, not the count

> *"Most platforms collect RECORDS. You're building RELATIONSHIPS. An industry day by itself isn't
> valuable. An industry day connected to a buyer, a forecast, an opportunity, and eventually an
> award becomes intelligence."* — Eric, 2026-08-15

**Do not frame this as "the largest engagement database in North America."** Volume is the part a
competitor can copy — GovSpend and Onvia have scraped public meeting calendars for years. The
defensible asset is the **engagement graph**: an event wired into the opportunity, buyer, forecast
and award graphs Mindy already owns. A thousand connected events beat fifty thousand loose ones.

```
Event ──notice_id──▶ Opportunity ──naics──▶ Forecast
  └────dodaac──────▶ Buyers (KOs / POCs)
```

### The edges are NOT the same kind — and the UI must never pretend they are

Measured 2026-08-15 against live data, before any of this was built:

| Edge | Key | Coverage | Kind |
|---|---|---|---|
| Event → Opportunity | `notice_id` FK | **495 / 503 = 98.4%** | **FACT** |
| Event → Buyers | DoDAAC prefix on `solicitation_number` | **156 / 170 with a DoDAAC = 92%** | **FACT** |
| Event → Forecast | shared NAICS | 306 events, 75 codes | **INFERENCE** — same *market*, not the same buy |

The API returns `edges: { opportunities: 'fact', buyers: 'fact', forecasts: 'inferred' }` so every
surface can label the third honestly ("related market") instead of implying the forecast belongs to
the event. This repo already carries the `piid_solnum_no_link` scar — a join that was *assumed*
rather than measured and turned out to be 0%. Measure every new edge before shipping it.

---

## What the data actually is today (measured, not estimated)

| Fact | Number |
|---|---|
| `sam_events` rows | 3,948 |
| …of which `event_type='rfi'` (sources-sought NOTICES, already opportunities) | **3,451 — excluded** |
| Genuinely attendable (industry_day / forecast / webinar / conference) | **497** |
| Upcoming at any moment | **91** |
| New attendable events ingested per month | **~110–140** (healthy, growing) |
| Upcoming events carrying an agency | 91 / 91 |
| …carrying a buying-office DoDAAC | 45 / 91 |
| …carrying a usable location | **11 / 68** — 57 are truncation junk |
| …carrying a registration URL | **0** |

Two consequences drive the phasing:

1. **91 upcoming is a snapshot, not the corpus.** Industry days happen and expire; ~1,300+ flow
   through per year. Do not reason about this feature from the standing count.
2. **Extraction quality is the binding constraint, not source count.** Zero registration URLs means
   a "Register →" button would be dead on every row today.

---

## Phase 1 — Prove the graph ✅ SHIPPED

Use the existing 3,948 events. Build and expose the relationships; validate that contractors
actually use them before funding ingestion.

**Delivered**
- `queryScopedEvents` — upcoming events, **best-match hierarchy** (notice → office → agency),
  single-tier, each labeled ("Matched to this solicitation" / "Matched to buying office" /
  "Department-wide event"). Never cumulative: agency events are never stacked under a notice match.
- `queryBuyerEventDna` — PAST events as named behavior signals ("Runs Industry Days — 7 in the past
  year"). Each signal emitted only from its own evidence.
- `queryEngagementGraph` — the full event → opportunity → buyers → forecasts resolution with
  per-edge provenance.
- Surfaced on the opportunity drawer, the Network buyer drawer, and Market Research.

**Live proof:** Navy FTSS VI industry day (Aug 18 2026) → 1 opportunity (NAICS 541330) + 8 named
buyers + 5 same-market forecasts, `degraded: false`.

**Deliberately NOT built:** an events map. `event_location` is junk on 57/68 rows, and the
relationship is worth more than the coordinates. *"If I have Army Industry Day → Army Opportunity →
Army Forecast, I don't actually need latitude and longitude."*

**Exit criteria before Phase 2:** measurable engagement with the event surfaces (opens,
click-through from an opportunity to its event, DNA-signal views). If contractors ignore it,
stop — do not expand ingestion into a feature nobody uses.

---

## Phase 2 — Extraction quality (better sources, not more)

Improves the usefulness of **every event already in the table**. Ordered by user impact:

1. **Registration URL** — top of the backlog. Without it a user has to Google; with it the feature
   is immediately actionable. Currently 0/91.
2. **Event location** — currently 11/68 usable. Fix the extractor rather than the display guard.
3. **Virtual vs in-person** — decides whether a contractor can attend at all.
4. **Registration deadline** — distinct from the event date; the real action deadline.
5. **Host organization** — who is convening (the office, an association, a PTAC/APEX).

---

## Phase 3 — Federal source expansion (tractable)

Dozens of sources, mostly stable HTML, high signal:

- **Agency calendars:** SBA, APEX Accelerators, OSDBU (per-agency), GSA, DoD, VA, DHS, DOE, NASA
- **Pre-bid conferences** — likely the cheapest real win: many are already inside SAM notice text,
  the same place industry days come from. Check coverage before building a new scraper.
- **Forecast briefings** — the *meeting about* the forecast, not the forecast row itself
- **Associations:** SAME, NCMA, AGC, ABC, NIGP, NASPO (few sources, high signal, some gated)

New event types this unlocks: `pre_bid`, `matchmaking`, `training`, `networking`, `public_meeting`.

---

## Phase 4 — State & local (its own program)

Thousands of sources, each its own format, many PDF-only or behind Granicus/Legistar portals:
state procurement conferences, county supplier fairs, school-district vendor days, municipal
outreach, transportation/port authority meetings, public bid openings.

**Different funding, timeline and architecture from Phases 1–3. Do not start it until Phase 1
usage proves the layer earns attention** — federal users may spend ~95% of their time on industry
days, pre-bids and forecast briefings and never touch local networking events. Let usage pull the
roadmap.

---

## Where this shows up when complete

| Surface | Shows |
|---|---|
| Every opportunity | Related event + "Register →" *(pending Phase 2)* |
| Every buyer | "Runs quarterly outreach" — engagement cadence |
| Every market | "Upcoming events · Construction · Florida · 8" |
| Every report | An Engagement Activity section |

Plus **recommendations**: *"Army Industry Day — because you pursue Army facilities work"*, reusing
the same NAICS/agency profile matching the alerts already run on.

---

## Non-goals

- **Not** an events map (see Phase 1).
- **Not** a volume race. The graph is the moat.
- **Not** RFI/sources-sought republication — those are opportunities and already on the map.
- **Not** a "Register" button until a registration URL actually exists (currently 0/91).

---

## Guardrails carried from Phase 1

1. **Measure every edge before shipping it.** `piid_solnum_no_link` was a 0% join that was assumed.
2. **Label inference as inference.** A shared-NAICS forecast is a related market, not the event's buy.
3. **Honest empty.** No evidence → render nothing. Never "0 industry days" (reads as a data gap).
4. **Upcoming on opportunities, past as behavior.** Never show an expired event on a page whose job
   is helping someone act today.
5. **Suppress unreliable fields** rather than rendering fragments — display honesty until the
   extractor improves.
