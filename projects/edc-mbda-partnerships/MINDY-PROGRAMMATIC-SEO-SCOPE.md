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

## ⭐ BIG-TECH SEO ROADMAP (Eric: "what would big SaaS/big tech do?") — June 19
The Zillow/Yelp/G2/Crunchbase playbook: don't index a subset, **own the entire index.** It's a
SEQUENCE, not a menu — each phase unlocks the next. Build straight through.

**Phase 1 — Opportunity pages** ✅ SHIPPED (`/opportunity/[slug]`, ~34k, similar-opp cross-links).
The atom.

**Phase 2 — Faceted page explosion** (NEXT — pure data, biggest multiplier, no LLM)
`/naics/[code]/[state]`, `/agency/[x]/naics/[y]`, `/set-aside/[type]/[naics]`, `/psc/[code]`,
`/state/[st]/[naics]`. Every INTERSECTION = a page (Yelp: "plumbers in Austin 78704"). 34k → 100k+.
Creates the HUB pages the opp pages link up into → build hubs before the link-web matters.

**Phase 3 — Contractor + vs/alternatives pages** (highest commercial intent; reuses Phase-2 infra)
317k contractor pages + `/[contractor]-vs-[contractor]` + `/alternatives/[competitor]` (G2 playbook).
People searching contractors/competitors are close to buying.

**Phase 4 — AI-generated analysis per page** (the moat + unlocks "thin" pages)
Mindy's LLM writes a UNIQUE, data-grounded paragraph per page ("who wins this work, why it matters").
Sits ON TOP of all pages from 1–3 → build after the skeletons exist. This makes thin pages
NOT-thin → retroactively indexes the 78k empty-description opps we'd otherwise gate. The 2026 AI-SEO
play; Mindy is uniquely positioned (we have the data + the LLM).

**Phase 5 — Indexation engineering** (woven throughout, ramps at the end)
Sitemap INDEX files (millions of URLs, not the 20k cap), IndexNow ping, max internal-link density
(20–50 links/page), enrich-don't-gate. Gets 100k+ pages actually crawled.

```
P1 opp atoms ✅ → P2 faceted hubs (data) → P3 contractors+vs (intent) → P4 AI enrich (moat) ⟂ P5 indexation
```

## Guardrails — REFRAMED (Eric: "forget my guardrails, go big-tech")
- **OLD (timid):** gate thin pages out of the sitemap. **NEW (big-tech):** don't HIDE thin pages —
  make them NOT-thin (Phase 4 AI enrichment + pull SOW + similar awards). Zillow never 404s a boring
  house; it enriches it until it ranks. Phase 1 still gates (no enrichment yet); Phase 4 flips the gate
  to "enrich + index everything."
- **The ONE real limit (not timidity):** Google penalizes DOORWAY/spam pages (mass pages, zero unique
  value). Big-tech answer = "make each page genuinely useful AT SCALE" (engineering+data), NOT "make
  fewer pages." That's the bar: every page must answer a real query with real data.
- Real data only (rule #1); brand-led distribution (GovCon Giants) on getmindy.ai + govcongiants.com.
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
