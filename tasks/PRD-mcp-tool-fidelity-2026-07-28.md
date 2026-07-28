# PRD — MCP Tool Fidelity: fixing the "would actively mislead" gaps

**Source:** Eric's real-run feedback, 2026-07-28 (a new-to-federal EOD/SDVOSB firm walkthrough).
**Lens that ranks everything here:** *would the raw tool output mislead someone who didn't
cross-check it?* The three that hit that bar (#1, #3, #6) are the fund-these-first tier.

> These are MCP tool / data-pipeline issues, not UI. Each item names the real file(s) so the fix
> is a scoped change, not a re-derivation. Grounded against the code 2026-07-28.

---

## 🔴 FUND-FIRST TIER (raw output actively misled)

### #1 — Semantic keyword expansion for `generate_market_report` (BIGGEST)
**Symptom (real):** the market report runs the keyword as an EXACT string against USASpending.
- "drones" → only ~$243M (missed UAS / UAV / unmanned aircraft / sUAS entirely).
- "explosive ordnance disposal" → silently reduced to "explosive" + PSC 1376 (Bulk Explosives) →
  handed back the **$2.7B energetics/ammunition-manufacturing** market — the OPPOSITE of a firm
  that makes EOD *tools*. A decision-maker reading the top-line is misled.

**The fix is SMALLER than it looks — the engine already exists and is wired for onboarding:**
- `src/lib/market/keyword-coverage.ts` — `keywordCoverage()` with synonym expansion
  (`sector-expansions.ts`) + the 90%-coverage NAICS derivation.
- `src/lib/market/spend-query.ts` — the canonical market query; already accepts a pre-computed coverage.
- **`generate_market_report` is NOT routing through them.** Fix = pipe the report's keyword through
  `keywordCoverage()` / `spend-query` BEFORE hitting USASpending, so it measures the expanded market.
- **Extend the terms-of-art dict** (`keyword-coverage.ts` synonym set + a domain map): "EOD" →
  PSC 1385 (+ related) not substring "explosive"; "drone" → PSC 1550 + UAS/UAV/sUAS synonyms.
  Also expose `derive_company_keywords` as the pre-pass for the report by default.
- **Files:** `src/mcp/tools/*market-report*`, `src/lib/market/keyword-coverage.ts`,
  `src/lib/market/spend-query.ts`, `src/lib/market/sector-expansions.ts`.

### #3 — Real SBA VetCert data — ✅ RESOLVED via honest labeling (2026-07-28)
> **Decision (Eric):** accept SAM's authoritative subset (8a/HUBZone) + honest 'self-identified' labeling for
> SDVOSB/WOSB. No clean public VetCert source exists (research below); a scrape isn't worth the fragility.
> The schema is wired for a real SBA API ('vetcert' source) when one ships. #3 is DONE at Part 1.

### #3 — Real SBA VetCert data (NOT SAM self-cert) — core to the SDVOSB value prop
**Symptom (real):** `lookup_sam_entity` returned `hasSDVOSB: false` for a firm whose own site says
SBA-certified SDVOSB.
**Root cause (confirmed in code):** `hasSDVOSB`/`has8a`/etc. come from SAM's
`coreData.businessTypes.sbaBusinessTypeList` — the **SELF-CERT** field
(`src/lib/sam/entity-api.ts:153-162`, cached in `recipient-certs.ts:88,135`). This is NOT SBA VetCert.
Since 2024, **SBA VetCert** status (not the SAM self-cert flag) is what gates SDVOSB set-aside eligibility.
**PART 1 — ✅ SHIPPED (PR #577, migration run + verified 2026-07-28):** labeling. Per-cert provenance
columns (`is_*_source`, `vetcert_checked_at`) + `certBucketsWithSource`/`certSourceLabel`; 8(a)/HUBZone
= SBA-certified codes (authoritative), SDVOSB/WOSB = SAM self-identified. `lookup_sam_entity` returns a
`cert_provenance` block + a key caveat. The trust bug ("hasSDVOSB:false looked authoritative") is closed.

**PART 2 — VetCert DATA INGEST — source research done 2026-07-28, verdict: NO clean public source.**
Investigated every candidate:
- **`certifications.sba.gov` (MySBA Certifications / DSBS search)** — the authoritative system of record,
  BUT it's a React SPA whose backend is a session-gated PORTAL (all `/api/*` probes 404 unauth; the
  bundle's only "export" is the UI's 5,000-email results export, not a bulk API). No public query endpoint.
- **`data.sba.gov` open-data / CKAN** — the CKAN `package_list`/`datastore_search_sql` paths 404 (portal
  migrated); `catalog.data.gov` harvest returns 0 SBA certified-firm datasets. No bulk file.
- **SAM.gov entity extract** — carries only SAM's SELF-CERT `sbaBusinessTypeList` (the very field that's
  wrong), not VetCert. 8(a)/HUBZone codes there ARE authoritative (already used).
