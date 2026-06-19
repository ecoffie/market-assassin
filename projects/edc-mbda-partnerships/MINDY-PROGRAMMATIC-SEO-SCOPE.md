# Mindy Programmatic SEO — Build Scope (learn from HigherGov's moat)

**Why:** HigherGov's real moat = they OWN the search index — a public, indexable, cross-linked page for
every entity (opportunity, NAICS, PSC, agency, contractor) + per-PERSONA pages (M&A/investors, agencies,
consultants). Every NAICS/agency/opp a contractor Googles → a HigherGov page ranks → free top-of-funnel
forever. This is the mass-acquisition engine that PAIRS with Mindy's customer-acquisition model + brand.

## GOOD NEWS: Mindy already has the bones (it's a FILL-IN, not a from-scratch build)
Verified in the codebase — existing programmatic routes + sitemap:
- ✅ `contractors/[slug]` (+ `/naics`, `/agencies`, `/contracts/[[...page]]` sub-pages)
- ✅ `agencies/[slug]` · `naics/[code]` · `contracts/[piid]` · `awards/[id]` · `top/[slug]`
- ✅ `glossary/[slug]` · `blog/[slug]` · `sitemap.ts`
- Data we already have: 317K contractors (BigQuery), 88K SAM opps, NAICS/PSC, award history.

## THE GAPS vs HigherGov (what to build)
| Gap | HigherGov has | Mindy has | Build |
|---|---|---|---|
| **Per-OPPORTUNITY pages** | `/contract-opportunity/[slug]` for EVERY opp (incl. the DLA NV012 topic) | ❌ only `/shared/opp/[shareId]` (gated share links, not SEO) | **`/opportunity/[slug]`** public indexable page per SAM opp (88K pages) |
| **"Similar Opportunities" cross-linking** | every opp page links to similar opps (internal-link web = SEO juice + dwell) | ❌ | cross-link block on opp + contractor + NAICS pages (reuse semantic/NAICS match) |
| **PSC pages** | PSC taxonomy pages | ❌ (have NAICS, not PSC) | **`/psc/[code]`** (mirror `/naics/[code]`) |
| **Persona landing pages** | `/for-investors-banks`, `/for-government-agencies`, consultants, contractors | ❌ | persona pages (see M&A section below) |
| **Forecasts / grants / SBIR pages** | indexable | partial | extend to public indexable |

## ⭐ M&A / high-money persona pages (Eric's point — sell the SAME data to deep pockets)
HigherGov repackages the SAME data for budget-rich verticals via dedicated pages:
- **`/for-investors-banks`** — "Grow Your Acquisition & Financing Pipeline. M&A and Market Intelligence
  to identify and research GovCon acquisition targets and clients." (Investor tier, 50 licenses.)
- **`/for-government-agencies`** — "Better Serve Your Constituents."
- Plus Consultants, Contractors, Grant Recipients.
**The insight (Eric):** the data's already there — you just MARKET it to whoever has money. A
comprehensive site = perceived DEPTH = credibility with **large primes + high-tier clients** (the
$5K+/Investor-tier buyers), even if most revenue is the mass small-biz funnel.
**Decision: build Mindy persona pages** — at minimum `/for-primes` (large contractors / teaming) and
`/for-investors` (M&A/PE/banks researching GovCon targets — Mindy's UEI award-history + concentration
data IS deal-diligence data). High-tier credibility + a second revenue vertical, same data.

## Build phases (smallest-impact-first, rule: simplicity)
1. **`/opportunity/[slug]`** — the biggest gap (88K pages). One dynamic route off `sam_opportunities`,
   SSG/ISR, full notice text + buyer + NAICS/PSC + a "Similar Opportunities" cross-link block. Add to
   sitemap. This alone ~matches HigherGov's core SEO surface.
2. **"Similar Opportunities" cross-linking** everywhere (opp↔opp, contractor↔opp, NAICS↔opp) — the
   internal-link web. Reuse the semantic/NAICS matcher already built.
3. **`/psc/[code]`** — mirror `/naics/[code]`, ~1000+ pages.
4. **Persona pages** — `/for-primes`, `/for-investors` (M&A/depth play, high-tier credibility).
5. Sitemap + robots + structured data (JSON-LD) on all → indexability.

## Guardrails (memories)
- **No thin pages** — GSC penalizes them (we've hit `fix/sitemap-gate-thin-subpages`). Gate weak
  pages out of the sitemap; only index pages with real content.
- **Brand drives it** — host on getmindy.ai + govcongiants.com; GovCon Giants brand = the
  distribution layer (the "Nike" moat), Mindy = the product (keep exit-separation clean).
- **Real data only** (rule #1) — every page from SAM/USASpending/BQ, never fabricated.

## Open items
- [ ] Build `/opportunity/[slug]` (Phase 1 — biggest leverage)
- [ ] "Similar Opportunities" cross-link block (the SEO juice)
- [ ] `/psc/[code]` pages
- [ ] Persona pages: `/for-primes` + `/for-investors` (M&A depth/credibility)
- [ ] Sitemap + JSON-LD; gate thin pages
- [ ] Measure: GSC impressions/clicks baseline before, track after

*Created June 19 2026. HigherGov's moat is SEO ownership of the index — Mindy already has the routing
bones + the data; the work is the opportunity-page layer + cross-linking + persona pages. Pairs with
the CAC model + brand for mass acquisition.*
