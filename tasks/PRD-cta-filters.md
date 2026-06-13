# PRD: DoD Critical Technology Area Filters

**Status:** Build PRD — ready for engineering kickoff
**Owner:** Eric / Engineering
**Trigger:** NAPEX 2026 readiness (Aug 16–21). DoD's 35% Critical Tech Area mandate is the single biggest scoring change APEX centers face — every center director on the floor is graded on it. **No vendor at NAPEX has a CTA filter.** Shipping this in 2 weeks is the wedge that turns a NAPEX booth from "another vendor with a free trial" to "the only tool that maps to your reporting mandate."
**Parent PRD:** `/Users/ericcoffie/Market Assasin/PRD-apex-sbdc-funding-justification.md`
**Companion docs:** `projects/apex-sbdc-funding-strategy/NAPEX-2026-readiness-plan.md` (week-by-week), `projects/apex-sbdc-funding-strategy/funding-levers-research.md` §1.3 (CTA list source)
**Target ship date:** **End of Week 2 (Jun 27, 2026)** — booth-demo-ready

---

## 1. The problem

DoD has directed every APEX Accelerator center to align **at least 35% of contract wins to the Critical Technology Areas** (Trusted AI, Microelectronics, Space, Hypersonics, Quantum, etc. — 14 total). Center directors must report alignment quarterly. Today they have no way to:

- Filter the SAM opportunity firehose to just CTA-aligned opportunities
- Surface CTA-aligned opportunities to clients in a way that's reportable
- See, at a glance, what % of their roster's pursued/won opportunities map to CTAs

Mindy currently has zero CTA awareness. Filters today are: NAICS, PSC, set-aside, state, notice type. **Adding CTA as a first-class filter dimension is the single highest-leverage feature for the APEX channel.**

## 2. The solution

A new **CTA filter dimension** on the opportunity search, plus background tagging of cached SAM opportunities. Flow:

1. User opens `/app/opportunities`
2. New **"Critical Tech Area"** chip filter (multi-select, 14 CTAs)
3. Selecting one or more CTAs filters the opportunity list to only opportunities tagged with that CTA
4. Each opportunity card shows a small CTA badge (e.g., "Microelectronics") when it matches
5. On the Org Tab (Coach Mode), CTA filter is a **saved view** — "show me only my Trusted AI clients' pursuits"
6. Roster aggregate dashboard (Coach Mode) shows **% of roster's wins by CTA**

The 14 CTAs and their NAICS + keyword anchors are sourced from `funding-levers-research.md` §1.3. **The list itself is locked Week 1 by Eric/Nora; this PRD assumes that list is final by Mon Jun 16.**

## 3. The 14 DoD Critical Technology Areas

| # | CTA | NAICS Anchors | Keyword Set (sample) |
|---|---|---|---|
| 1 | Trusted AI & Autonomy | 541511, 541512, 541715 | "artificial intelligence", "machine learning", "autonomy", "autonomous systems", "computer vision" |
| 2 | Biotechnology | 325414, 541714, 621511 | "biotechnology", "biomanufacturing", "synthetic biology", "biodefense" |
| 3 | Quantum Science | 541713, 541715 | "quantum", "quantum computing", "quantum sensing", "quantum communications" |
| 4 | Microelectronics | 334413, 334419 | "microelectronics", "semiconductor", "chip fabrication", "ASIC", "FPGA" |
| 5 | Space Technology | 336414, 336415, 541713 | "space", "satellite", "launch vehicle", "orbital", "spacecraft" |
| 6 | Advanced Materials | 325, 331, 332 | "advanced materials", "composites", "nanomaterials", "metamaterials" |
| 7 | Hypersonics | 336414, 541330, 541713 | "hypersonic", "scramjet", "high-speed flight" |
| 8 | Directed Energy | 333611, 334516, 541330 | "directed energy", "high energy laser", "HEL", "microwave weapon" |
| 9 | Integrated Sensing & Cyber | 334290, 541512, 541519 | "cybersecurity", "cyber defense", "sensing", "ISR", "RF" |
| 10 | Future-Generation Wireless (FutureG) | 334210, 334290, 517111 | "5G", "6G", "next-gen wireless", "FutureG", "mmWave" |
| 11 | Renewable Energy Generation & Storage | 221114, 221115, 335999 | "renewable energy", "battery storage", "grid storage", "solar", "wind" |
| 12 | Advanced Computing & Software | 511210, 541511, 541512 | "high-performance computing", "HPC", "edge computing", "supercomputing" |
| 13 | Human-Machine Interfaces | 334118, 334290, 541330 | "human-machine interface", "HMI", "augmented reality", "AR/VR", "neurotech" |
| 14 | Integrated Network Systems-of-Systems | 334290, 334418, 541330 | "command and control", "C4ISR", "JADC2", "battle management", "mesh network" |