- **Third-party scrapers** (Apify DSBS crawler) exist but are unofficial + $-metered.
**So an authoritative VetCert ingest requires either a scrape of the session-gated DSBS search, a FOIA/
bulk-data request to SBA, or accepting SAM's authoritative-only subset (8a/HUBZone) + honest self-cert
labeling for SDVOSB/WOSB (what Part 1 does).** DECISION PENDING Eric: is a DSBS scrape worth it, or is
the labeled self-cert honest enough until SBA publishes an API?
- **Files (Part 1, done):** `src/lib/sam/recipient-certs.ts`, `src/mcp/tools/sam-entity.ts`,
  `supabase/migrations/20260728_cert_source_provenance.sql`. Part 2 (deferred): a `src/lib/sba/vetcert.ts`
  IF a source is chosen.

### #6 — DoD SBIR/STTR ingestion (DSIP) — `search_sbir` is NIH-only
**Symptom (real):** `search_sbir` (built on NIH RePORTER) returned nothing for EOD. For a GovCon
platform, **DoD SBIR/STTR via DSIP** (Army/Navy/AF/SOCOM/DTRA topics w/ numbers + close dates) is
the whole game.
**Fix:** ingest DoD SBIR/STTR topics + open solicitations; extend `search_sbir` to union NIH + DoD.

**SOURCE RESEARCH — done 2026-07-28. VERDICT: buildable via the official sbir.gov API.**
- ✅ **`https://api.www.sbir.gov/public/api/solicitations?agency=DOD&open=1` — the OFFICIAL cross-agency
  SBIR JSON API.** Verified REACHABLE: it returned a structured `{"Code":"TooManyRequestsError"}` (a
  rate limit, NOT a wall) with a browser User-Agent — proving the endpoint works and just needs
  cache-first + backoff (the same discipline as every other rate-limited API we use). Supports
  agency=DOD, open/future/closed, JSON/XML/CSV. Carries solicitations → nested topics (topic number,
  close date, phase). Companion `/awards` + `/firm` endpoints exist too.
  - ⚠️ Bot-block: a bare curl / no-UA hits 403 or `{"message":"Forbidden"}`. Send a browser UA.
  - ⚠️ Rate-limited hard from a single IP — MUST cache (a `dod_sbir_topics` table refreshed by a cron,
    NOT a live call per user query). This is the bulk-drain-then-serve-from-cache pattern.
- ❌ **DSIP (`dodsbirsttr.mil/submissions/api/public/download/solicitationDocuments`)** returns 200 but
  is DOCUMENTS-only (per-solicitation PDF download), NOT a queryable topic feed. Use sbir.gov instead;
  DSIP only for deep-linking a topic's PDF.
- xTech/APFIT = separate (competitions, not SBIR topics) — a later add, not part of this.

**BUILD PLAN (ready):**
1. `src/lib/sbir/dod-sbir.ts` — a client for `api.www.sbir.gov` (browser UA, backoff, JSON parse).
2. Migration: `dod_sbir_topics` table (topic_number, title, agency/component, phase, open/close dates,
   solicitation, url, description, naics/keywords). Hand-run.
3. `/api/cron/sync-dod-sbir` — cache-first drain of DoD open+future topics into the table (rate-limited,
   resumable), registered as a `cron_jobs` row (route FIRST, then the row — per the cron rule).
