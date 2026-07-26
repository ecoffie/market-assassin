# PRD — M-Estimate Self-Improving Loop

**Status:** Phase 0 built (this task) · Phase 1-3 proposed/future · **Author:** Eric (via Claude) · **Date:** 2026-07-26 (corrected same day — see §1)
**Trigger:** Eric's FOIA back-channel analogy — gov contracting offices used to informally trade "what did you pay for this" so nobody overpaid; we can automate the same feedback loop on federal award data, applied to M-Estimate (the branded contract-value range shown on the opportunity map).
**Correction (2026-07-26):** the first draft framed accuracy as gated on a slow, single
forward-accrual clock ("year one is mostly capture"). Eric challenged this and it was
wrong — measured against BigQuery `awards`: **54,355,820 total awards (FY2015–present,
272,703 firms), including 5.67M in FY2025 alone.** There are two clocks, not one — see
§1 for the full correction. Net: we do NOT need a year to have confident estimates; the
54M-award historical corpus lets the backtest (Phase 2) start immediately.
**Related memory/docs:** [[recompete_changes_moat]] (the direct model for this — "the moat now counts itself"), [[mwin_score_naming]] (the sibling metric — never show an unearned % confidence), `src/lib/opportunities/value-range.ts`, `src/lib/opportunities/opp-intel.ts`, `supabase/migrations/20260716_recompete_changes_and_staleness.sql`

---

## 1. The vision

M-Estimate today is a **static** grounded range — comparable-award percentiles or a
predecessor-anchored band, computed fresh every time and never remembered. It's honest
(every dollar traces to a real award — see `value-range.ts`), but it doesn't get *smarter*.

**⚠️ Correction (2026-07-26):** an earlier draft of this PRD conflated two different
clocks under one "accuracy compounds slowly, year one is mostly capture" framing. That
was wrong, and the wrongness would have undersold the moat. Measured directly against
BigQuery `awards`: **54,355,820 total awards on record (FY2015–present), 272,703 distinct
firms, date range October 2015 → April 2026 — including 5.67 MILLION awards in FY2025
alone (5.79M in FY2024).** That is not a "wait and see" corpus; it is a massive,
already-in-hand ground-truth set. The corrected model has **two separate clocks**, and
only one of them is slow:

1. **Backtesting accuracy is available NOW, at massive scale — not a waiting problem.**
   We already hold 54M real award amounts. Measuring M-Estimate's error per segment (NAICS
   × agency × dollar-tier) can run TODAY by holding out historical awards and scoring the
   comparable-award model against what actually happened — exactly how `value-range.ts`
   was already backtested (225 awards → ~80% coverage), but now across millions of
   historical (estimate-if-we'd-asked, actual) pairs instead of a few hundred. This is
   what delivers "high confidence with a few early-flagged exceptions," and it needs
   **zero wait** for new predictions to accrue.
2. **The live prediction→outcome loop (Phase 0, built here) is the part that accrues
   forward.** Logging OUR specific estimate on a specific OPEN opportunity and later
   watching THAT opportunity award is what takes 3–12 months per opp. But that forward
   loop is **continuous re-validation and drift detection layered on top of the backtest
   foundation** — it is NOT the source of initial confidence. 5.7M fresh real awards a
   year keep arriving to re-validate against, so the re-validation clock never really
   waits either; it just runs at the pace of the live opportunity funnel instead of the
   pace of the historical archive.

**Net message: we do NOT need a year to have confident estimates.** We have 54M
historical awards to backtest against today — that's what earns the confidence. The
forward loop (Phase 0 now, Phase 1 later) keeps us honest over time as fresh awards land
and as our own predictions specifically get checked, but it is the re-validation
mechanism, not the foundation.

The loop we're building:

1. **Record** every M-Estimate at the moment it's computed (Phase 0 — this task; the
   unbackfillable, forward-accruing half of the loop).
2. **Backtest at scale, starting immediately** against the 54M-award historical corpus —
   measure our error, segmented by NAICS × agency × dollar-tier (Phase 2 — see §3, this
   is the one that does NOT wait on Phase 0/1 to accrue data).
3. **Harvest** the realized award amount for OUR OWN logged predictions once each specific
   opportunity actually awards (Phase 1) — the continuous forward re-validation layer.
4. **Calibrate** — publish narrower ranges (or an earned confidence label) only where the
   measured error has proven low; leave segments with high measured error WIDE and flag
   them early as "less certain" rather than pretend precision we haven't earned (Phase 3).

