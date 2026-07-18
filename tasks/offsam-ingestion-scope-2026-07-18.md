# Off-SAM opportunity ingestion — scope (2026-07-18)

**Decision locked (Eric, 2026-07-18):** differentiate coverage, don't chase raw count.
Two workstreams: (1) revive DIBBS (paid Apify unblocks it), (2) scope ONE lab **platform**
adapter. This doc is the plan for sign-off before any build.

Companion strategy: `docs/strategy/OPPORTUNITY-DATA-LANDSCAPE.md`. Source registry:
`src/data/agency-procurement-sources.json` (v2, PR #382).

---

## Why "platform," not "one lab"

Eric said *platform*. A bespoke HTML scraper per lab (NREL, Ames, JLab…) is easier per site
but zero reuse. **SAP Ariba Discovery is a genuine platform: one adapter → many buyers.**
- Covers **LANL + ORNL** today (both confirmed on Ariba per the portal research).
- Extends to **any** Ariba Discovery buyer later — other agencies, primes — for free.
- LANL's own page confirms the posting list is **viewable on the public Ariba Discovery
  buyer profile WITHOUT login**; an Ariba account is only needed to *respond*. We only
  need to **surface** the opp + deep link, so **no account is needed for ingestion.**
- Postings are **>$250K competitive subcontracts** — the differentiated, off-SAM FFRDC
  data that is the whole point of "differentiate."
- Headless scrape fits the now-**paid Apify** account (same rig as DIBBS).

Rejected for the pilot: custom HTML boards (fast but no reuse); Oracle iSupplier / Fusion /
PeopleSoft (each is a per-institution deployment, not a shared network — no single adapter).

---

## Workstream 1 — DIBBS revive (cheap, already built)

**Finding:** the pipeline is complete and paid-tier ready. `src/lib/dibbs/ingest.ts` already
requests `maxItems` up to 1000 through a US residential proxy; `FREE_TIER_CAP=10` is only a
**warning log**, not a cap. The cron `GET /api/cron/sync-dibbs` 503s solely when `APIFY_TOKEN`
is unset. It's "paused" because the token/cron were never turned on — **no code change needed.**

**Steps (operational only):**
1. Set **`APIFY_TOKEN`** (paid account) in Vercel prod; redeploy so it binds.
2. Manual run: `GET /api/cron/sync-dibbs?maxItems=1000` → confirm it returns **>10 items**
   (no free-tier warning in logs) and `dibbs_rfqs` grows past **895**.
3. Add a **`cron_jobs`** row (dispatcher, daily — NOT `vercel.json`), budget-bounded like the
   other drainers. Columns: `job_name` / `cron_expr` / `enabled='true'` / route.
4. Verify: `npm run db -- dibbs_rfqs --count` climbs day over day.

**Effort:** ~half a day, mostly config + verify. **Risk:** low (WAF handled by the paid
residential proxy — the reason we chose Apify).

---

## Workstream 2 — Ariba Discovery adapter (the differentiated build)

Mirror the DIBBS pattern (Apify actor → normalize → durable Supabase table → dispatcher cron
→ surface in Mindy). New lib `src/lib/ariba/ingest.ts`.

### 2a. Spike — access + structure (DONE 2026-07-18, findings below)

**✅ LANL confirmed feasible.** Public Ariba Discovery profile, buyer **ANID `AN01460290704`**:
- `https://service.ariba.com/Discovery.aw/ad/profile?key=AN01460290704`
- Renders **31 active postings, NO login**, structured: title, dollar band, close date, deep
  link. WebFetch read the list (server-rendered enough to parse — a plain fetch may work; use
  Apify residential proxy anyway in case Ariba WAFs automated traffic).
- Real off-SAM subcontract work + varied bands, incl. **below** $250K (e.g. "HPC Storage
  Technical Services" $100–500K close 28 Feb 2026; "Stack Emissions Testing" $100–500K; "Wire
  EDM Machine Support" <$1K). Paged 10/profile → 31 total = ~4 pages to walk.

**⚠️ ORNL is NOT an Ariba Discovery public-profile buyer — assumption corrected.** ORNL uses
Ariba only as the **response** system ("ORNL Buy"); its opportunity **LIST lives on its own
page** `https://smallbusiness.ornl.gov/business-opportunities` (subscribe for emails). So ORNL
needs a **separate custom-HTML scraper**, not the Discovery adapter.

**Reuse thesis refined:** the "one adapter, N labs" framing was half wrong at the lab level —
Discovery profiles are **per-buyer**, and only some labs publish to Discovery. The real reuse
is **across the whole discovery.ariba.com network** (agencies, primes, universities, LANL) —
LANL is the validated DOE **entry point** to a network adapter, not a lab-shared profile.

**Still open (finish in the build's first hour):** SAM cross-post rate for LANL postings;
confirm plain-fetch vs headless (WAF); the exact paging param (`?awpp=`/`awrr=`).

### 2b. Full adapter (only if spike is green) — ~2–3 days
- **Table:** new `offsam_opportunities` (KEEP separate from `sam_opportunities` — different
  provenance + bid mechanism). Columns incl. `source` ('ariba_discovery'), `source_buyer`
  ('LANL'/'ORNL'), `source_posting_id`, dates, deep link, `raw`, `fetched_at`.
- **Dedup:** by `(source, source_posting_id)`. Flag SAM cross-posts, don't merge in v1.
- **Cron:** dispatcher `cron_jobs` row, daily, resumable/budget-bounded.
- **Surface in Mindy (the differentiation shows up here):**
  - Search corpus (`mi-dashboard`) with a **"Subcontract · Ariba"** badge.
  - Alerts: **opt-in + distinctly labeled** — these are teaming/subcontract, NOT prime work;
    do not fold them into the prime daily alert unlabeled.
  - Position as the wedge: *"subcontract opportunities on FFRDC work you won't see on SAM."*
- **Change-tracking = the moat (not optional):** snapshot due-date/status changes over time
  like `recompete_changes`. A snapshot is public content; tracking what changes is the moat.
  Build this in from day one, or the pilot is just more content.

**Mirror rule:** if this feeds Mindy, it must also be exposed as an **MCP tool / shared lib**
(memory `mindy-fixes-mirror-to-mcp`) — likely a `search_offsam_opportunities` tool.

---

## Sequencing & honesty

- Run **DIBBS revive** and the **Ariba spike** in parallel (DIBBS is config; spike is research).
- **Don't oversell volume.** Competitive >$250K subcontracts are not high-count. That's fine —
  this is *differentiation*, not count. Say so; the honest framing is the wedge.
- Nothing here is wired yet. This doc = plan for sign-off.

**Surface decision (Eric, 2026-07-18):** **separate Teaming view first** — hold Ariba
subcontract opps in their own view until quality/volume is proven, then graduate to opt-in
labeled alerts. Keeps subcontract work out of the prime daily alert.
