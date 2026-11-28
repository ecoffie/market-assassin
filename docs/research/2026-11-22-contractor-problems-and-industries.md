# Federal Contracting for New and Small Businesses: Research Report

Run date: 2026-11-22 · Scope: contractor side, FY2024–FY2026 · Team: `docs/agents/research-team.md`

## Read this first
- Evidence is thin. No available tool gives dollars by industry by fiscal year, or small-business win share by industry. Every score is a judgment, not a measurement.
- Unknown never means zero.
- The lucrative-industry numbers (Section 3) were not re-checked by the editor.

## Bottom line
- The biggest contractor problems are finding bids early, having no past performance, and proposal workload. All three map onto data Mindy already holds.
- Cash flow, CMMC cost and bonding hurt badly, but they are financing and compliance problems. A tool can guide on them but not solve them.
- The easiest industries are the everyday service trades: landscaping (561730), janitorial (561720) and waste collection (562111).
- The most lucrative (provisional, from expiring-contract counts) are R&D (541715), computer systems design (541512), building construction (236220) and engineering (541330).
- Easy and lucrative overlap only thinly: management consulting (541611), facilities support (561210) and building construction (236220). Small firms mostly reach these as subcontractors.

## 1. Top contractor problems and how to make each very easy

| # | Problem | Evidence | Effort | Very easy fix |
|---|---|---|---|---|
| 1 | Finding bids too late or missing them | Weak to medium (Deltek 2025, unconfirmed in fetched article) | M | Type what you sell, see open now / coming back / coming soon, incl. sources-sought |
| 2 | No past performance | Medium (≥6 podcast episodes), no % | M | Builder that turns commercial/sub/state work into project sheets; flag bids accepting limited past performance |
| 3 | Cash flow and slow payment | Weak (podcasts; no late-payment data) | L | Cash-gap forecast before bid, linked to loans and factoring |
| 4 | CMMC cost (small defense firms) | Medium (SBA, DoD ~$100K L2 estimate, PreVeil, Deltek) | L | Self-check: does it apply, which level, cheapest path |
| 5 | Proposal and compliance workload | Weak to medium (Deltek) | M | Reusable profile that auto-fills a Section L/M checklist, with a pre-submit check |
| 6 | Finding teaming partners / primes that subcontract | Weak | M | Partner matching by NAICS, certification, agency |
| 7 | Teaming terms ("up to 49%", indemnity, flow-downs) | Weak | M | Teaming-agreement red-flag reader |
| 8 | Reaching and understanding the buyer | Weak (15–30 attempts, one podcast) | M | One-page brief per buying office |
| 9 | Not using programs like 8(a) | Medium (~46% of small respondents, Deltek) | M | "Which program fits me" explainer |
| 10 | Getting started (SAM, UEI, codes, certs) | Weak | S–M | Guided checklist |
| 11 | Bid/no-bid overreach | Weak | S–M | "Should I bid" score with plain no-bid reason |
| 12 | Pricing | Weak | M | Pricing helper from past awards |
| 13 | Debriefs and learning from losses | Weak | S | Debrief template and tracker |
| 14 | Bonding (construction) | Weak | L | — |
| 15 | Low set-aside share (symptom) | Strong (verified): DoD FY2026 set-aside-coded SB 3.4% vs 23% goal on $441.2B | L | Set-aside share by buyer and industry |

Unverified: CMMC Phase II suspension for small firms (SBA title only), SBA FY2025 scorecard ~28% (snippet).

## 2. Easiest industries to enter (judgment, 10 = easiest)

| Rank | Industry (NAICS) | Ease | Why |
|---|---|---|---|
| 1 | Landscaping (561730) | 8 | Small firms win; 13,584 registered; Rule of Two met in sample |
| 2 | Janitorial (561720) | 7 | 16,032 registered; small firms capable; top winners may be AbilityOne nonprofits (unconfirmed) |
| 3 | Solid waste collection (562111) | 7 | 5,587 registered; small-firm depth undetermined |
| 4 | Other prof/tech services (541990) | 6 | 31,573 registered; little other evidence |
| 5 | Plumbing/HVAC (238220) | 6 | Spend concentrated at NC Marine bases |
| 6 | Other specialty trade (238990) | 5 | Not assessable |
| 7 | Security guards (561612) | 5 | Sampled firm was large |
| 8 | Admin mgmt consulting (541611) | 5 | Large primes dominate the top |
| 9 | Facilities support (561210) | 4 | Top five are huge DOE/NNSA contracts |
| 10 | Commercial building construction (236220) | 4 | Large awards, bonding |
| 11 | Trucking (484110) | 4 | Small market |
| 12 | Engineering (541330) | 3 | Large-firm dominated |

Barriers are "not confirmed" for all. Top-vendor dollars are all-time totals.

## 3. Most lucrative industries (provisional)

Proxy: contracts expiring in the next 24 months (Mindy `get_expiring_contracts`), and how many are $10M+ lifetime value. Indicative only.

| Rank | Industry (NAICS) | Score | Expiring (24 mo) | $10M+ |
|---|---|---|---|---|
| 1 | R&D phys/eng/life sciences (541715) | 9 | 7,482 | 997 (13.3%) |
| 2 | Computer systems design (541512) | 9 | 3,173 | 863 (27.2%) |
| 3 | Commercial building construction (236220) | 8 | 5,681 | 935 (16.5%) |
| 4 | Engineering services (541330) | 8 | 5,374 | 737 (13.7%) |
| 5 | Admin mgmt consulting (541611) | 7 | 4,873 | 409 (8.4%) |
| 6 | Custom programming (541511) | 7 | 2,620 | 418 (16.0%) |
| 7 | Facilities support (561210) | 7 | 2,699 | 372 (13.8%) |
| 8 | Aircraft manufacturing (336411) | 7 | 1,160 | 336 (29.0%) |
| 9 | Navigation/detection instruments (334511) | 6 | 1,759 | 306 (17.4%) |
| 10 | Other computer-related services (541519) | 6 | 8,121 | 559 (6.9%) |

GSA Schedule trend (Winvale citing GSA, not verified): 541512 $2.51B → $3.17B → $3.37B (FY23–25); 541511 $5.76B → $6.64B; 541519 falling $7.66B → $6.96B. Engineering median ceiling rate $136.80/hr (Mindy `get_pricing_intel`, n=57,715).

## 4. Sweet spot (top 10 on both)
1. **Admin mgmt consulting (541611):** big work, held by large primes. Best entered as a subcontractor.
2. **Facilities support (561210):** many recompetes; target the smaller task orders.
3. **Commercial building construction (236220):** strong dollars; bonding is the hurdle.

Near misses: landscaping and janitorial are the easiest, but they were not assessed for money.

## 5. Conflicts
- DoD set-aside share: the goals table shows 3.4% but the tool's summary line shows 5%. Both are shown. Recipient SB share (18%) is a different measure.
- Landscaping "5 of 5 small": one of the five has a different primary NAICS, so only 4 are clearly landscapers.

## 6. What we do not know
- Small-business win share, set-aside rate and offers per award, by industry and year.
- Real FY2024–26 dollars by industry. Next step: a BigQuery `awards` aggregate by NAICS × FY (transaction grain).
- Late-payment rates.
- Whether CMMC Phase II is really suspended for small firms.

## Checks (editor)
| Section | Result |
|---|---|
| Pain points | Pass (limited): DoD goaling figures re-checked and matched |
| Easiest | Pass with caveats: 561730, 561720, 541330 counts matched |
| Lucrative | Unverified: the editor had no access to the expiring-contracts or pricing tools |