**Source:** DoD CTO Critical Technology Areas list (publicly published 2024, updated 2025). NAICS mappings + keyword sets are research-team derived. **Phase 2 research item: validate with DoD OSBP before NAPEX.** For now, ship with the research list and flag any borderline tagging in the UI.

## 4. What ALREADY exists (don't rebuild)

- ✅ `/api/app/opportunities` — opportunity search with NAICS/PSC/state/set-aside filtering. CTA filter slots in here.
- ✅ Supabase `sam_opportunities` cache (24K+ records, daily-refreshed)
- ✅ `OpportunitiesPanel` component (or the relevant filter component) — chip filter UI patterns already exist
- ✅ Org Tab + Coach Mode (June 2026 build) — saved-view surface to hang the CTA filter on
- ✅ NAICS expansion lib (`src/lib/utils/naics-expansion.ts`) — reuse for NAICS-anchor matching

## 5. What's net-new

### A. Database (Supabase)

**Reference table — `cta_codes`** (seeded once)

| Column | Type | Notes |
|---|---|---|
| `cta_id` | text PK | Slug: `trusted_ai`, `microelectronics`, `space_tech`, etc. |
| `name` | text | Display name |
| `description` | text | 1-sentence definition (for tooltip) |
| `naics_anchors` | text[] | Array of NAICS prefixes/codes |
| `keywords` | text[] | Array of phrases for title/description matching |
| `priority_order` | int | UI sort order |
| `created_at` | timestamptz | |

**Tagging table — `opportunity_cta_tags`** (joined to `sam_opportunities`)

| Column | Type | Notes |
|---|---|---|
| `notice_id` | text FK → sam_opportunities | |
| `cta_id` | text FK → cta_codes | |
| `confidence` | text | `high` (NAICS match) / `medium` (keyword match) / `low` (description hit only) |
| `match_source` | text | `naics` / `keyword_title` / `keyword_description` / `manual` |
| `tagged_at` | timestamptz | |
| PK | (notice_id, cta_id) | One opportunity can have multiple CTAs |

**Migration file:** `supabase/migrations/YYYYMMDD_cta_filters.sql`

### B. Backend job: CTA tagger

A scheduled Supabase function or cron job that:

1. Reads new `sam_opportunities` rows (or all rows on first run)
2. For each opportunity:
   - Match `naics_code` against `cta_codes.naics_anchors` → tag with `confidence: high, match_source: naics`
   - Match `title` (case-insensitive) against `cta_codes.keywords` → tag with `confidence: medium, match_source: keyword_title`
   - Match `description` (case-insensitive) against `cta_codes.keywords` → tag with `confidence: low, match_source: keyword_description`
3. Upserts into `opportunity_cta_tags` (one row per CTA matched)
4. **Idempotent** — re-running on the same notice_id is safe

**Implementation location:** `src/lib/cta/tagger.ts` (new) + cron route `src/app/api/cron/tag-cta/route.ts` (new). Schedule: nightly via `vercel.json` after the daily SAM ingest.

**Initial backfill:** One-time run against all 24K cached opportunities. Estimate: ~5–10 min.

### C. Backend: opportunity search filter

Update `/api/app/opportunities/route.ts`:

- Add query param `cta` (comma-separated CTA IDs, e.g., `?cta=trusted_ai,microelectronics`)
- When present, JOIN `opportunity_cta_tags` and filter to opportunities that have at least one matching CTA tag
- Return CTA tags in the opportunity card payload (so UI can render badges)

### D. UI: filter chip + opportunity badges

**On `/app/opportunities`:**

- New "Critical Tech Area" filter section (above or alongside NAICS filter)
- Multi-select chip group, one chip per CTA (sorted by `priority_order`)
- Selected state: chip fills with the gradient (navy → purple per design system)
- Tooltip on hover: 1-sentence definition from `cta_codes.description`
- Empty state: "No opportunities match the selected Critical Tech Areas. Try fewer CTAs or expand your NAICS."

**Per opportunity card:**

- Small CTA badges below the title (max 2 visible, "+N more" if >2)
- Color-coded by confidence: `high` = solid color, `medium` = lighter, `low` = outlined only
- Click on badge → adds that CTA to the active filter