End state: "high confidence, with a few exceptions we can flag EARLY" — where "exception"
means a *measured*, not guessed, segment of persistently high error (e.g. multi-award
IDIQs, a thin/volatile NAICS, an agency with unusually wide contract-value spread). This
is the same earned-accuracy discipline as M-Win — never render an unearned number
([[mwin_score_naming]]: "Render `M-Win 72`, never `72%` — the % is unearned until a
published backtest"). M-Estimate's version of that rule: never tighten a range or attach
a confidence label to a segment until the backtest (Phase 2) has actually measured it —
which, per the correction above, can start immediately, not after a year of Phase 0/1
accrual.

**The FOIA analogy, made concrete:** the informal channel gov buyers used ("what did
Agency X pay for this last time") is exactly a realized-price feedback loop — the thing
that stopped agencies overpaying was seeing what similar buys actually cost, after the
fact. M-Estimate's loop is the automated, at-scale version of that: instead of one CO
calling around, every prediction we make is silently checked against what actually got
paid — checked against 54M+ historical payments starting today, and against every new
one that lands (5.7M/year) from here forward.

---

## 2. Why Phase 0 ships alone, right now, ahead of everything else

**This history cannot be backfilled.** USASpending and SAM only serve *current* state —
neither has an "as of" query. If we don't record what M-Estimate said on a given day,
against the exact comparable-award sample and model version we had that day, that
specific data point is gone forever. Waiting to build Phase 0 until Phase 1/3 are
designed means losing every day of predictions in between.

This is the **identical lesson** already learned and shipped for `recompete_changes`
(migration `20260716_recompete_changes_and_staleness.sql`): the sync there upserts
current state and overwrites the prior row on every run, so an unrecorded change (a
contract's expiry slipping, a ceiling being raised) is gone permanently — "the moat now
counts itself" is literally about a flat total in that table being the alarm signal for
a broken pipeline, because you cannot regenerate yesterday's row after the fact. Same
structure here: **the clock on the FORWARD prediction→outcome loop starts the day
`m_estimate_log` starts receiving rows**, not the day the harvest/scoring code lands.

**This is distinct from — and does not gate — the backtest clock (§1).** Phase 0 is
built first because it's the piece that is otherwise permanently lost if delayed; it is
NOT the piece that determines when we can first trust an M-Estimate range. Confidence
tiers can and should be derived from the 54M-award historical backtest (Phase 2)
regardless of how many rows `m_estimate_log` has accumulated. Phase 0 shipping today
means: by the time Phase 1 (harvest) is built, months of real forward predictions will
already be sitting in the log ready to score — that's the value of shipping the capture
spine now, not "we need this before we can be confident."

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

### PHASE 2 — FUTURE, BUT RUNNABLE IMMEDIATELY: historical backtest → segment error → confidence tiers

**⚠️ This is the phase the original draft mis-sequenced.** It does NOT wait on Phase 0
accruing rows or on Phase 1's live harvest — it runs against data **already sitting in
BigQuery today**: 54,355,820 awards (FY2015–present, 272,703 distinct firms), including
5.67M in FY2025 alone. Move this phase first conceptually, even though Phase 1 (below) is
numbered ahead of it for historical/build-order reasons (Phase 1's harvest columns feed
the SAME error-measurement pipeline once they exist).

**What:** hold out historical awards and score M-Estimate's existing methodology
(`getComparableAwardRange` in `value-range.ts`) against what those awards' NAICS ×
agency × dollar-tier segment ACTUALLY paid — i.e. "if we'd been asked to estimate this
award before it happened, using only comparables available before that date, how close
would we have been." This is a straightforward historical backtest, exactly the same
shape as the 225-award / ~80%-coverage validation already done for the comparable-award
model, just run at a much larger scale (millions of held-out pairs instead of a few
hundred) and broken out per segment instead of reported as one global number.

Aggregate error (e.g. `|actual - our_median| / actual`, and whether `actual` fell inside
`[our_low, our_high]`) grouped by **NAICS × agency × dollar-tier**. Segments with many
low-error historical pairs earn a **"High confidence"** label (and a tighter published
range); segments that stay thin or volatile (or where federal contracts in that segment
genuinely span a wide dollar range — see `value-range.ts`'s own accuracy-ceiling note)
stay **"Wide range"** or are suppressed from a confidence claim entirely.

This is the literal mechanism behind "high confidence, with a few exceptions we can flag
EARLY" — the exceptions are not guessed, they're the segments this backtest has
*measured* to have persistently high error, surfaced as a caveat rather than hidden. **It
needs zero forward accrual to start** — the 54M-award historical corpus is the
foundation of confidence; Phase 1 below is what keeps that confidence honest as new
awards and our own live predictions arrive, not what creates it in the first place.

### PHASE 1 — FUTURE: live award-harvest (continuous re-validation, NOT the confidence source)

**What:** for a `notice_id` we've logged an estimate against (via Phase 0), find the
award that eventually resulted (if any) and record the realized amount alongside the
logged estimate. This feeds the SAME segment-error pipeline as Phase 2's historical
backtest, but for our own specific live predictions — it is the ongoing re-validation
layer, checking that the confidence Phase 2 already established from 54M historical
awards continues to hold as fresh awards land (5.7M/year) and as our specific estimates
resolve.

**⚠️ HONEST FEASIBILITY — measured, not hand-waved, before any of this is built:**

1. **The BigQuery `awards` table has no `solicitation_number` column.** Verified against
   the live schema (`src/lib/bigquery/awards.ts` `AwardListRow`/`AwardDetailRow`
   interfaces, and a grep of the entire `src/lib/bigquery/` tree for `solicitation` —
   zero matches). The join key space there is `award_id` / `piid` / `parent_uei`, not
   `solicitation_number`. **There is no direct estimate→award join by ID today.** (Note:
   this constraint is specific to joining a SPECIFIC logged estimate to its SPECIFIC
   eventual award — it does not affect Phase 2's backtest, which measures error by
   segment over the historical corpus, not by following an individual notice_id forward.)

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
  contract will eventually show up in USASpending with a PIID (part of the 5.7M/year
  flow). Matching would lean on the SAME best-match inference already built for
  `find-predecessor.ts` (NAICS + agency + keyword + timing), run in the *forward*
  direction instead of backward — i.e. no ID join, a confidence-scored match like the
  existing predecessor-finder, not a guarantee.

**Latency is real for THIS specific loop, and must be stated up front:** a solicitation
posted today may not award for 3–12 months (sometimes longer), so linking one specific
`m_estimate_log` row to its own eventual award takes that long. That latency is fine
precisely BECAUSE it isn't the thing establishing initial confidence (Phase 2 already
did that from 54M historical awards) — Phase 1 is the slow-drip re-validation layer, and
it's allowed to be slow because nothing is blocked on it.

**Coverage limits to state honestly, not paper over:**
- Multi-award IDIQs split one solicitation into N task-order awards — no single "the
  realized amount" exists; these likely stay in a `wide_range`/unmeasured bucket.
- Cancellations, no-award solicitations, and protests mean a logged estimate may never
  get a realized amount at all — that's an expected, not-a-bug outcome (the log should
  distinguish "still pending" from "will never resolve" once Phase 1 exists, likely via
  a `harvest_status` column added in that phase's migration).
- Where no clean single-award match exists, the existing `getComparableAwardRange`
  philosophy holds: stay honest with a wide range rather than force a false precise match.

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

| Phase | Ships when | Proven by | Blocked on prior phase? |
|---|---|---|---|
| 0 (this task) | Migration run + deploy live | `m_estimate_log` row count > 0 and climbing daily | No — independent |
| 2 (future, but runnable immediately) | A historical backtest job scores M-Estimate's methodology against held-out awards from the 54M-award BigQuery corpus, per NAICS × agency × dollar-tier | A segment-level error table/dashboard (millions of historical pairs), not a single global "we're accurate" claim | **No** — runs against data already in hand; does NOT wait on Phase 0 or Phase 1 |
| 1 (future) | A harvest job links ≥1 logged (`m_estimate_log`) estimate to its own realized award | A non-zero, growing count of rows with a realized amount attached — the continuous re-validation feed into Phase 2's segment error, not a new confidence source | Yes — needs Phase 0 rows to exist first; feeds the SAME error pipeline Phase 2 already established |
| 3 (future) | A segment's published range visibly tightens (or gains a confidence label) | The tightening traces to that segment's OWN measured error (from Phase 2's backtest, continuously reinforced by Phase 1), never applied blanket | Yes — needs Phase 2 to have measured that segment |

**Read this table as: Phase 2 is the one to prioritize building next** (it's the fastest
path to a real, defensible confidence claim, since the data already exists); Phase 1 is
valuable but not urgent for confidence — it's ongoing hygiene, best served by Phase 0
already running in the background collecting rows while Phase 2 gets built.

---

## 6. Non-goals (this task)

- No historical backtest job, no award-harvest job, no error measurement, no confidence
  tiers, no model recalibration. Phase 0 ONLY: log every estimate as it's computed. (Per
  the correction in §1, the backtest — Phase 2 — is the highest-leverage NEXT phase to
  scope, since it needs no forward accrual; it is simply not built in this task.)
- No change to `value-range.ts`, `opp-intel.ts`, or the precompute cron — those are
  owned by concurrent work (`feat/m-estimate-rebrand`) on the estimate/rebrand itself.
  This PRD's Phase 0 build hooks the log at the API boundary
  (`src/app/api/app/opportunity-detail/route.ts`) specifically to avoid touching those
  files.
- No state/local ingestion (§4) — flagged for later, not started.
