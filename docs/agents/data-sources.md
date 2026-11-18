# Data sources: SAM, awards, agency hierarchy

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## SAM.gov API Integration

**Reference:** [`docs/sam-apis.md`](./docs/sam-apis.md)

### API Status (April 5, 2026)

| API | Status | Source | System Account Required |
|-----|--------|--------|------------------------|
| Opportunities | ✅ Working | SAM.gov | No |
| Entity Management | ✅ Working | SAM.gov | No |
| Federal Hierarchy | ✅ Working | SAM.gov | No |
| Contract Awards | ✅ Working | **USASpending MCP** | No |
| Subaward | ⏳ Waiting | SAM.gov | Yes |

**Note:** USASpending MCP fixed April 5, 2026 (added required `award_type_codes` filter).

---

## Award Intelligence + Office Rosters (June 8, 2026)

The USASpending **award-detail spine** — built once, woven through every surface
that shows an award/incumbent/recompete. Core principle: award detail only on
AWARDS; incumbent intel on OPEN opps (don't put the wrong data in the wrong place).

| Layer | File / route | What it returns |
|-------|--------------|-----------------|
| **Award detail (foundation)** | `src/lib/usaspending/award-detail.ts` + `GET /api/app/award-detail?id=<generated_internal_id>` OR `?piid=<PIID>` | obligated→**ceiling** (base_and_all_options_value), parent IDV/vehicle, period of performance, recipient (city/state/CD), NAICS/PSC, funding account. `resolvePiidToId()` resolves a raw PIID (USASpending forbids mixing contract+IDV type groups → tries each). |
| **Predecessor / incumbent** | `src/lib/usaspending/find-predecessor.ts` + `GET /api/app/incumbent?naics=&agency=&title=` | Likely incumbent (largest recent matching award) → name, ceiling, expiry, vehicle, confidence. Best-match inference, honest "not found" miss. |
| **Reusable UI** | `src/components/app/awards/AwardDetailDrawer.tsx` (awards) + `IncumbentIntel.tsx` (open opps, on-demand "▸ Who holds this now?") | One component each, dropped everywhere. |

**Wired into:** task-order/subcontracting rows (RecompetesPanel), Expiring Contracts
detail, Bid/No-Bid grounding (`/api/analyst/bid-no-bid`), My Pursuits drawer,
Today's Intel Review Fit.

**Key gotcha:** idv-search must read `generated_internal_id` (NOT
`generated_unique_award_id`, which is null) — that's the id the award API needs +
the `/award/` deep link.

### Office contact rosters (#16)

`GET /api/app/federal-contacts?facets=office-roster&agency=<name>` → buying offices
with a COMPLETE roster (3+ people); `&office=<name>` → that office's full people
list. Built off **DoDAAC-decoded** offices (clean DOMESTIC — DLA Aviation=42,
NAVSUP=41), NOT the raw `office` column (embassy-contaminated). Foreign-filtered.
**Scope: DoD/DLA/Navy only** (DoDAAC path, 917/1000 decode); civilian = agency
preview. UI: Decision Makers "📇 Full contact rosters by buying office". Agency
matched by keyword ("DEFENSE, DEPARTMENT OF" not "Department of Defense").

### Office contacts anchored on DoDAAC prefix (June 29, 2026)

A target's saved `office_code` (a real 6-char DoDAAC like `W912PL`) is threaded
from the Target List card (`MyTargetListPanel.tsx` → `TargetContacts`) into
`GET /api/app/federal-contacts` as a `dodaac` param. When valid
(`/^[A-Z][A-Z0-9]{5}$/`) the route filters `solicitation_number ILIKE '<DODAAC>%'`
and **skips** both the `office` ILIKE and the sub-agency narrowing.
**Why:** SAM POC rows have a NULL `office` column, so the hard office filter
EXCLUDED the office's own people → a USACE district card fell back to dept-wide
DoD (`osd.osbp@mail.mil`). The solicitation prefix is the reliable office key.
Verified live on prod: W912PL (LA District) → 11 `@usace.army.mil` engineers,
W912BV (Tulsa) → 15; without the param the same card returns 0 + narrowedToParent.
(The OSBP small-business contact still prepends by design.)

### DoD office anchoring — events count + open_opp_count backfill (June 29, 2026)

Two more surfaces brought in line with the contacts/opp DoDAAC anchoring:
- **TMR events count** (`target-market-research/route.ts`): was bucketed by
  department-level `sam_events.agency`, so every DoD office inherited the whole-DoD
  event count. Now also reads `inferred_dodaac` (set by `backfill-event-offices`) and,
  for office-anchored agencies, counts only events on that office's DoDAACs.
- **`user_target_list.open_opp_count`** is a CLIENT SNAPSHOT frozen at save time, so
  saved cards kept the old inflated dept-wide number. `/api/admin/backfill-target-opp-counts`
  (GET=preview, POST?mode=execute, daily cron `0 14 * * *`) recomputes ONLY
  office-anchored targets (valid 6-char `office_code` → opps by `solicitation_number`
  prefix). Dept-level / junk-code rows are deliberately LEFT UNTOUCHED — a dept-wide
  fallback would re-inflate (a "Dept of Defense" card jumping to 8,000+ is the bug, not
  the fix). Shared `normalizeAgencyKey` + `isValidDodaac` live in
  `src/lib/gov-contacts/agency-key.ts`. Executed live: W912BV 410→5, W912PL 410→9.

### LLM cost discipline

`callLLM({ job: 'reasoning' })` → **gpt-4o-mini first** (Claude not scalable at
$149/mo), groq70b → claude fallback. Per-user $15/mo budget cap
(`src/lib/llm/usage-cost.ts`), dashboard `GET /api/admin/llm-cost`.

### Quarterly data refresh (honest, no auto-fake)

`GET /api/cron/check-data-freshness` (dispatcher cron_jobs row, quarterly
`0 13 1 1,4,7,10 *`). Curated sources (SBLO scrape, DoD/OSBP dir, pain points) are
HUMAN-run scrapers — never auto-stamp (fakes freshness). When overdue → **emails
the refresh checklist**; `?stamp=<key>` records the real refresh after you run the
script. Registry: `docs/DATA-SOURCES-REGISTRY.md`, view `/api/admin/data-sources`.

---

## Agency Hierarchy API v2 (Moat 7)

**Reference:** [`docs/agency-hierarchy-api.md`](./docs/agency-hierarchy-api.md)

Unified federal agency intelligence combining SAM.gov, pain points, contractors, and spending data. Inspired by Tango by MakeGov, enhanced with GovCon-specific intel.

### Quick Examples

```bash
# Search by abbreviation
curl "https://getmindy.ai/api/agency-hierarchy?search=VA"

# CGAC code lookup
curl "https://getmindy.ai/api/agency-hierarchy?cgac=069"

# Get spending data
curl "https://getmindy.ai/api/agency-hierarchy?mode=spending&agency=DOD"

# Find buying offices for NAICS
curl "https://getmindy.ai/api/agency-hierarchy?naics=541512&mode=buying"

# Service stats
curl "https://getmindy.ai/api/agency-hierarchy?mode=stats"
```

### Data Sources

| Source | Contents |
|--------|----------|
| SAM.gov Federal Hierarchy | Official org structure |
| Pain Points Database | 250 agencies, 2,765 pain points |
| Contractor Database | 2,768 contractors with SBLO contacts |
| Agency Aliases | 450+ abbreviation mappings |
| USASpending.gov | Spending aggregations |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/agency-hierarchy/index.ts` | Unified exports |
| `src/lib/agency-hierarchy/unified-search.ts` | Main search service |
| `src/lib/agency-hierarchy/pain-points-linker.ts` | Pain points matching |
| `src/lib/agency-hierarchy/spending-stats.ts` | USASpending integration |
| `src/data/agency-aliases.json` | Abbreviation mappings |
| `src/data/agency-pain-points.json` | Pain points database |
| `src/app/api/agency-hierarchy/route.ts` | API endpoint |

### Test Script

```bash
./tests/test-agency-hierarchy.sh local  # Test local dev
./tests/test-agency-hierarchy.sh prod   # Test production
```

### Test Endpoints

```bash
# Test Contract Awards (uses USASpending)
curl "https://getmindy.ai/api/admin/test-sam-awards?password=$ADMIN_PASSWORD&naics=541512"

# Test USASpending directly
curl "https://getmindy.ai/api/admin/test-usaspending?password=$ADMIN_PASSWORD&naics=541512"

# Test Entity Lookup
curl "https://getmindy.ai/api/admin/test-sam-entity?password=$ADMIN_PASSWORD&name=Booz"

# Test Hierarchy
curl "https://getmindy.ai/api/admin/test-sam-hierarchy?password=$ADMIN_PASSWORD&agency=VA"

# Test Subaward (blocked until System Account)
curl "https://getmindy.ai/api/admin/test-sam-subaward?password=$ADMIN_PASSWORD&prime_uei=XXX"
```

---
