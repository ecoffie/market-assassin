# Federal Market Snapshot — Lead Magnet Spec

**Purpose:** One-page industry artifact for association sales calls — maps "competition spending report" language to shipped product.  
**Audience:** Association EVP before 60-day eval  
**Status:** Spec complete — PDF export is Phase 2 product work

---

## User language → product mapping

There is no file named "competition spending report." Sales and marketing should use this mapping:

| What prospects say | Mindy surface | Code / route |
|--------------------|---------------|--------------|
| Competition spending | **Market Analytics** — agency spend, trends, set-aside mix | `MarketResearchPanel` → `simplifiedAcquisition` |
| Where small firms win | **Entry Accessibility** — SAT ($350K) + micro ($15K) counts | `EntryAccessibilityCard` |
| Low-competition targets | **Similar Awards** + bid-count tiers | `usaspending-fallback.ts` → `competitionLevel` |
| Qualification / process gap | **Market Map** + daily alerts + set-aside profile | Onboarding + `/api/app/opportunities` |

---

## Federal Market Snapshot (deliverable)

**Format:** 1-page PDF or live demo screen (15 min sales call)  
**Inputs:** Industry NAICS cluster (or keyword), member state, optional certification (SDVOSB, WOSB, etc.)  
**Generation:** Manual demo today; automated export Phase 2

### Section 1 — Market size (competition spending)

| Field | Source |
|-------|--------|
| Total federal spend in NAICS (last 3 FY) | `POST /api/app/target-market-research` |
| Set-aside vs unrestricted split | Market Analytics / agency spending |
| Top 5 awarding agencies | `target-market-research` rows or agency lookup |
| Geographic concentration | Member state vs national |

### Section 2 — Entry accessibility (where to start)

| Field | Source |
|-------|--------|
| SAT contract count (<$350K) | `SimplifiedAcquisitionReport.summary.totalSATContracts` |
| SAT spend total | `totalSATSpending` |
| Micro-purchase count (<$15K) | `totalMicroContracts` |
| Top 3 "SAT-friendly" agencies | `agencies[]` sorted by `satFriendlinessScore` |
| One-line insight | e.g. "42% of awards in your NAICS are under simplified acquisition — faster, less paperwork" |

### Section 3 — Qualification gap (hidden loss)

| Field | Source |
|-------|--------|
| Set-aside opps posted (90 days) in NAICS | Opportunity search filtered by cert |
| Sample: full-and-open avg bidders | `competitionLevel: high` awards |
| Sample: set-aside avg bidders | `competitionLevel: low` awards |
| Narrative | Case study Example 2 — set-aside blindness |

### Section 4 — What acquired rights unlock

| For members | For association |
|-------------|-----------------|
| Daily alerts in this market | Coach dashboard — see who pursued what |
| Market Map pre-loaded for trade | Quarterly scorecard with §1–§3 metrics |
| Teaming search | "Included with membership" marketing |

### Section 5 — CTA

> **60-day director eval** — run your first 20 member firms through Mindy at no cost. We generate this snapshot for your industry at onboarding.

---

## Demo script (live — no PDF required)

1. Open Market Research → enter association's **primary NAICS** (e.g. 236220 for GC, 332XXX for manufacturing)
2. Show **Market Map** — total market banner if keyword mode
3. Open **Entry Accessibility** card — SAT/micro counts
4. Filter opportunities by member **set-aside** (SDVOSB, WOSB, small business)
5. Show 1 **Similar Award** with `competitionLevel: low`
6. Close: *"Your members don't need another subscription — you acquire rights and we prove this quarterly."*

---

## Industry presets (seed NAICS for vertical associations)

| Association type | Primary NAICS | Keyword fallback |
|------------------|---------------|------------------|
| General contractors (AGC, ABC) | 236220, 237310, 238210 | "construction services" |
| Electrical (NECA) | 238210 | "electrical construction" |
| Manufacturing (WMA, NAM) | 332, 333, 334 (narrow on call) | Member's product keyword |
| Professional services (ACEC) | 541330, 541512 | "engineering services" |

Use keyword-first coverage when single NAICS under-represents market ([`CLAUDE.md`](../../CLAUDE.md) keyword-first rule).

---

## Phase 2 product (optional build)

| Task | Effort | Output |
|------|--------|--------|
| `GET /api/app/federal-market-snapshot?naics=&state=&cert=` | Medium | JSON for PDF renderer |
| PDF template (jsPDF or HTML print) | Small | Branded one-pager with association logo slot |
| Batch generate for eval cohort | Small | Zip of per-member snapshots for coach |

**Not blocking** association doc rollout — live demo sufficient for first 2 discovery calls.

---

## API dependencies (existing)

```
POST /api/app/target-market-research
  body: { keyword?, naicsCodes?, states?, businessType? }
  returns: total_market, codes_used, agency rows, simplifiedAcquisition

GET /api/app/opportunities?naics=&setAside=&state=
  returns: cached SAM opps with competition context

Market Research panel — reportKey: simplifiedAcquisition, budget, forecast
```

---

*Last updated: June 28, 2026*
