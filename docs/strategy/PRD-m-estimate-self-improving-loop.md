# PRD — M-Estimate Self-Improving Loop

**Status:** Phase 0 built (this task) · Phase 1-3 proposed/future · **Author:** Eric (via Claude) · **Date:** 2026-07-26
**Trigger:** Eric's FOIA back-channel analogy — gov contracting offices used to informally trade "what did you pay for this" so nobody overpaid; we can automate the same feedback loop on federal award data, applied to M-Estimate (the branded contract-value range shown on the opportunity map).
**Related memory/docs:** [[recompete_changes_moat]] (the direct model for this — "the moat now counts itself"), [[mwin_score_naming]] (the sibling metric — never show an unearned % confidence), `src/lib/opportunities/value-range.ts`, `src/lib/opportunities/opp-intel.ts`, `supabase/migrations/20260716_recompete_changes_and_staleness.sql`

---

## 1. The vision

M-Estimate today is a **static** grounded range — comparable-award percentiles or a
predecessor-anchored band, computed fresh every time and never remembered. It's honest
(every dollar traces to a real award — see `value-range.ts`), but it doesn't get *smarter*.

The loop we're building:

1. **Record** every M-Estimate at the moment it's computed (Phase 0 — this task).
2. **Harvest** the realized award amount once the opportunity actually awards (Phase 1).
3. **Measure** our error, segmented by NAICS × agency × dollar-tier (Phase 2).
4. **Tighten** — publish narrower ranges (or an earned confidence label) only where the
   measured error has proven low; leave segments with high measured error WIDE and flag
   them early as "less certain" rather than pretend precision we haven't earned (Phase 3).

