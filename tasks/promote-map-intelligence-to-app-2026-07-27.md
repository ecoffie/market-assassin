# Promote the Opportunity-Map intelligence into the core /app — DIRECTIVE (Eric, 2026-07-27)

**Eric:** "once the drain is complete we should be able to use that information and everything
else we discovered today inside Mindy app."

The map (`/opportunity-map`) became the proving ground today for a lot of real, grounded
intelligence. Most of it is **map-only**. The directive: promote each asset into the core `/app`
surfaces where users actually work (dashboard, Recompetes panel, opportunity detail, alerts,
Target List, bid-decision, briefings). This is a ROADMAP, not one task — sequence with Eric.

## The assets to promote (built/recovered 2026-07-26/27)

| Asset | Built where | Lib/route (reuse — don't rebuild) | Target /app home |
|---|---|---|---|
| **Real task-order cities + spend stream** | recompete map pins/drawer | `src/lib/recompete/task-orders.ts` (`getTaskOrders`), `recompete_opportunities.map_lat/map_loc_source` (drain recovered ~??% real city — see tally) | Recompetes panel: real "where money flows" + task-order spend, not just ceiling |
| **"How this buyer buys" (GOS #11)** | map Awarded/Buyer drawers | `src/lib/opportunities/buyer-behavior.ts` (`computeBuyerBehavior`) | Target List cards, Agency intel, briefings — SB-fit badge (🟢 SAP-friendly / 🔒 vehicle-gated) |
| **M-Estimate (project value + range + chart)** | map open-opp drawer | `intel_value_range` JSONB + `opp_value_range`/`opp_value_histogram` RPCs; render in `opportunity-map/route.ts` mEst* fns | Opportunity detail panel, alerts, bid-decision grounding |
| **Activity + freshness/source line** | map drawers (#498/#499) | `activitySec`/`freshnessSec` + detail endpoints return synced_at/trackingCount | Opportunity cards + detail across app |
| **Cross-sell (open↔awarded "ways to win")** | map drawer (#493) | `src/lib/opportunities/cross-sell.ts`, `/api/app/related-awards`, `/api/app/related-opps` | Pursuit/opportunity views: subcontract + bid targets |
| **New filters (closing-window + per-dataset parity)** | map filter panel (#500/#501/#503?) | `src/lib/opportunities/map-filters.ts` | App opportunity/recompete search panels |

## Rules for the promotion work
- REUSE the shared libs above — they're already grounded + tested. Don't re-derive.
- Ground-in-real-data (GOS): every promoted number traces to the same real source; omit when absent.
- Each promotion is its own PR, preview-verified before merge (per Eric's standing "commit + open
  as we build" + verify-before-done).
- Blocked-until: the task-order city promotion should wait for the drain tally (know the real-city %).

## Sequence (Eric's priority)
1. **FIRST: "How this buyer buys" → Target List cards + agency intel + briefings** (Eric, 2026-07-27).
   Highest-value, lowest-risk — `computeBuyerBehavior` already built + tested. Surface the SB-fit
   badge (🟢 SAP-friendly / 🔒 vehicle-gated) where users work day-to-day. Pure reuse, no new data.
   Start AFTER the two in-flight jobs land (avoid branching off a main that's about to change).
2. (then, order TBD) M-Estimate everywhere · task-order spend in Recompetes panel · activity/freshness
   on app opp cards · cross-sell · filters.

## DECIDED (Eric, 2026-07-27) — Industry dropdown, NAICS/PSC in Filters only
Real people don't think in codes: "I do construction / I'm a manufacturer / I do cyber" — not
"I do 238220." So:
- **Top pill / dropdown = INDUSTRY** (human rollups: Construction / Manufacturing / IT / Cyber /
  Professional Services…), the UNIVERSAL primary selector across ALL boards. Backed by the ALREADY-
  BUILT `src/lib/industry-presets.ts` (INDUSTRY_PRESETS: label → NAICS codes + description). An
  industry rolls up many NAICS under the hood.
- **NAICS + PSC = live in the FILTERS panel only** — code-specific, for the pro who wants exact codes.
  KEEP them there. Just REMOVE the redundant NAICS top-pill/dropdown (pill + filter both did NAICS =
  the redundancy Eric flagged). NAICS is demoted to precise-filter, never the primary label.
- **Keyword = the refiner** ("construction → painting/paving/flooring"; "manufacturer → aluminum
  windows"; "cyber → RMF"). Keyword-first doctrine already in code (CLAUDE.md + profile-from-text.ts).
- Grounds: CLAUDE.md "NAICS is the WRONG primary key… keyword is the discovery key; NAICS auto-derived
  invisibly." This surfaces that doctrine in the UI.

Two PRs finished during this discussion (HOLD — do not merge until the Industry direction is settled):
- **#502** filter-parity-all-datasets (NAICS/PSC/etc. work per dataset in Filters) — LIKELY STILL GOOD
  (it's the Filters-panel work, which Eric WANTS; NAICS/PSC belong in filters). Preview-verify + merge.
- **#503** naics-autocomplete-sweep (12 app inputs → NaicsAutocompleteInput) — RECONSIDER: the
  autocomplete is fine as the code-entry UX, but the LABEL/primacy shifts to Industry. May keep as the
  "advanced code" layer, may relabel. Decide with Eric before merging.

## ⚠️ NAICS-family-blowout fix (e9017467) — MUST honor when promoting Industry to app panels
The persist path had a bug: a broad industry preset ("Professional Services" = ['541']) run through
`expandNAICSCodes(codes,false)` fanned out to all 51 codes of the 541 family → bloated profiles →
82% of alert volume from 12% of profiles; a cyber firm matched nursing homes. Fix = a SEPARATE
persist-path function `normalizeNAICSForPersist()` (6-digit exact; short prefix → curated
PERSIST_COVERAGE_SETS ~90% coverage; MAX_PERSISTED_NAICS=40 cap), wired into `/api/app/profile` +
`/api/alerts/save-profile`. `expandNAICSCodes` itself UNCHANGED — query-time callers want broad recall.

**Impact on the shipped map Industry dropdown (#504): NONE.** The map is pure QUERY-path — an Industry
pick sets FILT.naics (e.g. '236,237,238') to FILTER the live view (broad recall = correct), and Save
search stores the raw filters + re-runs them via parseMapFilters (never persists to a profile, never
calls expandNAICSCodes). Verified: no expandNAICSCodes call anywhere in opportunity-map/ or map-filters.

**RULE for the app-panel promotion (roadmap step): any Industry pick that PERSISTS to a profile
(onboarding, alerts signup/prefs, Settings) MUST route through `normalizeNAICSForPersist()`, NOT raw
`expandNAICSCodes`, or it re-introduces the exact family-blowout the fix just cleaned up.**

**#503 (naics-autocomplete-sweep) — RE-AUDITED vs this fix + MERGED 2026-07-27.** Verdict SAFE:
it's a pure input-WIDGET swap (plain input → NaicsAutocompleteInput), same state var + same
comma-string onChange, so the value reaching the save routes is identical. Both persist routes
(/api/app/profile + /api/alerts/save-profile) ALREADY call normalizeNAICSForPersist — the blowout is
neutralized at the persist layer regardless of the widget. Array sites (Team/Vault) split/join
boundary byte-identical. No overlap with #502/#504 files. It's the "advanced code-entry" layer under
the Industry selector — complements Industry-first, doesn't conflict.

## BACKLOG — wire the Recompete subcontract CTA to REAL contact data (Eric 2026-07-27)
On the **Recompetes** dataset (renamed from Awarded/Contract Vehicles — PR #528), a row is one of
two plays, and the card CTA now matches it:
- running **task order** (fmtDays `cool`, "Active — subcontract") → **"Plan outreach"** (subcontract
  to the incumbent while the contract runs);
- expiring **prime** award (fmtDays `warm`) → **"Plan recompete"** (get ahead of the rebid).

**The gap:** "Plan outreach" currently opens a Claude prompt that asks the model to *find* the prime's
small-business liaison and draft an approach. But Mindy already HAS that data server-side — it doesn't
need Claude to guess it:
- **SBLO lookup** — `src/lib/gov-contacts/sblo-lookup.ts` (the prime's small-business liaison by
  company name); also the MCP `get_sblo_contact` tool.
- **Office rosters / federal contacts** — `/api/app/federal-contacts` (DoDAAC-anchored buying-office
  people; `get_sblo_contact` / `search_federal_contacts` on MCP).
- **Incumbent financials / profile** — `get_incumbent_financials`, `get_contractor_profile`.

**The build:** turn "Plan outreach" from a prompt into a real action — resolve the incumbent (o.title)
→ its SBLO + likely-subcontracted scope from our own data → surface the contact inline (or deep-link
to the contractor profile / a pre-addressed outreach draft), the same way the Open drawer already
surfaces incumbent intel. Grounds the play in real contacts instead of an LLM guess (GOS invariant:
ground-in-real-data). Est: reuses existing libs; mostly a drawer/CTA wiring + one enrichment route.
**Priority:** after promotion #1 (buyer-behavior badge). Not urgent — the prompt works today, it's
just not grounded in the data we already own.

## Recompete data honesty — NRWA case (Eric 2026-07-27) — SHIPPED
A card showed an already-EXPIRED, already-recompeted contract (NRWA 12SAD121C0001, ended 2026-04-30;
follow-on 12RADA26C0001 awarded, runs to 2030) as a live "Recompete now" target with an ambiguous
"Expires Apr 30" (no year). Root cause + fixes:
- **Layer 1 (PR #531, LIVE):** default Recompetes view filters out past-expiry rows
  (`period_of_performance_current_end < today`; `?includePast=1` opts in). 2,450 of ~126K hidden.
  Verified live: default 123,536 vs includePast 125,986. Plus label honesty — `shortDate` shows the
  year on any past/non-current-year date; expired pill reads "Expired" not "Expiring now".
- **Layer 2 (PR #532, LIVE):** ROOT CAUSE — the sync (`fetchExpiringForNaics`) keeps only contracts
  expiring within `months`=18, so a long follow-on (ending 2030) never enters while the expired parent
  lingers from when it was in-window. The sync cron now flags past-expiry rows `quality_flag='expired'`
  each execute (reversible; removes from every quality_flag-IS-NULL surface). Table self-prunes; the
  existing ~2,604 drain on the next hourly cron execute (Eric chose cron-drain over a manual UPDATE).
- **NOT done (deliberate):** detecting/replacing a row with its already-awarded follow-on — a real build
  with the confident-garbage phrase-matching risk (Claude session matched NRWA→Radiance/Group-W). See
  the "wire Plan outreach to real contacts" backlog above; same grounded-lookup discipline applies.

## Status
- Drain (task-order cities): IN PROGRESS as of 2026-07-27 — report tally when done.
- Filter-parity-all-datasets: IN PROGRESS (agent) — PR pending.
- **Buyer-behavior → /app: ✅ SHIPPED (PR #530, 2026-07-27)** — "How this buyer buys" SB-fit badge
  on Target List cards. target-enrichment computes computeBuyerBehavior once per distinct agency
  (fail-soft, null when <8 awards); card shows 🟢/🔒/🟡 + verdict.label matching the map. Data
  proven grounded (DLA 36% PO → friendly; Navy 18% → gated; GSA 2% → gated).
- Everything else above: SHIPPED on the map, NOT yet in /app.
