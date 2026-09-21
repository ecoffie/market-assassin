# Should-Cost Builder + Contractor Certification Filters — V2 Roadmap

**Status:** Deferred from Market Research Phase 1 (May 21, 2026)
**Owner:** TBD

---

## 1. Should-Cost Builder

### The user problem

A BD person sees a $5M opportunity and asks: *"What should this actually cost
to deliver, so I know what to bid?"* Today they Google labor rates, guess at
hours, and hope. Costpoint (Deltek) costs $$$$.

### The proposed feature

A 4-input → 1-output calculator that lives in the **Estimating** sidebar
section (alongside Pricing Intel + Proposal Assist).

```
Inputs:                                Output:
  Labor category × hours × rate          Bid floor:   $2.1M
  Other Direct Costs                     Bid target:  $2.6M
  Indirect rate (overhead/G&A)           Bid ceiling: $3.1M
  Profit margin                          ─────────────────────
                                         12 similar awards: avg $2.4M
                                         You'd win at: 78% confidence
```

### Data sources (already in repo)

| Input | Source | File |
|---|---|---|
| Labor rates | GSA CALC+ API | `src/lib/utils/calc-rates.ts` (already used by Pricing Intel) |
| Similar awards comparison | USASpending API | `src/lib/sam/usaspending-fallback.ts` |
| Standard overhead/G&A defaults | hard-coded by industry | TBD — pull from DCAA tables |

### Why it's deferred

1. **Validate the need first.** Built on the hunch that BD users want this,
   but no direct user request yet. Should ship Phase 2 (Market Map charts)
   first and see if anyone asks for cost help in the wild.
2. **Complex UX.** A 4-input form needs careful design — error states for
   "you forgot to include G&A", warnings for "your rate is 40% below
   market median", etc. Worth doing properly, not as a stub.
3. **3-5 days of build.** Not a one-session feature.

### Skeleton when we build it

- `src/components/app/panels/ShouldCostPanel.tsx` — form + result tiles
- `src/app/api/app/should-cost/route.ts` — POST { categories, hours, ODC, ga, profit } → {bid_floor, target, ceiling, similar_awards}
- New `AppPanel` id `'should-cost'` in `UnifiedSidebar.tsx` under Estimating

---

## 2. Contractor DB certification filter chips

### The user request

> "for Market Research Teaming most of those companies are inside Contractor
> DB tab, same as Tribal maybe you put a filter in Contractors side bar for
> Tribal or SB 8(a)."

Add filter chips to Contractor DB for: **Tribal · 8(a) · SDVOSB · WOSB ·
HUBZone · SB**.

### Why it's deferred

The underlying contractor JSON (`src/data/contractors.json`) has no
certification fields:

```json
{
  "company": "PANTEXAS DETERRENCE LLC",
  "naics": "561210",
  "source": "SBA Prime Directory FY24",
  "contract_count": "1",
  "total_contract_value": "30103600000.0",
  "agencies": "ENERGY, DEPARTMENT OF",
  "has_subcontract_plan": "True",
  ...
}
```

No `set_aside`, `certification`, `business_size`, or anything we could
filter on. The `source` field is data origin (SBA / DHS / DOT directories),
not certification.

Adding chips today would be smoke and mirrors — buttons that don't filter
anything real. Worse than not having them.

### What needs to happen first

**Enrich `contractors.json` with SAM.gov Entity API certifications.**

SAM.gov returns set-aside / certification data per UEI. Process:

1. Loop through every contractor by UEI (the JSON is missing UEI today, so
   step 0 is sourcing UEI for each company — either by SAM Entity name
   search or rebuilding the JSON from a UEI-keyed source).
2. Call `mcp__samgov__search_entities` for each → extract `businessTypes` and
   `certifications` arrays.
3. Write enriched fields back to `contractors.json` (or a new
   `contractor_enrichment.json` keyed by company name).
4. Cache for 30+ days — these don't change often.
5. Update `ContractorSearchOptions` to accept `certifications: string[]`.

**Estimated effort:** 1-2 days of data work + 30 min of UI chip wiring once
data is in place.

### What chips would look like once data exists

```tsx
// In ContractorsPanel.tsx, above results
<div className="flex flex-wrap gap-2 mb-3">
  {CERT_OPTIONS.map(cert => (
    <button
      key={cert}
      onClick={() => toggleCertFilter(cert)}
      className={`px-3 py-1 rounded-full text-xs ${
        selectedCerts.includes(cert)
          ? 'bg-purple-600 text-white'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {cert}
    </button>
  ))}
</div>

const CERT_OPTIONS = ['SB', '8(a)', 'WOSB', 'SDVOSB', 'HUBZone', 'Tribal'];
```

---

## Decision when to build

Build when **either** is true:

- A user explicitly asks for cost calculation or certification filtering in
  user feedback (Slack / email / app feedback)
- We have 50+ Pro subscribers and one of them mentions either feature in
  onboarding calls

Until then, focus on Market Map Phase 2 (Recharts visuals + Mindy narrative
+ PNG/PDF export) which is the bigger differentiator vs. SAM.gov.
