# PRD — Government Market Research (Mindy for the Buyer Side)

**Status:** v1.1 candidate. **Partly built already** — see live surfaces below.
**Owner framing (Eric):** "Government is *required* to do market research. Mindy is
the third alternative — digest their requirement and produce what they need."

> **READ FIRST:** `docs/gov-mrr-template-reference.md` — the authoritative mapping of
> the real DoD **Market Research Report (MRR) Template (MAY 2026)** to Mindy's
> coverage. This PRD is scoped to that doc, not the abstract GAO model.

---

## 1. The honest scope (this is the whole game)

**Mindy does NOT produce a full MRR.** A complete MRR is ~16 sections + signatures;
most are CO-authored narrative, RFA/commerciality determinations, or CAC signatures
that we must **never auto-generate.**

**Mindy automates the one slice the CO can't easily do themselves: the
performer-weighted small-business market depth** — §11 (Potential Suppliers),
§12 (Small Business Opportunities), and partial §14–16 (techniques, industry
analysis, conclusions). That's **~15–20% of the MRR by section count, but the
highest-friction slice by CO pain** — because SAM's SBS gives a raw *registration*
count, while Mindy gives **performer-weighted depth** (who's actually *winning* work
in this market, the real Rule-of-Two picture).

This is the "third alternative": faster than manual, cheaper than a consultant, and
the part SBS structurally can't answer.

---

## 2. What already exists (LIVE — do not rebuild)

| Surface | Path |
|---|---|
| Buyer UI | `src/app/agency/page.tsx` (`/agency`) |
| Research API | `src/app/api/gov-buyer/market-research/route.ts` |
| Export memo | `src/app/api/gov-buyer/market-research/export/route.ts` |
| Rubric engine | `src/lib/gov-buyer/market-research.ts` |

So this is **enhancement of a live feature**, not a new build. The PRD is about
*deepening the slice* and *wiring more MRR sections into the export*.

---

## 3. The new ask (Eric, June 2026): ingest the gov's PDF

Today the CO drives the tool by inputs. **The new capability:** let the CO **upload
their draft requirement / SOW / RFI PDF**, and Mindy auto-extracts the §5 taxonomy
(NAICS/PSC) + scope to **pre-fill the research** instead of manual entry — then runs
the existing rubric. This is the "digest their report" piece.

Reuse (all built): `src/lib/sam/pdf-extract.ts`, `src/lib/sam/sow-detect.ts`,
`src/lib/market/profile-from-text.ts` (extract industry/PSC/NAICS), `keyword-coverage.ts`.

---

## 4. Coverage map → build priorities (from the reference doc)

| MRR § | Today | v1.1 target | Notes |
|---|---|---|---|
| **§5** Taxonomy (NAICS/PSC/size) | Partial | **PDF-ingest auto-fill** + size-standard lookup | The new "digest the PDF" entry point |
| **§9** Procurement History | Data exists, not wired | **Wire `recompete_opportunities`/USASpending into the export** | Real prior-buy history |
| **§11** Potential Suppliers | Partial | **Deepen: performer-weighted vendor table** (BQ recipients, not raw SAM reg) | The moat — depth SBS lacks |
| **§12** Small Business Opportunities | Partial | **Rule-of-Two + tier breakdown + set-aside feasibility, hardened** | Highest CO pain |
| **§14** Techniques Used | Partial | **Add a technique checklist** (SAM searches, Sources Sought, DB searches cited) | Cheap, completes the section |
| **§15** Industry Analysis | Partial (SB footprint) | small-business footprint only; commerciality/pricing stays CO | Don't overreach |
| **§16** Conclusions | Partial | **Set-aside / Rule-of-Two finding**, grounded | Derived from §11–12 |
| §4 IGE, §10 rationale, §13 mandatory sources, §15b commerciality, Part 4 sigs, RFA, FAR Part 12 | Manual / Out of scope | **Leave alone — never auto-generate** | Legal/CO-only |

**Non-negotiable:** every vendor count, $ figure, Rule-of-Two number traces to real
USASpending/SAM/BQ data — never an LLM guess. And we **never fabricate**
determinations, signatures, POCs, or RFA justifications (the reference doc flags
each "never auto-generate"). Honesty IS the product here — a CO files this in a
contract record.

---

## 5. Build phases (enhancement, not greenfield)
1. **PDF ingest → §5 auto-fill** — upload draft requirement → extract NAICS/PSC/scope
   → pre-fill the existing `/agency` research (reuse pdf-extract + profile-from-text).
2. **Deepen §11–12** — performer-weighted supplier depth + hardened Rule-of-Two.
3. **Wire §9 + §14 into the export** — procurement history + technique checklist.
4. **§16 conclusion** — grounded set-aside feasibility statement.
5. **Export polish** — the memo matches the real MRR section numbering so a CO can
   paste Mindy's slice straight into their template.

## 6. Success criteria
- [ ] CO uploads a draft requirement PDF → §5 taxonomy auto-fills correctly.
- [ ] §11 shows performer-weighted vendors (winning work), not raw registrations;
      §12 Rule-of-Two is defensible against the source data.
- [ ] Export memo maps to real MRR section numbers (§9/§11/§12/§14/§16); CO can drop
      it into their template.
- [ ] Every figure traces to USASpending/SAM/BQ; ZERO auto-generated determinations,
      signatures, POCs, or RFA language.
- [ ] Out-of-scope sections clearly labeled "(CO completes)" — Mindy never pretends
      to do the whole MRR.

## 7. Positioning
"Government is required to do market research. The small-business market-depth part —
who's *actually* performing this work, is a set-aside viable — is the hardest piece
and the one SBS can't answer. Mindy does that slice, grounded in real award data,
and hands the CO a memo that drops into their MRR. The third alternative to manual
or a consultant." Honest about scope = credible to a CO.

*Grounding: `docs/gov-mrr-template-reference.md` (the real MAY-2026 template map),
`docs/PRD-gov-buyer-market-research.md`, `docs/govcon-market-research.md` (GAO/FAR,
seller-side).*
