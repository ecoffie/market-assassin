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

### #3 — Real SBA VetCert data (NOT SAM self-cert) — core to the SDVOSB value prop
**Symptom (real):** `lookup_sam_entity` returned `hasSDVOSB: false` for a firm whose own site says
SBA-certified SDVOSB.
**Root cause (confirmed in code):** `hasSDVOSB`/`has8a`/etc. come from SAM's
`coreData.businessTypes.sbaBusinessTypeList` — the **SELF-CERT** field
(`src/lib/sam/entity-api.ts:153-162`, cached in `recipient-certs.ts:88,135`). This is NOT SBA VetCert.
Since 2024, **SBA VetCert** status (not the SAM self-cert flag) is what gates SDVOSB set-aside eligibility.
**Fix:**
- Ingest **SBA VetCert / DSBS** as the AUTHORITATIVE certification source, timestamped.
- Everywhere distinguish **"SAM self-identified"** vs **"SBA-certified"** (the caveat is currently
  buried in the payload). New columns on `recipient_certifications`: `sdvosb_source` (self|vetcert),
  `vetcert_checked_at`.
- **Files:** `src/lib/sam/entity-api.ts`, `src/lib/sam/recipient-certs.ts`, + a new VetCert client
  (`src/lib/sba/vetcert.ts`) + a migration for the source/timestamp columns.

### #6 — DoD SBIR/STTR ingestion (DSIP) — `search_sbir` is NIH-only
**Symptom (real):** `search_sbir` (built on NIH RePORTER) returned nothing for EOD. For a GovCon
platform, **DoD SBIR/STTR via DSIP** (Army/Navy/AF/SOCOM/DTRA topics w/ numbers + close dates) is
the whole game.
**Fix:** ingest the **DSIP topic feed** (ideally xTech / APFIT alongside). New source + a
`dod_sbir_topics` table; extend `search_sbir` to union NIH + DSIP.
**Files:** `src/app/api/sbir/route.ts`, `src/lib/multisite/*` (existing scraper pattern), new DSIP adapter.

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