4. Extend `search_sbir` / `src/lib/sbir/search.ts` to union NIH + the cached DoD topics; add
   `source: 'dod'` and a `sourceOptions` entry.
**Files:** `src/app/api/sbir/route.ts`, `src/lib/sbir/search.ts`, new `src/lib/sbir/dod-sbir.ts`,
new cron + migration.

---

## 🟠 SECOND TIER (overstates certainty / silent failures)

### #2 — Headline metrics + booleans overstate certainty
`assess_market_depth` returned `rule_of_two_met: true` for 332994 SDVOSB while the counts were
**200 emerging, 0 capable, 0 active performers**. The boolean says "met"; the substance says "no
proven performers." Same shape as the market report's single `total_market`.
**Fix:** headline reflects **capable** depth, not raw registrations — a "capable Rule of Two" vs
"registration-only" split up front; flag any keyword-fragile total with a confidence marker.
**Files:** `src/mcp/tools/*market-depth*`, `assess_market_depth` logic.

### #4 — Zero-result queries fail silently instead of widening
- `search_past_contracts` PSC 1385 (valid EOD-tools code) → empty, purely because it defaulted to
  place-of-performance scope (thin there). Should auto-retry `recipient`/`both`, nationwide, + say so.
- `lookup_federal_osbp` whiffed on "Indian Head," "PEO Ammunition," "Joint Munitions Command";
  resolved only NAVSEA + Army parent. Add fuzzy/alias matching + parent-command fallback
  ("Indian Head" → NAVSEA OSBP) instead of `grounded:false` with no next step.
**Files:** `src/lib/usaspending/awards-search.ts` (past-contracts scope retry),
`src/mcp/tools/*osbp*` + the OSBP directory data.

### #5 — Contact role enrichment didn't populate
`search_federal_contacts` returned emailable POCs but `role` / `role_category_label` were **null on
every record** → can't filter to the KO or the small-business POC (the exact routing a new entrant
needs). The promised OSBP small-business-POC prepend also didn't appear on DoDAAC-anchored pulls.
**Fix:** populate the role buckets; surface the office's SB POC at the top.
**Files:** `src/app/api/app/federal-contacts/route.ts`, the role-classification lib.

---

## 🟡 THIRD TIER (packaging / net-new)

### #7 — "New-to-federal readiness" combo tool + GSA Schedule lookup
The most valuable output came from CHAINING tools (SAM entity → award history → market depth →
contacts) to expose foundation gaps (cert conflict, NAICS mismatch, no past-performance). Package a
single **`federal_readiness`** combo (UEI in → registration health, NAICS/PSC alignment vs stated
business, cert + set-aside eligibility, GSA Schedule presence, award whitespace).
Also add a **GSA MAS / eLibrary lookup** (verifying a Schedule required a web search — no tool today).
**Files:** new `src/mcp/tools/federal-readiness.ts` (composes existing tools) + a GSA eLibrary client.

---

## ✅ KEEP AS-IS (Eric called out as working well — don't regress)

> **These are INVARIANTS to defend, not features to admire** (Eric's real-run praise, 2026-07-28 —
> full record: memory `mcp_tool_strengths_to_protect`). The through-line: Mindy is strongest exactly
> where it matters for a real capture decision — named buying-office contacts, exposing foundation
> gaps instead of papering over them, never inventing data. The fixes above are REFINEMENTS on a tool
> already pointed at the right problems; refine WITHOUT regressing the strengths to protect.

- Market report's **reconciliation section** ("a single NAICS misses X% of the market") — honest, well-designed.
- **DoDAAC-anchored contact pulls** — precise + immediately usable.
- Market depth's **self-cert-vs-vetted caveats** — right instinct (just surface them louder, #2/#3).
- **Per-call credit transparency** — good.

---

## Build order (Eric's "if you can only fund three")
1. **#1 semantic keyword expansion** — smallest effort, biggest mislead-prevention (engine exists).
2. **#3 real VetCert data** — core SDVOSB value prop; new pipeline.
3. **#6 DoD SBIR ingestion** — real coverage gap for defense users; new source.
Then #2 (confidence framing), #4 (widen-on-zero), #5 (roles), #7 (combo + GSA).
