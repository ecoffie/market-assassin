# GAO pain-point remaining decision pack — 2026-11-18

**Status:** decision pack only. **Nothing retired. Nothing adopted.** Served `src/data/agency-pain-points.json` stays pinned (SHA-256 `9c5920e5…bbd` per #2146).

**Do not redo #2146.** Archive + pin of the **278** legacy `(Source: GAO)` strings (1993–2000) and the candidate generator already shipped (`7fa8cbcb9`).

## What remains (Eric decisions)

| Decision | Options | Measured impact |
|---|---|---|
| 1. Retire the 278 legacy strings from the served JSON? | keep / retire | Retire → 3,036→2,758 strings; 7 junk keys go to 0 pain points (incl. NASA’s only 2) |
| 2. Adopt net-new cited candidates? | none / High-Risk only / High-Risk+Institute | **51** net-new of **111** accepted candidates (60 already living) |
| 3. Resolve **10** `requires_review` High-Risk mappings? | approve / rewrite agency / drop | Listed below with exact titles + URLs |
| 4. Handle **15** unmapped High-Risk areas? | leave / multi-agency split / government-wide bucket | multi_agency=7, government_wide=8 |
| 5. Kill-switch `merge-agency-intelligence.js --merge`? | **shipped this PR** (skips `gao_high_risk`) | Prevents re-injection of the 278 |
| 6. Update public counts / registry prose? | after data decision | docs still say 3,045 / 307 inconsistently |

Reproduce (read-only):

```bash
npx tsx scripts/painpoints/verify-legacy-gao-set.ts
npx tsx scripts/painpoints/measure-retirement-impact.ts
# candidates already written:
# tasks/painpoints-replacement-candidates-2026-11-17.json
```

## Exact records still gated

### A. Legacy set (already archived; still SERVED)

- **278** strings · content hash `e96fec33…f5f5` · archive `src/data/agency-pain-points-historical-gao-1993-2000.json`
- Dates **1993-10-06 → 2000-09-27**
- Full per-agency retirement impact: `tasks/painpoints-retirement-impact-2026-11-17.md`

### B. Requires-review candidates (10) — not adopted

| Agency | Title | Doc | URL |
|---|---|---|---|
| Small Business Administration | Emergency Loans for Small Businesses | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970306 |
| Department of the Treasury | Enforcement of Tax Laws | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970318 |
| Department of Transportation | Funding the Nation's Surface Transportation System | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970299 |
| Department of the Interior | Management of Federal Oil and Gas Resources | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970324 |
| Department of Health and Human Services | Medicare Program & Improper Payments | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970326 |
| Department of Homeland Security | National Flood Insurance Program | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970309 |
| Department of Health and Human Services | Protecting Public Health through Enhanced Oversight of Medical Products | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970329 |
| Department of Justice | Strengthening Management of the Federal Prison System | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970301 |
| Department of Health and Human Services | Strengthening Medicaid Program Integrity | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970333 |
| Department of Labor | Unemployment Insurance System | GAO-25-107743 | https://files.gao.gov/reports/GAO-25-107743/index.html#_Toc190970302 |

Full candidate objects: `tasks/painpoints-replacement-candidates-2026-11-17.json` (`requires_review` / `review` flags).

### C. Unmapped High-Risk areas (15) — no agency key

Improving the Delivery of Federal Disaster Assistance · Ensuring the Cybersecurity of the Nation · Government-wide Personnel Security Clearance Process · Improving and Modernizing Federal Disability Programs · Improving Federal Management of Programs that Serve Tribes and Their Members · Improving Federal Oversight of Food Safety · Improving IT Acquisitions and Management · Limiting the Federal Government's Fiscal Exposure by Better Managing Climate Change Risks · Managing Federal Real Property · Modernizing the U.S. Financial Regulatory System · National Efforts to Prevent, Respond to, and Recover from Drug Misuse · Protecting Technologies Critical to U.S. National Security Interests · Resolving the Federal Role in Housing Finance · Strategic Human Capital Management · U.S. Government's Environmental Liability.

### D. Clear to adopt without review (if Eric chooses adopt)

- High-Risk mapped without review: **12** (22 mapped − 10 review)
- Institute GAO net-new already accepted by guards: **29** (of 89 institute accepted; 60 already living across origins)
- Net-new total if all non-review accepted land: **~41** (51 net-new − 10 review) — confirm against JSON before write

## Rollback

| Action | Rollback |
|---|---|
| Retire 278 from served JSON | Restore from git / re-copy from `agency-pain-points-historical-gao-1993-2000.json` + pin test |
| Adopt candidates into JSON or `agency_painpoints_db` | Revert the JSON/DB commit; pin test fails if legacy set drifts |
| Accidental `--merge` before this PR’s guard | Diff against pin hash; refuse merge of `gao_high_risk` (now code-enforced) |

## Code hardening in this branch

`scripts/merge-agency-intelligence.js` **skips** `intelligence_type === 'gao_high_risk'` and **exits 1 on `--merge`** if any converted pain point still ends with `(Source: GAO)`.