End state: "high confidence, with a few exceptions we can flag EARLY" — where "exception"
means a *measured*, not guessed, segment of persistently high error (e.g. multi-award
IDIQs, a thin/volatile NAICS, an agency with unusually wide contract-value spread). This
is the same earned-accuracy discipline as M-Win — never render an unearned number
([[mwin_score_naming]]: "Render `M-Win 72`, never `72%` — the % is unearned until a
published backtest"). M-Estimate's version of that rule: never tighten a range or attach
a confidence label to a segment until Phase 2 has actually measured it.

**The FOIA analogy, made concrete:** the informal channel gov buyers used ("what did
Agency X pay for this last time") is exactly a realized-price feedback loop — the thing
that stopped agencies overpaying was seeing what similar buys actually cost, after the
fact. M-Estimate's loop is the automated, at-scale version of that: instead of one CO
calling around, every prediction we make is silently checked against what actually got
paid, forever, across the whole federal contracting corpus we can see.

---

## 2. Why Phase 0 ships alone, right now, ahead of everything else

**This history cannot be backfilled.** USASpending and SAM only serve *current* state —
neither has an "as of" query. If we don't record what M-Estimate said on a given day,
against the exact comparable-award sample and model version we had that day, that
specific data point is gone forever. Waiting to build Phase 0 until Phase 1/2/3 are
designed means losing every day of predictions in between.

This is the **identical lesson** already learned and shipped for `recompete_changes`
(migration `20260716_recompete_changes_and_staleness.sql`): the sync there upserts
current state and overwrites the prior row on every run, so an unrecorded change (a
contract's expiry slipping, a ceiling being raised) is gone permanently — "the moat now
counts itself" is literally about a flat total in that table being the alarm signal for
a broken pipeline, because you cannot regenerate yesterday's row after the fact. Same
structure here: **the clock on measurable estimate-accuracy starts the day `m_estimate_log`
starts receiving rows**, not the day the harvest/scoring code lands.

---

## 3. The 4 phases

### PHASE 0 — BUILD NOW (this task): append-only prediction log

**What:** `m_estimate_log` (migration `20260726_m_estimate_log.sql`) — one row per
computed M-Estimate: `notice_id, solicitation_number, naics, agency, sub_agency, our_low,
our_median, our_high, comparable_n, source, model_version, estimated_at`.

**Where it's written:** `logMEstimate()` (`src/lib/opportunities/m-estimate-log.ts`), called
from `GET /api/app/opportunity-detail` (both the cached-read and live-compute branches)
whenever a real `valueRange` is served to the drawer. Best-effort, non-blocking — logging
failure must never affect whether the estimate itself renders.

**Append-only, on purpose:** never UPDATE a row. A re-open of the same notice, a
`model_version` bump, or a change in the comparable-award sample all produce a NEW row.
That row-level evolution — "how did our estimate for this opp change over time and did a
model change actually help" — is itself the data Phase 2/3 need. Deleting/overwriting
would destroy exactly the signal this exists to capture.

**Success criteria (measurable, once deployed):**
- `m_estimate_log` row count increases daily (a flat count = the logging hook broke,
  same "flat total is the alarm" signal as `recompete_changes_total`).
- `model_version` distribution shows `'v1'` until a future bump.
- No increase in `opportunity-detail` route error rate or added client-visible latency
  attributable to the log call (it fires with `.catch(() => {})` and returns before the
  response is blocked on it in neither branch — verify via existing route timing/logs).

### PHASE 1 — FUTURE: award-harvest (link a logged estimate to its realized award)

**What:** for a `notice_id` we've logged an estimate against, find the award that
eventually resulted (if any) and record the realized amount alongside the logged
estimate — the ground truth Phase 2 measures error against.

**⚠️ HONEST FEASIBILITY — measured, not hand-waved, before any of this is built:**

1. **The BigQuery `awards` table has no `solicitation_number` column.** Verified against
   the live schema (`src/lib/bigquery/awards.ts` `AwardListRow`/`AwardDetailRow`
   interfaces, and a grep of the entire `src/lib/bigquery/` tree for `solicitation` —
   zero matches). The join key space there is `award_id` / `piid` / `parent_uei`, not
   `solicitation_number`. **There is no direct estimate→award join by ID today.**

2. **`sam_opportunities.award_amount` is empty cache-wide.** Measured live: 0 of 140,931
   rows have a non-null `award_amount`. We do not currently capture SAM award-notice
   dollar amounts at all, so there is no "wait for this same row to get an award_amount"
   shortcut either.

So **Phase 1 requires actually building the linkage** — it is not a free join sitting in
data we already have. Two realistic paths, either or both:

- **(a) Capture SAM AWARD-type notices via the existing sync.** SAM posts a separate
  AWARD notice type when a solicitation is awarded, carrying awardee name + amount, and
  it frequently references the originating solicitation number in its text/fields. This
  would mean extending `sync-sam-opportunities` (or a sibling job) to actually populate
  `award_amount` (and an awardee/solicitation-reference field) from AWARD notices — work
  that does not exist today.
- **(b) Forward-match an opp's eventual PIID to USASpending awards.** Once a
  solicitation's `notice_id`/`solicitation_number` produces a real contract, that
  contract will eventually show up in USASpending with a PIID. Matching would lean on
  the SAME best-match inference already built for `find-predecessor.ts` (NAICS + agency +
  keyword + timing), run in the *forward* direction instead of backward — i.e. no ID
  join, a confidence-scored match like the existing predecessor-finder, not a guarantee.

**Latency is real and must be stated up front:** a solicitation posted today may not
award for 3-12 months (sometimes longer). Year one of Phase 1 is mostly *capture* — few
(estimate, actual) pairs will exist yet, because most currently-logged estimates haven't
had time to resolve into an award. Accuracy measurement compounds slowly; this is not a
"turn it on and see results next week" feature.

**Coverage limits to state honestly, not paper over:**
- Multi-award IDIQs split one solicitation into N task-order awards — no single "the
  realized amount" exists; these likely stay in a `wide_range`/unmeasured bucket.
- Cancellations, no-award solicitations, and protests mean a logged estimate may never
  get a realized amount at all — that's an expected, not-a-bug outcome (the log should
  distinguish "still pending" from "will never resolve" once Phase 1 exists, likely via
  a `harvest_status` column added in that phase's migration).
- Where no clean single-award match exists, the existing `getComparableAwardRange`
  philosophy holds: stay honest with a wide range rather than force a false precise match.

### PHASE 2 — FUTURE: measure error per segment → confidence tiers

**What:** once Phase 1 produces `(estimated, actual)` pairs, aggregate error
(e.g. `|actual - our_median| / actual`, and whether `actual` fell inside `[our_low,
our_high]`) grouped by **NAICS × agency × dollar-tier**. Segments with many low-error
pairs earn a **"High confidence"** label (and a tighter published range); segments that
stay thin or volatile stay **"Wide range"** or are suppressed from a confidence claim
entirely.

This is the literal mechanism behind "high confidence, with a few exceptions we can flag
EARLY" — the exceptions are not guessed, they're the segments Phase 2 has *measured* to
have persistently high error, surfaced as a caveat rather than hidden.

### PHASE 3 — FUTURE: calibrate the model from measured bias

**What:** feed Phase 2's per-segment bias (e.g. "in NAICS 236220 at USACE, our median
estimate runs 18% low") back into the range-computation logic — tightening or shifting
the published range only for segments with enough measured history to trust the
correction. Any UI change (a tighter band, a "% confidence" label) only ships for a
segment once Phase 2 has proven its error is low — the same earned-accuracy rule as
M-Win. Never publish a number the data hasn't earned yet.

---

## 4. The additive future moat: state/local price transparency (explicitly OUT of scope now)

Eric's FOIA framing extends naturally beyond federal: state and local governments
increasingly publish (or can be FOIA'd for) their own contract award data, which would
let M-Estimate cross-reference federal comparable-award ranges against state/local
realized prices for the same category of work — widening the corpus the estimate draws
from and adding a second, independent feedback source for Phase 2's error measurement.

This is flagged here as a **future, separate ingestion project** (new data sources, new
scrapers/APIs per state, its own feasibility measurement) — explicitly **not** part of
Phase 0-3 above, which are scoped to federal SAM/USASpending data only.

---

## 5. Success criteria summary

| Phase | Ships when | Proven by |
|---|---|---|
| 0 (this task) | Migration run + deploy live | `m_estimate_log` row count > 0 and climbing daily |
| 1 (future) | A harvest job links ≥1 logged estimate to a realized award | A non-zero, growing count of rows with a realized amount attached |
| 2 (future) | Per-segment error is computed from ≥N real pairs (N TBD by data volume) | A segment-level error table/dashboard, not a single global "we're accurate" claim |
| 3 (future) | A segment's published range visibly tightens (or gains a confidence label) | The tightening traces to that segment's OWN measured error, never applied blanket |

---

## 6. Non-goals (this task)

- No award-harvest job, no error measurement, no confidence tiers, no model
  recalibration. Phase 0 ONLY: log every estimate as it's computed.
- No change to `value-range.ts`, `opp-intel.ts`, or the precompute cron — those are
  owned by concurrent work (`feat/m-estimate-rebrand`) on the estimate/rebrand itself.
  This PRD's Phase 0 build hooks the log at the API boundary
  (`src/app/api/app/opportunity-detail/route.ts`) specifically to avoid touching those
  files.
- No state/local ingestion (§4) — flagged for later, not started.
