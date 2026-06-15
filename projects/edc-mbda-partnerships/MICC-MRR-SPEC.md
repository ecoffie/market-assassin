# Army MICC — Market Research Report (MRR) Generator Spec

**For:** Army MICC contracting officer (warm contact #3); also feeds Navy OSBP (shared engine)
**Source of truth:** `docs/Market Research Report Template (MAY 2026).pdf` — the OFFICIAL Army MRR
template (post-FAR-Overhaul, RFO/DFARS class deviations eff. 01 Feb 2026). The KO sent this as the
example. We match it exactly.
**Scope (Eric):** auto-fill the DATA sections Mindy has real data for; bracket the CO's judgment
sections. Honest, defensible, exports the official .docx.

---

## What this is (and the relationship to OSBP)

The MRR is the CO's **formal acquisition document** — becomes part of the contract file, supports the
Acquisition Plan + Small Business Plan, used for actions over the SAT. Different doc from what OSBP
produces — but **the OSBP vendor list IS an input to §11/§12 of this MRR.** One engine
(`findCapableSmallBusinesses`, the PSC-scored search) serves both the Navy sourcing tool AND the
Army MRR. That's the product story.

The KO's pain: assembling this by hand takes days (pull prior contracts, find vendors, compute the
market picture, write it up). Mindy turns the data sections into a first draft from a PSC + NAICS.

---

## Section → data mapping (the build)

Mindy auto-fills (REAL data, cited):
| MRR § | Section | Mindy source |
|---|---|---|
| **§5** | Taxonomy: PSC, PSC desc, NAICS, NAICS desc, **size standard** | PSC/NAICS input + `keywordCoverage` + SBA size-standard lookup |
| **§9** | **Procurement History** table: contract #, contractor, type, method, offerors, $, POP | awards table grouped by recipient/PIID for the NAICS/PSC (new lightweight query) |
| **§11** | **Potential Supplier Information** table: vendor, CAGE, **business size**, location, POC, capability | ★ `findCapableSmallBusinesses` (the PSC-scored engine) |
| **§12** | **Small Business Opportunities**: set-aside recommendation (8a/HUBZone/SDVOSB/WOSB) | set-aside signal + small-biz footprint from §11 results |
| **§15** | **Market Intelligence**: # suppliers, market $, small-business footprint, socioeconomic participation, competition level | `keywordCoverage` (market $, supplier count) + §11 aggregates |

Mindy BRACKETS (the CO's judgment — never fake):
- **§4 Independent Government Estimate (IGE)** — the CO's cost estimate. `[INSERT IGE]` + the table skeleton.
- **§1–3** general info (program, POCs, contracting activity) — `[bracketed]` fields.
- **§6–8** requirement description / performance / background — CO writes (it's their requirement).
- **§10 Non-Commercial Rationale, §13 Mandatory Sources, §14 Techniques Used** — CO/compliance.
- **§16 Conclusions** — we can pre-populate a *draft* recommendation from §12, clearly labeled "draft — CO to finalize."
- **Part 4 Signatures + RFA approval pages** — untouched skeleton (digital-signature blocks).

**Honesty rule:** every auto-filled number cites its source (USASpending award data, as-of date).
Bracketed = the CO's input. We never invent an IGE, a commerciality determination, or a signature.

---

## Build

1. **Lightweight procurement-history query** (`src/lib/bigquery/recipients.ts`):
   `procurementHistoryByCode({ psc?, naics?, limit })` → recent awards grouped to rows of
   {contract #/PIID, contractor, contract_type, set_aside/method, obligated $, POP dates}. Reuses
   the awards table (already proven). For §9.
2. **MRR assembler** (`src/lib/micc/mrr.ts`): pulls §5/§9/§11/§12/§15 data in parallel, returns a
   structured MRR object + the bracketed skeleton for the rest.
3. **API** `GET /api/app/micc/mrr?email=&psc=&naics=&title=` → the structured MRR (for on-screen
   preview) ; `POST .../mrr/docx` → the official .docx (reuse the `docx` lib + the template layout).
4. **Panel** `MiccMrrPanel`: PSC + NAICS + requirement title inputs → "Generate MRR draft" →
   on-screen preview of the filled sections (+ bracketed list of what the CO must complete) →
   "Download .docx".
5. Sidebar entry "Market Research Report" (pro-tier, demo surface). AppPanel `micc-mrr`.

---

## Why this lands with a KO

- It's THEIR exact template (MAY 2026, the one they sent) — zero translation.
- It does the tedious, data-heavy 80% (procurement history + supplier table + market picture) and
  hands them a Word doc to finish — not a black box, not a slide.
- It's honest about the 20% only they can do (IGE, commerciality, signatures) — which is what earns
  a CO's trust vs. a tool that pretends to write the whole determination.

## Open items
- [ ] Build the 5 data sections + bracketed skeleton + .docx export
- [ ] SBA size-standard lookup for §5 (table by NAICS) — or bracket if not readily available
- [ ] Confirm with the MICC KO: is the MAY 2026 template the current one they use? any local MICC addenda?
- [ ] Demo: seed a sample PSC+NAICS (e.g. R425 / 541330) so the preview is populated

*Created June 14, 2026. The MRR generator = assemble existing engines (findCapableSmallBusinesses +
procurement history + keywordCoverage) into the official Army MAY-2026 template; auto-fill data
sections, bracket CO judgment, export .docx. Shares the supplier engine with the Navy OSBP tool.*