### E. Org Tab integration (Coach Mode)

- Saved view: "CTA-aligned pursuits" — pre-selects all 14 CTAs and filters the org's roster pursuits
- Roster aggregate widget: bar chart showing % of roster pursuits / wins by CTA
- For NAPEX demo: show "Your roster: 38% Trusted AI, 22% Microelectronics, 18% Cyber, 22% other"

### F. Default config / quality

- All 14 CTAs visible by default in the filter UI
- Tagging confidence threshold for the badge: show `high` always, `medium` always, `low` only if no `high`/`medium` tag exists
- Internal QA dashboard: `/admin/cta-tagging` — shows tagged opportunity count by CTA, confidence breakdown, and "review" queue for low-confidence matches Eric can manually verify

## 6. Acceptance criteria

A new APEX center director on the booth at NAPEX should be able to:

1. ✅ Open `/app/opportunities` and see the 14 CTA chips
2. ✅ Multi-select 3 CTAs (e.g., Trusted AI, Microelectronics, Space) and see the result count drop appropriately (e.g., from 12,000 → ~800)
3. ✅ Hover a chip and see a 1-sentence definition
4. ✅ See CTA badges on individual opportunity cards
5. ✅ Switch to Coach Mode → click "Org Tab" → see roster CTA breakdown widget with real numbers
6. ✅ Save the filtered view as a saved view ("APEX 35% Mandate Pipeline") that persists across logins
7. ✅ Demo runs in <60 seconds end-to-end on a real laptop in airplane mode (using cached data)

## 7. Out of scope (defer)

- ❌ ML classifier for CTA tagging (rules-based first; revisit post-NAPEX if accuracy is poor)
- ❌ DoD OSBP-validated CTA list (use research-derived list now; validate Phase 2)
- ❌ CTA filter on `/app/forecasts` (forecasts are an opportunity type — apply same approach but defer to v2)
- ❌ User-defined custom tech areas
- ❌ CTA scoring weights in the opportunity scorer (Mindy's existing scoring stays untouched)

## 8. Estimated effort

| Area | Effort | Owner |
|---|---|---|
| Migrations + seed `cta_codes` | 0.5 day | Eng |
| Tagger lib + cron route + initial backfill | 1.5 days | Eng |
| API filter param + payload changes | 0.5 day | Eng |
| Filter chip UI + tooltip + badge UI | 1.5 days | Eng |
| Org Tab saved view + roster aggregate widget | 1.5 days | Eng |
| Internal QA dashboard | 0.5 day | Eng |
| Testing + demo data prep | 1 day | Eng + Eric |
| **TOTAL** | **~7 engineer-days** (1.5 weeks) | |

**Risk buffer:** 0.5 week. Aim for end of Week 2 (Jun 27) demo-ready, full polish by end of Week 3 (Jul 4).

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CTA list / NAICS mapping wrong → embarrassing on the booth | Med | High | Eric/Nora locks the list Mon Jun 16; flag low-confidence tags in UI |
| Keyword matching produces false positives (e.g., "AI" matches non-AI opportunities) | High | Med | Use phrase boundaries, prefer multi-word keywords, manual QA on top 100 results before NAPEX |
| Tagging job too slow on 24K records | Low | Low | Backfill in a single run (~10 min); incremental nightly is fast |
| UI overwhelms users not at APEX (most Mindy users don't care about CTAs) | Med | Low | CTA filter section is collapsed by default for non-APEX users; expanded for users with `org_admin` role at an APEX center |
| Cross-org data bleed (one org sees another's roster CTAs) | Low | High | Reuse existing workspace-scoping; explicit test for cross-org leak before NAPEX |

## 10. Decision log

| Date | Decision | By |
|---|---|---|
| 2026-06-13 | Ship as rules-based tagging (NAICS + keyword), not ML. Speed > accuracy for NAPEX. | Eric |
| 2026-06-13 | 14 CTAs come from `funding-levers-research.md` §1.3 (research-derived). DoD OSBP validation deferred to Phase 2. | Eric |
| 2026-06-13 | Build for booth demo flow first. Coach Mode roster widget is part of MVP, not v2. | Eric |
| 2026-06-13 | EDMIS export feature explicitly NOT bundled here — separate post-NAPEX PRD. | Eric |

---

*Created: June 13, 2026 — NAPEX repivot. Target ship: Jun 27, 2026.*
