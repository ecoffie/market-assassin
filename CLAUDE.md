# Market Assassin - Claude Project Context

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **This is the DEVELOPMENT project.** Deploys to `getmindy.ai`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
3. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL.
4. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
5. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.
6. **SAM.gov API does NOT support comma-separated NAICS codes.** Must make parallel requests for each NAICS code and merge results. See `src/lib/briefings/pipelines/sam-gov.ts`.
7. **FPDS.gov retired Feb 24, 2026.** All federal contract data now flows through SAM.gov APIs. See `docs/sam-apis.md` for full reference.
8. **Always run QA tests before deploying.** Use `npm run deploy` (runs tests first) or `npm run test:pre-deploy`.
9. **Unified notification table:** All alert/briefing code uses `user_notification_settings` (not the old `user_alert_settings` or `user_briefing_profile` tables which were dropped). The `smart-profile` service (`src/lib/smart-profile/`) is **dead code** - its `user_briefing_profile` table was never deployed.
10. **Daily briefings MUST use fast GREEN builder.** `send-briefings-fast` must use `buildSamGreenBriefing()` (instant, no AI), NOT `generateDailyBriefFromSam()` which calls Claude API (~4s/user, causes timeouts). Run `tests/test-briefing-architecture.sh` to verify.
11. **Briefing log MUST include briefing_type in all queries.** The `briefing_log` table has a unique constraint on `(user_email, briefing_date, briefing_type)`. All INSERT/UPDATE/SELECT must filter by `briefing_type` ('daily', 'weekly', 'pursuit') to avoid collisions between briefing types.
12. **Weekly-alerts uses cache-backed batching.** `BATCH_SIZE=75` users per cron run across the Sunday/Monday batch window. It uses the local `sam_opportunities` cache in the hot path, writes `sent`/`skipped`/`failed` rows to `alert_log`, and dedupes by the Sunday cycle `alert_date` plus `alert_type='weekly'`.
13. **Alert and briefing email sends use shared `sendEmail()`.** Resend is primary. Office 365 is fallback only. Do not add route-local Office365-only `nodemailer` transports for weekly alerts, daily alerts, weekly deep dives, or pursuit briefs.
14. **Unified MI Platform Architecture.** All tools live inside `/briefings` as panels switched by sidebar, NOT separate routes. This follows the Atlassian navigation pattern. See "Unified MI Platform Architecture" section below.

---

## Unified MI Platform Architecture (May 2026)

**Decision:** All Market Intelligence tools are panels within `/briefings`, NOT separate routes.

**Pattern:** Atlassian sidebar navigation — sidebar switches content panels, not routes.
- Reference: https://www.atlassian.com/blog/design/designing-atlassians-new-navigation

**Why Sidebar (Not Tabs):**
- Industry standard (Slack, Google, Microsoft, Notion)
- Vertical space for 10+ items
- Bird's-eye view of all tools
- Familiar pattern for SaaS users

### Tier Structure (May 2026) - SIMPLIFIED

| Tier | Price | Includes |
|------|-------|----------|
| **MI Free** | $0 | Market Research (4 reports, 5/mo) + Daily Alerts (simple list) |
| **MI Pro** | $149/mo | **Everything:** Market Research (10 reports, unlimited) + AI Briefings + Forecasts + Pipeline + CRM + FHC Training |

**Public-facing = 2 tiers only: Free → Pro**

No decision fatigue. Clear upgrade path.

**MI Free Features:**
- Market Research (4 Standard reports: Analytics, Budget Authority, Gov Buyers, OSBP Contacts)
- 5 reports per month cap
- Daily Alerts (simple opportunity list, no AI analysis)
- Profile setup + NAICS preferences

**MI Pro Features ($149/mo):**
- Market Research (all 10 reports, unlimited usage)
- AI Briefings (Daily + Weekly + Pursuit)
- 7,700+ Forecasts
- Pipeline Tracker + Teaming CRM
- Content Reaper (AI LinkedIn posts)
- FHC Training access

**Grandfathered Users (internal tracking only):**
- OH Pro ($49 one-time) → Keep OH Pro features forever
- Briefings ($49/mo) → Keep at $49/mo, get AI briefings (no full tools)
- Alert Pro ($19/mo) → Cancel, migrate to MI Free
- Tool bundles (Starter/Pro Giant/Ultimate) → Lifetime MI Pro access

**Pricing Notes (May 5, 2026):**
- Public page shows **Free vs $149/mo Pro only**
- $49/mo exists but NOT promoted (loyalty/grandfather only)
- $149/mo includes FHC training (replaces separate $99/mo product)

**Domain Structure (May 20, 2026):**
- `govcongiants.com` → Marketing/SEO (govcon-funnels)
- `getmindy.ai` → **Primary SaaS app** — Mindy. Hosted by the market-assassin Vercel project via host-based rewrites in `next.config.ts`. New users sign up here.
- `mi.govcongiants.com` → SaaS app, legacy domain, same code as `getmindy.ai`. Kept for in-flight users and email links; do not promote.
- `auth.getmindy.ai` → Supabase custom domain for OAuth. Google + Microsoft consent screens show "Sign in to auth.getmindy.ai" instead of the raw Supabase project subdomain.
- `shop.govcongiants.com` → KILLED (redirect to /pricing)
- See `docs/strategy/DOMAIN-BRAND-CONSOLIDATION.md` for full plan
- Custom-domain cutover runbook (Supabase + DNS + Google + Azure): `tasks/oauth-branding-runbook.md`

**Folder structure (May 20, 2026):**
- `src/app/app/` — the `/app` user surface (renamed from `mi-beta/`, commit `cbadcac`). Contains onboarding, signup, sign-in, password flows.
- `src/app/api/app/` — API routes consumed by `/app` (renamed from `api/mi-beta/`).
- `src/components/app/` — `/app` UI components including all `panels/*.tsx`.
- `src/lib/app/workspace.ts` — workspace utilities (renamed from `lib/mi-beta/`).
- Old `mi-beta` paths no longer exist in the codebase.

### MITier Type

```typescript
// src/components/UnifiedSidebar.tsx
export type MITier = 'free' | 'pro';  // Simplified: only 2 public tiers

const tierInfo: Record<MITier, { name: string; price: string; color: string }> = {
  free: { name: 'MI Free', price: '$0', color: 'gray' },
  pro: { name: 'MI Pro', price: '$149/mo', color: 'emerald' },
};

function hasProAccess(userTier: MITier): boolean {
  return userTier === 'pro';
}
```

**Internal tracking** (for grandfathered users, not in UI):
- `legacy_briefings` = $49/mo briefings subscribers (AI briefings only)
- `legacy_oh_pro` = $49 one-time OH Pro buyers (agency search only)
- `legacy_bundle` = Tool bundle buyers (full MI Pro)

### MIPanel Type

```typescript
// src/components/UnifiedSidebar.tsx
export type MIPanel =
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit (Pro only)
  | 'alerts'         // Daily Alerts - simple list (Free), AI analysis (Pro)
  | 'research'       // Market Research - 4 reports free, 10 Pro (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // 3,500+ with contacts
  | 'pipeline'       // Track pursuits (Pro tier)
  | 'contacts'       // CRM & relationships (Pro tier)
  | 'content'        // Content Reaper
  | 'planner'        // Action Planner
  | 'sbir'           // SBIR/STTR
  | 'grants';        // Federal grants
```

### Navigation Sections by Tier

| Section | MI Free ($0) | MI Pro ($149/mo) |
|---------|--------------|------------------|
| **Market Research** | 4 reports, 5/mo cap | All 10 reports, unlimited |
| **Daily Alerts** | Simple list (no AI) | ✅ |
| **AI Briefings** | ❌ | Daily + Weekly + Pursuit |
| **Forecasts** | ❌ | 7,700+ |
| **SBIR/STTR** | ❌ | ✅ |
| **Grants** | ❌ | ✅ |
| **Pipeline** | ❌ | ✅ |
| **CRM/Contacts** | ❌ | ✅ |
| **Content Reaper** | ❌ | ✅ |
| **FHC Training** | ❌ | ✅ |

### Key Files

| File | Purpose |
|------|---------|
| `src/components/UnifiedSidebar.tsx` | Sidebar with tier-based access control |
| `src/app/briefings/page.tsx` | Main dashboard with panel conditional rendering |
| `src/components/bd-assist/PipelineBoard.tsx` | Pipeline panel component |
| `src/components/bd-assist/ContactsPanel.tsx` | Contacts panel component |
| `src/components/bd-assist/ForecastsPanel.tsx` | Forecasts panel component |
| `src/components/briefings/SbirPanel.tsx` | SBIR/STTR panel component |
| `src/components/briefings/GrantsPanel.tsx` | Grants panel component |

### Implementation Pattern

```tsx
// In /briefings/page.tsx
const [activePanel, setActivePanel] = useState<MIPanel>('dashboard');

return (
  <div className="flex">
    <UnifiedSidebar
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      userTier="pro" // Determines feature access
    />
    <main>
      {activePanel === 'dashboard' && <DashboardContent />}
      {activePanel === 'pipeline' && <PipelineBoard email={email} />}
      {activePanel === 'contacts' && <ContactsPanel email={email} />}
      {/* ... other panels */}
    </main>
  </div>
);
```

### DO NOT

- Create separate routes for tools (e.g., `/pipeline`, `/contacts`)
- Use href links in sidebar — use onClick with panel state
- Add tools outside `/briefings` — all tools are panels within MI
- Allow access to tier-restricted features without proper userTier check

---

## Pre-Deploy QA

**ALWAYS run before deployment:**

```bash
# Safe deploy (runs tests first, blocks on failure)
npm run deploy

# Or run tests manually
npm run test:pre-deploy
```

**What it checks:**
- TypeScript compilation
- SAM.gov date format (MM/dd/yyyy not YYYY-MM-DD)
- Critical API endpoints
- Daily Alerts pipeline
- Market Intelligence pipeline
- Access control rules
- Environment variables

**Test files:** `tests/test-pre-deploy.sh`, `tests/run-all-tests.sh`

---

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

## Keyword-first market research (June 8, 2026)

**The principle (Eric):** NAICS is the WRONG primary key. A product like "drones"
sprawls across **70+ NAICS codes** ($243M FY2025); the single obvious code (336411
Aircraft Mfg) is only **28%** → searching it alone MISSES 72% of the market. Worse,
336411 is BOTH over-broad (all aircraft) AND incomplete. So: **keyword is the
discovery key; NAICS is auto-derived invisibly** (its real job is set-aside SIZE
eligibility, not discovery). User never manages 70 codes.

**The 3-axis model** (memory: `naics-vs-psc-search`):
- **Keyword** = discovery (what's this about — most complete + precise; matches the
  contract text)
- **PSC** = what was BOUGHT (1550 "Unmanned Aircraft" — the literal product; the
  GovCon-pro insight is PSC > NAICS for search accuracy)
- **NAICS** = who the SELLER is + size/set-aside eligibility (the qualification axis)

**Implementation:**
- `src/lib/market/keyword-coverage.ts` — `keywordCoverage(keyword)` → total market
  $, all buying NAICS ranked, the smallest set covering ~90%, + top PSC ("what was
  bought"). **Phrase-resilient**: USASpending keyword search is EXACT-PHRASE, so it
  tries candidates most→least specific (full phrase → significant words, stopwords
  stripped) — otherwise sentences silently fall to the LLM.
- `target-market-research` accepts `keyword`; auto-derives the 90%-coverage NAICS
  set, returns `keyword_coverage` (total_market, naics_count, codes_used,
  coverage_pct, top_psc) for the lesson banner.
- `src/components/app/market/MarketCoverageBanner.tsx` — teaches the lesson
  ("drones = $243M across 70+ codes; obvious code = 28% → miss 72%; PSC = Unmanned
  Aircraft"). Renders only for keyword research.
- **Sport Mode**: keyword build applies the FULL coverage set (~8 codes), not top-3.
- **Onboarding** (`src/app/app/onboarding/page.tsx`): the describe-your-business
  step now grounds day-1 codes via `/api/suggest-codes` (full coverage), NOT the old
  hardcoded 3-per-industry map that broke new users' alerts by missing 72%.
- `suggest-codes` `groundCodesFromUsaspending` has the SAME phrase-candidate
  fallback (onboarding sends sentences).

**Gotcha:** USASpending keyword = exact phrase. Always reduce phrases to candidate
terms or you ground nothing → LLM fallback (defeats the whole point).

---

### Market Map data sources & caching (memory: `mindy-market-map-tmr-cache`)

The Market Research panel (`/app?panel=research`, `MarketResearchPanel.tsx`) has **two
data paths that can disagree**:

- **FPDS Leaderboards** (Top 10 Departments / Contracting Agencies / Vendors) →
  live `spending_by_category` via `/api/usaspending/fpds-top-n`. Not cached at that
  layer → always current & correct.
- **Stat cards** ("Relevant spending", "Agencies to review") → `/api/app/target-market-research`
  (TMR), **cached 24h in Supabase `agency_target_data_cache`**, rolled up as
  `rollupChartBuyers` = group rows by `subAgency||parentAgency||name`, take MAX `metric_top_total`.

**The "Spending by Agency" BAR CHART was REMOVED (PR #245, Jul 15 2026)** — its TMR-sourced
agency totals could not be reconciled with the FPDS leaderboards, so it read as "numbers don't
match." The FPDS leaderboards are now the sole agency-spend surface; the Small Business Mix donut
(Auto mode) and the TMR stat cards remain. (`SpendingByAgencyChart` component + its recharts
`BarChart`/`Bar`/`XAxis`/`YAxis` imports are gone from `MarketResearchPanel.tsx`.) The
TMR-vs-FPDS reconciliation notes below still apply to the surviving **stat cards**.

**When the stat cards disagree with FPDS, it's a STALE TMR cache, not a live bug.** (Jul 2026:
236220 showed Dept of State #1 at $13.5B — its all-NAICS total leaking via an old
broadened-sample fallback — vs its true $2.9B; $45.1B headline vs the real $94.4B.
The compute was already correct; the row was a pre-fix cache entry.)

**Fix lever = bump `SPEND_SCHEMA_VERSION`** in `src/app/api/app/target-market-research/route.ts`
(~line 436). The cache key embeds it (`${cacheToken}${stateSuffix}|${SPEND_SCHEMA_VERSION}`),
so bumping **orphans every entry fleet-wide** → next access recomputes with current code,
then re-caches 24h. **Now at `sv8`** (bumped sv7→sv8 in #235, Jul 15 2026); each bump is
documented inline.

**Ground truth for verification:** USASpending `spending_by_category` with
`award_type_codes:['A','B','C','D']` (contracts only), **exact** 6-digit NAICS
(`expandNAICSCodes(codes, false)` — do NOT sweep the 3-digit subsector), and the
canonical 3-FY `MARKET_SPEND_WINDOW`. `fpds-top-n`, `find-agencies`, and TMR all share
this filter so their dollars reconcile.

**Verify TMR live WITHOUT a browser** (data-level; the app UI is Pro-login-gated):
```bash
curl -s -X POST https://getmindy.ai/api/app/target-market-research \
  -H 'Content-Type: application/json' \
  -d '{"naicsCode":"236220","email":"eric@govcongiants.com","businessType":"","veteranStatus":"Not Applicable"}'
```
`eric@govcongiants.com` is staff → append `"refresh":true` to **bypass the cache** for a
fresh compute. The cache key also splits on `business_type` + `veteran_status` + states,
so the form default `veteranStatus:'Not Applicable'` is a **different key** than an
omitted one. Response: `agencies[]` (each with `metric_top_total`), `relevant_spending`,
`cached`.

---

### Rate Limits & Caching

- **Standard tier:** 1,000 requests/day, 10/min
- **Cache TTL:** 24h for awards/entity, 1h for opportunities
- **Cache table:** `sam_api_cache` in Supabase
- **Fallback:** USASpending API (primary for Contract Awards)

### Key Rules

1. **No comma-separated NAICS** — make parallel requests
2. **Always cache responses** — 24h TTL minimum
3. **USASpending is primary for Contract Awards** — has bid count data
4. **Use MCP tools when available** — `mcp__samgov__*` for opportunities

### Env Variables

```env
SAM_API_KEY=xxx                    # Opportunities (existing)
SAM_CONTRACT_AWARDS_API_KEY=xxx    # Needs System Account
SAM_ENTITY_API_KEY=xxx             # Same as SAM_API_KEY
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/sam/utils.ts` | Shared rate limit, cache, error handling |
| `src/lib/sam/contract-awards.ts` | Contract Awards wrapper (uses USASpending) |
| `src/lib/sam/usaspending-fallback.ts` | USASpending API for bid counts |
| `src/lib/sam/entity-api.ts` | Entity Management API wrapper |
| `src/lib/sam/subaward-api.ts` | Subaward Reporting API wrapper |
| `src/lib/sam/federal-hierarchy.ts` | Federal Hierarchy API wrapper |
| `src/lib/sam/index.ts` | Unified exports |

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

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Session History:** See [`MEMORY.md`](./MEMORY.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `getmindy.ai` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.com` | Marketing site |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Linkedin App` | `linkedin-deal-magnet.vercel.app` | Profile optimizer (separate product) |

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`
**Purpose:** Market intelligence — 5 inputs + agency selection → 4-8 strategic reports
**Tiers:** Standard ($297, 4 reports) | Premium ($497, 8 reports)
**Key Files:** `market-assassin/page.tsx`, `api/reports/generate-all/route.ts`

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `public/content-generator/`
**Purpose:** AI LinkedIn post generator — up to 30 posts/click, 250 agencies, bulk .docx/.zip export
**Tiers:** Content Engine ($197) | Full Fix ($397)
**Key Files:** `public/content-generator/index.html`, `api/content-generator/generate/route.ts`

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** 3,500+ federal contractors with SBLO contacts, filtering, export
**Price:** $497

### 4. Recompete Tracker
**Location:** `/public/recompete.html`
**Purpose:** Track expiring federal contracts for recompete opportunities
**Price:** $397
**Features:** Pagination, CSV/Excel/PDF export, location filtering, mobile responsive

**Vehicle rollup — truthful global count (`src/app/api/recompete/route.ts`, Jun 29):**
Multiple-award IDIQs store N winner rows; we collapse them to ONE vehicle via
`recompeteVehicleKey` (IDV root + agency + NAICS — `src/lib/recompete/vehicle-grouping.ts`).
To make `pagination.total` truthful the route must group the WHOLE filtered set, but
Supabase hard-caps responses at **1000 rows**. So it: (1) head-counts the filtered set,
(2) fires `ceil(N/1000)` LIGHT-column page reads **in parallel** (total-ordered by
sort + `contract_id` so windows partition cleanly), groups all of it, then (3) hydrates
FULL rows for only the page's vehicles via `.in('contract_id', …)`. The old fixed
`GROUP_FETCH_CAP = 6000` under-counted once the set crossed ~6k (it was 6,191 on Jun 28).
No schema change; the JS key is the single source of truth. `SCAN_ROW_CAP = 20000`
guards a runaway filter. Verified live: 5,066 rows → 4,796 vehicles (270 collapsed).

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`
**Purpose:** Find government buyers — agency spending analysis, NAICS targeting
**Price:** Free + Pro ($19/mo)

### 6. Action Planner
**Location:** `/src/app/planner/`
**Purpose:** Task management — 5 phases, 36 tasks, progress tracking, PDF export

### 7. Daily Briefings (All 3 Types)
**Location:** `/src/lib/briefings/`
**Purpose:** Personalized GovCon intel emails with win probability scoring
**Features:** Smart profiles, engagement tracking, shared cohort rollout across all 3 briefing types

**Enterprise Pre-computation Architecture (April 9, 2026):**
Instead of generating 928 individual briefings per type, we pre-compute 49 templates (one per unique NAICS profile) for ALL 3 briefing types.

| Metric | Before | After |
|--------|--------|-------|
| LLM Calls/week | 928 × 3 = **2,784** | 49 × 3 = **147** (95% reduction) |
| Time per briefing | 52+ seconds | ~40 seconds (template) |
| Sending time | N/A | ~100ms/user |
| Total capacity | ~1 user/run | **500+ users/run** |
| Rollout mode | `rollout` (250) | **`beta_all` (927 users)** |

**All 3 Briefing Types Pre-computed:**

| Briefing | Pre-compute Cron | Send Cron | Schedule |
|----------|------------------|-----------|----------|
| Daily Brief | `precompute-briefings` | `send-briefings-fast` | Daily 2-4 AM → 7-8:30 AM |
| Weekly Deep Dive | `precompute-weekly-briefings` | `send-weekly-fast` | Thu 8-10 PM → Fri 7-8:30 AM |
| Pursuit Brief | `precompute-pursuit-briefs` | `send-pursuit-fast` | Fri 8-10 PM → Sat 7-8:30 AM |

**Email delivery rule (April 25, 2026):**
All production alert/briefing send paths should call `src/lib/send-email.ts` via `sendEmail()`.
This makes Resend the primary provider and keeps Office 365 as fallback only.
Verified paths include `weekly-alerts`, `send-briefings-fast`, `send-weekly-fast`, `send-pursuit-fast`, legacy `weekly-deep-dive`, legacy `pursuit-brief`, and admin `send-all-briefings`.

**Weekly deep dive catch-up rule (April 25, 2026):**
`send-weekly-fast` supports `catchup=true` / `force=true` across the Friday cron batch window.
This exists because weekly templates can be generated after the primary Friday 7-8:30 AM UTC send window.
If no weekly templates exist at send time, the route logs a `tool_errors` record.

**Weekly/pursuit precompute resumability (April 25, 2026):**
`precompute-weekly-briefings` and `precompute-pursuit-briefs` skip target-date templates that already exist, cap each run with a soft timeout budget, and return `templatesRemaining` so later cron invocations continue coverage instead of being killed by the platform timeout.

**Day-of-Week Guards (April 16, 2026):**
All cron endpoints have **explicit day guards** that prevent sending on wrong days:

| Endpoint | Allowed Day | UTC Day # | Guard Response |
|----------|-------------|-----------|----------------|
| `precompute-weekly-briefings` | Thursday | 4 | `{"skipped": true, "dayOfWeek": X}` |
| `send-weekly-fast` | Friday | 5 | `{"skipped": true, "dayOfWeek": X}` |
| `precompute-pursuit-briefs` | Friday | 5 | `{"skipped": true, "dayOfWeek": X}` |
| `send-pursuit-fast` | Saturday | 6 | `{"skipped": true, "dayOfWeek": X}` |

Test mode (`?test=true&email=...`) bypasses day guards for manual testing.

**Monitor Briefing Health:**
```bash
# Check what was sent today
curl "https://getmindy.ai/api/admin/briefing-status?password=$ADMIN_PASSWORD"
```

**Prefix Fallback for Custom Profiles:**
Users with custom NAICS profiles (via preferences page) get briefings immediately via 3-digit prefix matching. For example, a user with `236, 237, 238` matches templates with any construction code (`236xxx`, `237xxx`, `238xxx`).

**Database Tables:**
- `briefing_templates` — Pre-computed briefings by NAICS profile hash (supports `daily`, `weekly`, `pursuit` types)
- `briefing_precompute_runs` — Tracks nightly template generation jobs

**Key Files:**
- `api/cron/precompute-briefings/route.ts` — Daily templates (2-4 AM)
- `api/cron/send-briefings-fast/route.ts` — Send daily briefings (7-8:30 AM)
- `api/cron/precompute-weekly-briefings/route.ts` — Weekly templates (Thu 8-10 PM)
- `api/cron/send-weekly-fast/route.ts` — Send weekly briefings (Fri 7-8:30 AM)
- `api/cron/precompute-pursuit-briefs/route.ts` — Pursuit templates (Fri 8-10 PM)
- `api/cron/send-pursuit-fast/route.ts` — Send pursuit briefs (Sat 7-8:30 AM)
- `src/lib/briefings/delivery/ai-briefing-generator.ts` — Supports `naicsOverride` for profile-based generation

**Email Products (April 16, 2026):**

| Product | Price | Emails Included |
|---------|-------|-----------------|
| **Daily Alerts** | $19/mo | Daily Alerts (simple opportunity list) |
| **Market Intelligence** | $49/mo | Daily Market Intel + Weekly Deep Dive + Pursuit Brief |

**Email Template Generators:**

| Email | Function | Colors | Header |
|-------|----------|--------|--------|
| Daily Alerts ($19/mo) | `send-notifications/route.ts` | Purple banner | "🎯 X New Opportunities" |
| Daily Market Intel ($49/mo) | `generateDailyEmailHtmlFromSam()` | **Green** `#059669→#10b981` | "📋 Active Solicitations" |
| Weekly Deep Dive ($49/mo) | `generateAIEmailTemplate()` | Navy→Purple `#1e3a8a→#7c3aed` | "📊 Weekly Deep Dive" |
| Pursuit Brief ($49/mo) | `generateCombinedPursuitEmailHtml()` | Navy→Purple | "YOUR TOP 3 PURSUIT TARGETS" |
| ~~Bid Target~~ | `bid-target-email-template.ts` | DEPRECATED | Not sending |

**Design Systems:**
- **GREEN** (`#059669→#10b981`): Daily Market Intel — "bid now" SAM.gov opportunities
- **NAVY→PURPLE** (`#1e3a8a→#7c3aed`): Weekly Deep Dive + Pursuit — strategic intelligence
- **PURPLE BANNER**: Daily Alerts — simple opportunity list
- **ALERT STRIP** (daily alerts, purple email): phased — first 30 days + incomplete profile → `🎁 FREE forever • Set up your keywords in Mindy →`; otherwise → `👋 Welcome to Mindy • FREE forever` (see `src/lib/alerts/profile-setup.ts`)
- **RED BANNER** (`#dc2626→#ef4444`): "🎯 Market Intelligence • FREE PREVIEW during beta" — on $49/mo briefing emails only (not daily alerts)

**SAM.gov Recompete Matching (April 16, 2026):**

Weekly Deep Dive cross-references USASpending expiring contracts with SAM.gov opportunities using score-based matching:

| Factor | Points | Description |
|--------|--------|-------------|
| NAICS match | +20 | Required baseline |
| Agency match | +15 | First word of agency name |
| Incumbent name | +30 | SAM.gov mentions the incumbent |
| 50%+ keywords | +25 | At least half of significant words match |
| 30-49% keywords | +10 | Partial keyword match |
| Timing (≤12 mo) | +15 | SAM.gov posted within 12 months of expiration |
| Timing (≤18 mo) | +10 | Posted within 18 months |
| Timing (≤24 mo) | +5 | Posted within 24 months |
| Contract # ref | +40 | SAM.gov mentions predecessor contract number |

**Minimum score: 40** (NAICS + one strong factor) to show "SAM.gov STATUS" in email.

**Recompete Timeline Research:**
- Agencies start planning: 12-18 months before expiration
- Sources Sought/RFI: 6-12 months before RFP
- Pre-solicitation: 3-6 months before
- RFP posting: 2-4 months before expiration
- Total window: Solicitations appear **6-18 months** before contract expires

**Two-Stage Fetch & Score System (April 19, 2026):**

Weekly briefing precompute now uses a two-stage approach for better opportunity matching:

**Stage 1: Cast Wide Net (Fetch)**
For each NAICS profile, aggregates search criteria from ALL users in that group:
- NAICS codes (primary, from user profiles)
- PSC codes (derived via crosswalk from NAICS)
- Keywords (aggregated from all users in group)
- Target agencies (aggregated from all users in group)

Fetches from USASpending using OR logic across NAICS + PSC + keywords.

**Stage 2: Score & Rank (Filter)**

| Factor | Points |
|--------|--------|
| NAICS match | +25 |
| PSC match in description | +15 |
| Keyword in title | +20 |
| Keyword in description | +10 |
| Target agency match | +15 |
| Expiring <6 months | +10 |
| Expiring <1 year | +5 |
| Low bids (1-2) | +15 |
| Value $10M+ | +10 |
| Value $1M+ | +5 |

Top 15 highest-scoring opportunities selected for each template.

### 8. Daily Alerts System
**Location:** `/src/app/api/cron/daily-alerts/`, `/src/app/alerts/`
**Purpose:** Automated opportunity alert emails based on user NAICS/keywords
**Price:** $19/mo — but **DAILY alerts are FREE for everyone (permanent, decided 2026-06-03)**
**Value Prop:** "Don't miss opportunities" (volume play)
**Free for:** Everyone with `alert_frequency='daily'` — no tier check by default

**⚠️ Daily tier gate (READ BEFORE TOUCHING `daily-alerts/route.ts`):**
The daily-alerts cron is nominally "PAID TIER ONLY," but the tier check is **OFF by default** — free users always get daily alerts. This is the permanent model.
- Controlled by env: `DAILY_ALERT_BETA=off` enforces paid-only (free → weekly fallback); unset/anything-else = everyone-daily.
- There used to be a hardcoded `BETA_END_DATE = '2026-05-28'`. When that date passed it silently flipped the tier check on and **collapsed the daily send from ~922 to ~1/day** (free users fell through to the weekly cron). The bare date gate was **removed** — never reintroduce a calendar-based gate here.
- **Do NOT set `ENABLE_MINDY_INSIGHTS=true`** in Vercel — the #91 Mindy Insights RAG quote awaited in the per-user send loop crashed the batch May 28–31. It's gated off via `MINDY_INSIGHTS_ROLLOUT_PERCENT=0`.
- **Today's Intel Mindy Insight card (June 4, 2026):** Podcast **guest lesson** quotes on `/app` dashboard — **separate flags**, **LIVE** at `ENABLE_PODCAST_INSIGHTS=true` + `PODCAST_INSIGHTS_ROLLOUT_PERCENT=100`. Uses **pulse vs lesson** (`src/lib/dashboard/insight-pulse-lesson.ts`): pulse = briefing/stats; lesson = NAICS-matched `key_lessons` from `podcast_episode_metadata`. QA: `/admin/podcast-highlights`. Runbook: `tasks/podcast-highlights-QA.md`. API: `GET /api/app/dashboard/insight`.
- Real alert numbers: `/api/admin/dashboard` + `/api/admin/briefing-status`. `/api/admin/alert-status` reads the dropped `user_alert_settings` table and is stale.
**Features:**
- **Notice Type Badges:** Color-coded RFP (green), RFQ (blue), Sources Sought (purple), Pre-Sol (orange), Combined (teal)
- **Posted Date:** Shows when opportunity was released
- **Urgency Badges:** 🔥 3 DAYS LEFT (red + highlighted row), ⚡ X days (orange), 📅 2 weeks (yellow)
- Deduplication (won't resend same opp in 7 days)
- Retry logic (3 attempts for failed emails)
- Timezone-aware delivery (~6 AM local time)
- Keywords search (catch mislabeled opportunities)
- PSC crosswalk (auto-generate related PSC codes from NAICS)
- Phased alert email strip (setup nudges → Welcome/FREE forever); briefing emails still use FREE PREVIEW banner
- **NOT included:** Win Probability, AI analysis (reserved for $49/mo Market Intelligence)

**Key Files:**
- `api/cron/daily-alerts/route.ts` — Main alerts cron handler
- `api/cron/precompute-briefings/route.ts` — Pre-compute templates by NAICS profile
- `api/cron/send-briefings-fast/route.ts` — Send using pre-computed templates (~100ms/user)
- `alerts/preferences/page.tsx` — Redirects to `/briefings` (unified UI)
- `api/alerts/preferences/route.ts` — Preferences API

**Unified Market Intelligence UI (April 16, 2026):**
- `/briefings` — Single unified dashboard with 4 tabs: **BRIEFINGS | FORECASTS | SBIR | GRANTS**
- `/alerts/preferences` — Now redirects to `/briefings`
- Settings panel accessible via gear icon in dashboard header
- Onboarding wizard for new users (NAICS → Agencies → Geography → Delivery)
- Demo video: `https://vimeo.com/1181569155`

**MI Dashboard Tabs:**
| Tab | Color | Purpose | Data Source |
|-----|-------|---------|-------------|
| BRIEFINGS | Purple | Daily/Weekly/Pursuit intel | Pre-computed templates |
| FORECASTS | Amber | 7,764 agency forecasts 6-18mo ahead | `agency_forecasts` table |
| SBIR | Blue | SBIR/STTR small business R&D | NIH RePORTER API + Multisite |
| GRANTS | Emerald | $700B+ federal grant funding | Grants.gov REST API |

**New APIs (April 16, 2026):**
| API | Purpose | Auth Required |
|-----|---------|---------------|
| `/api/grants` | Grants.gov search wrapper | No |
| `/api/sbir` | NIH RePORTER + Multisite SBIR/STTR | No |

**New Components:**
- `src/components/briefings/GrantsPanel.tsx` — Grants search UI
- `src/components/briefings/SbirPanel.tsx` — SBIR/STTR search UI

**Dashboard Features (April 21, 2026):**
- **Search bar** — Find opportunities by title, agency, keywords with highlighting
- **Advanced filters** — Search, Notice Type, Urgency, Set-Aside, NAICS, State, Agency
- **Profile-based filtering** — Clicking from stats bar auto-filters by user's profile
- **CSV export** — Download filtered briefing data as spreadsheet
- **Print/PDF** — Browser print dialog for PDF export
- **Email feedback** — Thumbs up/down buttons in emails track helpfulness

**Forecasts Search Filters (April 21, 2026):**
- NAICS Code, Agency, State (NEW), Set-Aside, Keyword
- Auto-loads user profile when switching to FORECASTS tab
- Database has `pop_state`, `program_office`, `contracting_office` fields

**Feedback System:**
- API: `/api/briefings/feedback` (GET for email links, POST for programmatic)
- Pages: `/briefings/feedback/thanks`, `/briefings/feedback/error`
- Table: `briefing_feedback` (user_email, briefing_date, briefing_type, rating)

**UI Components:**
- `src/components/briefings/MarketIntelligenceHeader.tsx` — Dashboard header with MI branding
- `src/components/briefings/OnboardingWizard.tsx` — 4-step setup wizard
- `src/components/briefings/SettingsPanel.tsx` — Slide-out settings panel (all preferences)
- `src/components/briefings/SampleOpportunitiesPicker.tsx` — Sample opportunity picker wizard

**Profile Calibration Features (April 19, 2026):**

| Feature | API | Purpose |
|---------|-----|---------|
| AI Code Suggestions | `POST /api/suggest-codes` | Generate NAICS/PSC suggestions from business description |
| PSC/NAICS Search | `GET /api/suggest-codes?q=` | Direct keyword search for codes |
| Sample Opportunities | `POST /api/sample-opportunities` | Browse 29K+ real opportunities by description |
| Profile Extraction | `POST /api/sample-opportunities` (action: extract) | Extract NAICS/PSC/keywords from user selections |

**Sample Opportunities Picker Flow:**
1. User clicks "Browse Sample Opportunities" in Settings
2. Describes their business in free text
3. System shows 30 diverse real opportunities from `sam_opportunities` table
4. User selects opportunities that fit (minimum 3)
5. System extracts patterns (NAICS, PSC, keywords, agencies, set-asides)
6. User applies extracted profile to their settings

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/api/suggest-codes/route.ts` | AI code suggestion API (Groq Llama 3.3 70B) |
| `src/app/api/sample-opportunities/route.ts` | Sample opportunity picker API |
| `src/components/briefings/SampleOpportunitiesPicker.tsx` | 3-step picker wizard UI |
| `tests/test-suggest-codes.sh` | 23 test cases for code suggestions |
| `tests/test-sample-opportunities.sh` | 17 test cases for sample picker |

**Business Intelligence Storage (April 19, 2026):**

User profile data from the calibration wizard is now stored for:
- Better opportunity matching across all tools
- Customer insights and product intelligence
- Understanding user needs for fine-tuned products

**Database Table: `user_business_profiles`**
| Column | Type | Purpose |
|--------|------|---------|
| `business_description` | TEXT | Free-text business description from wizard |
| `extracted_naics_codes` | JSONB | NAICS codes from opportunity selections |
| `extracted_psc_codes` | JSONB | PSC codes from opportunity selections |
| `extracted_keywords` | JSONB | Keywords extracted from selections |
| `extracted_agencies` | JSONB | Target agencies from selections |
| `extracted_set_asides` | JSONB | Set-aside preferences |
| `opportunities_shown` | INT | How many samples were shown |
| `opportunities_selected` | INT | How many the user selected |
| `tools_used` | TEXT[] | Which tools the user has accessed |
| `reports_generated` | INT | Behavioral tracking |

**PSC Codes + Keywords in Briefings:**

Daily briefings now use the user's full profile for matching:
- NAICS codes (primary)
- PSC codes (industry classification)
- Keywords (catch mislabeled opportunities)

The `fetchSamOpportunitiesFromCache` function accepts all three and uses OR logic for broader matching.

**Admin Endpoint:**
`/api/admin/apply-business-intel-migration?password=xxx` — Check migration status

**OH → Market Intelligence Funnel (April 25, 2026):**

Complete conversion funnel from free Opportunity Hunter to paid Market Intelligence:

```
1. OH Search Results → MI upsell card (full-width purple banner)
   "$199/mo value → $49/mo" with direct checkout CTA

2. Daily Alert Emails → MI upsell box (purple gradient)
   "Want the Daily Briefing?" with link to /market-intelligence

3. /market-intelligence → Unified checkout page
   - Access verification (existing users → /briefings)
   - What's Included section (Daily Brief, Weekly, Pursuit)
   - Direct Stripe checkout: Monthly $49/mo, Annual $497/yr
   - Ultimate Bundle callout ($1,497 lifetime)

4. /briefings (denied state) → Links to /market-intelligence
```

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/opportunity-hunter/page.tsx` | MI upsell card in results (lines 1205-1230) |
| `src/app/api/cron/daily-alerts/route.ts` | MI upsell in email (lines 1254-1267) |
| `src/app/market-intelligence/page.tsx` | Unified checkout/landing page |
| `src/app/briefings/page.tsx` | Dashboard with denied state → MI link |

**Stripe Checkout URLs:**
- Monthly: `https://buy.stripe.com/00wfZigjc97ceND3OEfnO0z`
- Annual: `https://buy.stripe.com/aFa6oI6ICdns0WN5WMfnO0A`

**Cron Schedule (ET):**
| Job | Times (ET) | Purpose |
|-----|------------|---------|
| daily-alerts | 7 AM, 8 AM, 10 AM, 12 PM | Timezone coverage (1 email/user/day, deduped) |
| precompute-briefings | 10:00-11:30 PM (prev night) | Daily templates by NAICS profile |
| send-briefings-fast | 3:00-4:30 AM (every 10 min) | Send daily briefings |
| precompute-weekly-briefings | Thu 4:00-6:00 PM | Weekly templates by NAICS profile |
| send-weekly-fast | Fri 3:00-4:30 AM (every 10 min) | Send weekly briefings |
| precompute-pursuit-briefs | Fri 4:00-6:00 PM | Pursuit templates by NAICS profile |
| send-pursuit-fast | Sat 3:00-4:30 AM (every 10 min) | Send pursuit briefs |
| weekly-alerts | Sun 7:00-7:50 PM + Mon 8:00-8:30 PM UTC-equivalent catch-up window | Free/weekly saved-search digest |
| pursuit-changes | `*/15 13,21 * * *` UTC (dispatcher window, 2x/day) | Amendment/change alerts on tracked pursuits |

**Pursuit change/amendment alerts (June 5, 2026):**
- Monitors `user_pipeline` (non-archived, has `notice_id`) for deadline moves,
  amendments (SAM `last_modified` bump), notice-type changes (incl. cancelled/
  awarded), and new documents. Diffs live `sam_opportunities` vs the snapshot in
  `pursuit_monitor_state`. Writes `pursuit_change_log` (drives the in-app "⚠️ N
  changes" badge on pursuit cards) + emails the OWNER a digest via `sendEmail()`.
- **Owner-attributed:** uses `owner_email || user_email` for both badge + email
  (workspace-safe). In-app feed: `GET/POST /api/app/pursuit-changes` (ack clears
  badge).
- **Batch + resumable (scale):** processes `PURSUIT_CHANGES_BATCH_SIZE` (env,
  default 100) least-recently-checked pursuits per invocation, 45s soft budget,
  returns `remaining`; the dispatcher window re-fires until drained. Bounded load
  at 1000s of pursuits. First run snapshots only (no false alerts).
- Tables: `pursuit_change_log`, `pursuit_monitor_state` (migration
  `20260605_pursuit_change_alerts.sql`).

**Weekly alerts (April 25, 2026):**
- Scheduled as a 10-invocation batch window in `vercel.json`
- Uses `?catchup=true` so Monday catch-up invocations are allowed
- Uses the Sunday cycle date for all rows in that weekly run
- Writes `opportunities_data[0].alertSource` as `free_weekly_fallback` or `explicit_weekly`
- Operations dashboard tracks eligible, processed, sent, skipped, failed, remaining, processed free, and processed explicit counts

**Briefing rollout model:**
- `beta_all` = full eligible briefing audience
- `rollout` = controlled 250-user program cohort
- default cohort settings: `stickyDays=14`, `cooldownDays=21`, `maxFallbackPercent=15`
- rotation requires the full program experience twice:
  - `daily brief` x2
  - `weekly deep dive` x2
  - `pursuit brief` x2
- admin endpoint: `/api/admin/briefing-rollout`

**Automated Backup System (April 9, 2026):**
Enterprise-grade failsafe for 9,000+ users:

| Component | Purpose |
|-----------|---------|
| Dead Letter Queue | Failed briefings retry up to 3x with exponential backoff |
| Watchdog Cron | Runs 5 AM, 5:30 AM, 6 AM ET daily to monitor health |
| Self-Healing | Auto-triggers precompute if <80% template coverage |
| Alert Escalation | Warning (5% failure) → Critical (15% failure) |

**Database Tables:**
- `briefing_dead_letter` — Retry queue with exponential backoff (15min × 2^retry)
- `briefing_system_health` — Health metrics with auto-computed scores

**Key Files:**
- `api/cron/briefing-watchdog/route.ts` — Central monitoring and auto-recovery
- `api/admin/briefing-dead-letter/route.ts` — Admin view/manage retry queue
- `supabase/migrations/20260409_briefing_backup_system.sql` — Schema

**Admin Endpoint:**
```
GET /api/admin/briefing-dead-letter?password=$ADMIN_PASSWORD
POST { action: "retry", id: "xxx" } — Force retry specific entry
POST { action: "clear", status: "exhausted" } — Clear by status
POST { action: "stats" } — Get summary statistics
```

### 9. Forecast Intelligence System
**Location:** `/src/app/forecasts/`, `/src/lib/forecasts/`
**Purpose:** Aggregate procurement forecasts from 13 federal agencies (6-18 months before solicitation)
**Status:** Phase 1-2 complete (April 6, 2026) — **7,764 forecasts**
**Live URL:** https://getmindy.ai/forecasts

**Database Tables:**
- `agency_forecasts` — Main forecast data (unified schema)
- `forecast_sync_runs` — Track sync operations
- `forecast_sources` — Agency source configurations

**Current Data (April 6, 2026):**
| Agency | Source | Records |
|--------|--------|---------|
| DOJ | justice.gov Excel | 3,140 |
| DOI | GSA Acquisition Gateway CSV | 2,039 |
| DOE | energy.gov Excel | 833 |
| DHS | Puppeteer scraper | 683 |
| NASA | nasa.gov Excel | 294 |
| VA | GSA Acquisition Gateway CSV | 268 |
| GSA | GSA Acquisition Gateway CSV | 164 |
| NRC | GSA Acquisition Gateway CSV | 79 |
| DOT | GSA Acquisition Gateway CSV | 68 |
| SSA | Excel (SBF Report) | 60 |
| NSF | PDF (Acquisition Forecast) | 56 |
| DOL | GSA Acquisition Gateway CSV | 47 |
| **Total** | | **7,764** |

**Phase 3-4 Sources (Puppeteer, pending):**
| Agency | Source | Est. Coverage |
|--------|--------|---------------|
| HHS | procurementforecast.hhs.gov | $12B |
| Treasury | osdbu.forecast.treasury.gov | $2B |
| EPA | ordspub.epa.gov | $1.5B |
| USDA | forecast.edc.usda.gov | $4B |
| DOD | Multi-source | $40B |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/forecasts/page.tsx` | Search UI with filters |
| `src/app/api/forecasts/route.ts` | API endpoint |
| `src/lib/forecasts/types.ts` | TypeScript types |
| `src/lib/forecasts/scrapers/` | Puppeteer scrapers (DHS working, others pending) |
| `scripts/import-forecasts.js` | Excel import script (DOE, NASA, DOJ) |
| `scripts/import-gsa-forecasts.js` | GSA Acquisition Gateway CSV import |
| `scripts/import-nsf-forecasts.js` | NSF PDF data import (hardcoded from PDF) |
| `scripts/import-ssa-forecasts.js` | SSA Excel (.xlsm) import |
| `supabase/migrations/20260405_forecast_intelligence.sql` | Schema |

**Import Commands:**
```bash
# Preview (no database writes)
node scripts/import-forecasts.js --dry-run

# Import all Phase 1 sources
node scripts/import-forecasts.js

# Import specific source
node scripts/import-forecasts.js --source=DOE
```

### 10. BD Assist (Enterprise Platform)
**Location:** `/src/app/bd-assist/`, `/src/components/bd-assist/`
**Purpose:** Unified BD department platform for enterprise contractors
**Price:** $199/mo (FREE lifetime for Ultimate Bundle buyers)
**Status:** Phase 1-2 complete (April 10, 2026)

**Features:**
- **Federal Market Scanner** — 6-question market intelligence (Who's buying? How? Who has it? What's available? Events? Who to talk to?)
- **Pipeline Tracker** — Kanban board with 6 stages (tracking → pursuing → bidding → submitted → won/lost)
- **Teaming CRM** — Partner management with outreach tracking
- **Intel Dashboard** — Daily briefs, opportunities, deadlines

**Database Tables:**
- `user_pipeline` — Opportunity tracking with stage history
- `pipeline_history` — Audit trail of stage changes
- `user_teaming_partners` — Teaming partner CRM

**API Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `GET/POST/PATCH/DELETE /api/pipeline` | Pipeline CRUD |
| `GET /api/pipeline/stats` | Pipeline metrics by stage |
| `GET/POST/PATCH/DELETE /api/teaming` | Teaming partners CRUD |
| `GET /api/market-scanner` | 6-question market scan |

**Key Files:**
| File | Purpose |
|------|---------|
| `src/app/bd-assist/page.tsx` | Main dashboard with tabs |
| `src/components/bd-assist/PipelineBoard.tsx` | Kanban board |
| `src/components/bd-assist/MarketScanner.tsx` | 6-question scanner UI |
| `src/app/api/market-scanner/route.ts` | Scanner API (870 lines) |
| `supabase/migrations/20260410_bd_assist_pipeline.sql` | Database schema |

**Live URL:** https://getmindy.ai/bd-assist

---

## Products & Pricing

| Product | Price | KV Key | Stripe Metadata |
|---------|-------|--------|-----------------|
| **MI Pro** | $149/mo | `briefings:{email}` | `tier: briefings` |
| **MI Pro (loyalty)** | $49/mo | `briefings:{email}` | `tier: briefings` |
| Content Reaper | $197 | `contentgen:{email}` | `tier: content_standard` |
| Market Assassin Standard | $297 | `ma:{email}` | `tier: assassin_standard` |
| Content Reaper Full Fix | $397 | `contentgen:{email}` | `tier: content_full_fix` |
| Recompete Tracker | $397 | `recompete:{email}` | `tier: recompete` |
| Federal Contractor Database | $497 | `dbaccess:{email}` | `tier: contractor_db` |
| Market Assassin Premium | $497 | `ma:{email}` | `tier: assassin_premium` |

### Market Intelligence Access (May 2026)

| User Type | MI Free ($0) | MI Pro ($149/mo) |
|-----------|--------------|------------------|
| New users | ✅ Free signup | Pay $149/mo |
| Past customers (loyalty) | ✅ Free | Offered $49/mo via email |
| Pro Giant ($997) | ✅ Free | ✅ Included |
| Ultimate ($1,497) | ✅ Free | ✅ Lifetime |
| Pro Member ($52/mo) | ✅ Free | ✅ Included |

**Notes:**
- $49/mo loyalty pricing is private (email campaign only, not on public page)
- $149/mo includes FHC training access (replaces $99/mo FHC product)
- MI Free = Daily Alerts + OH search (no AI briefings)

### Bundles
| Bundle | Price | Includes |
|--------|-------|----------|
| Starter ($697) | $943 value | Opp Hunter Pro, Recompete, Contractor DB |
| Pro Giant ($997) | $1,388 value | Contractor DB, Recompete, MA Standard, Content Gen, 1 Year Briefings |
| Ultimate ($1,497) | $1,788 value | Content Full Fix, Contractor DB, Recompete, MA Premium, Lifetime Briefings |

### Mindy Account Types (non-customer)

| Type | Who | Pro access | Counts as paid? | Campaigns |
|------|-----|------------|-------------------|-----------|
| **Staff** | `@govcongiants.com`, `MI_STAFF_EMAILS`, `INTERNAL_TEAM_EMAILS` | Yes (`staffRole`) | No | Excluded |
| **Advocate** | T4 power users / creators (`src/lib/mindy/advocate-accounts.ts`) | Yes (complimentary Pro) | No | Excluded |
| **Comp/Testimonial** | Demo accounts for marketing videos | Varies | No | Excluded |
| **Mindy Team** | Paid `$499/mo` product (`access_team`) | Team tier | Yes | Normal |
| **Mindy Pro** | Paid subscriber or bundle buyer | Pro tier | Yes | Normal |

Grant advocate: `npx tsx scripts/grant-mindy-pro-once.ts email@example.com --advocate`

### Comp/Testimonial Accounts (Exclude from Campaigns)

| Email | Purpose |
|-------|---------|
| `aj@cypherintel.com` | Testimonial |
| `pa.joof@pjaygroup.com` | Testimonial |
| `dare2dreaminc615@gmail.com` | Testimonial |
| `olga@olaexecutiveconsulting.com` | Testimonial |
| `tavinalford@gmail.com` | Testimonial |

### Advocate Accounts (Exclude from Campaigns)

Complimentary Pro for creators / power users with their own audience (Launch Strategy T4). Registry: `src/lib/mindy/advocate-accounts.ts`.

| Email | Name |
|-------|------|
| `westover105@gmail.com` | Sue Kranes |

### Memberships
| Membership | Price | Includes |
|------------|-------|----------|
| Federal Help Center | $99/mo | MA Standard + Alert Pro + OH Pro (revoked on cancel) |

---

## Rate Limiting & Abuse Detection

### Rate Limits
| Scope | Limit | Window | KV Key |
|-------|-------|--------|--------|
| Report generation (email) | 50 | 24 hours | `rl:report:{email}` |
| Content generation (email) | 10 | 24 hours | `rl:content:{email}` |
| Authenticated IP fallback | 30 | 1 hour | `rl:ip:{ip}` |
| Unauthenticated IP | 5 | 1 hour | `rl:ip:unauth:{ip}` |
| Admin endpoints | 30 | 1 minute | `rl:admin:{ip}` |

### Abuse Thresholds
| Level | Count | Action |
|-------|-------|--------|
| Warning | 100 | Console log |
| Flagged | 250 | Stored in `abuse:flag:{email}`, added to `abuse:flagged` set |
| Blocked | 500+ | API returns 403, logged to console |

### Admin Endpoint
`/api/admin/abuse-report?password=$ADMIN_PASSWORD`
- GET: View all flagged users
- GET `?email=X`: Check specific user
- POST `{ action: "clear", email: "X" }`: Clear flag

---

## Access Control System

### Vercel KV — Primary (gates actual tool access)
**Code:** `src/lib/access-codes.ts`

### Supabase `user_profiles` — Secondary (boolean flags)
**Code:** `src/lib/supabase/user-profiles.ts`

### Purchase Flow (Triple-Write)
1. Customer buys via Stripe → webhook at `/api/stripe-webhook`
2. Webhook writes: Supabase `purchases` + `user_profiles` flags + Vercel KV
3. Sends confirmation email
4. Customer activates at `/activate` (email-only)

---

## Data Systems

### Agency Pain Points & Intelligence (April 19, 2026)

**Static Data:** `src/data/agency-pain-points.json`
- **307 agencies** (expanded from 250)
- **3,045 pain points** (+280 from GAO reports)
- **2,611 priorities** (+111 from spending patterns)

**Database:** `agency_intelligence` table in Supabase
- **557 records** from real public APIs
- **446 gao_high_risk** records (GovInfo API)
- **111 contract_pattern** records (USASpending API)

**Unified API:** `src/lib/agency-intelligence/index.ts`
```typescript
import { getUnifiedAgencyIntelligence, getAgencyPainPointsUnified } from '@/lib/agency-intelligence';
const intel = await getUnifiedAgencyIntelligence('Department of Defense');
```

**Merge Script:**
```bash
node scripts/merge-agency-intelligence.js --preview  # Preview
node scripts/merge-agency-intelligence.js --merge    # Apply
```

**Admin:** `/api/admin/sync-agency-intel?password=xxx`
**API:** `/api/pain-points`

### FY2026 Budget Authority
- **Cached data:** `src/data/agency-budget-data.json` — 47 toptier agencies
- **Admin:** `/api/admin/build-budget-data?password=...&mode=build`
- **API:** `/api/budget-authority`

### Win Probability Scoring
- **File:** `src/lib/briefings/win-probability.ts`
- **Factors:** NAICS (25), Set-Aside (25), Agency (15), Size (15), Capability (10), Vehicle (10)
- **Tiers:** excellent (75%+), good (60-74%), moderate (45-59%), low (30-44%), poor (<30%)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/products.ts` | Product config with Stripe URLs (source of truth) |
| `src/app/api/stripe-webhook/route.ts` | Payment webhook — triple-write handler |
| `src/lib/supabase/user-profiles.ts` | User & access flag management |
| `src/lib/access-codes.ts` | Vercel KV access checking |
| `src/lib/rate-limit.ts` | Rate limiting functions |
| `src/lib/abuse-detection.ts` | Abuse tracking and flagging |
| `src/lib/send-email.ts` | All email templates |
| `src/lib/briefings/` | Daily briefing system |
| `src/lib/smart-profile/` | User profile learning system |
| `src/app/api/cron/daily-alerts/route.ts` | Daily alerts cron (FREE for everyone; phased setup nudges via `profile-setup.ts`) |
| `src/lib/alerts/profile-setup.ts` | Alert conversion window + `userNeedsMindySetup()` |
| `src/lib/sam/attachment-metadata.ts` | SAM attachment filename resolution (HEAD / Content-Disposition) |
| `src/components/app/SamAttachmentLinks.tsx` | Lazy attachment labels in Alerts + Market Dashboard |
| `src/app/api/sam-attachment/metadata/route.ts` | `GET ?url=` → `{ filename }` for SAM download links |
| `src/app/api/cron/precompute-briefings/route.ts` | Pre-compute daily templates by NAICS |
| `src/app/api/cron/send-briefings-fast/route.ts` | Send daily briefings (~100ms/user) |
| `src/app/api/cron/precompute-weekly-briefings/route.ts` | Pre-compute weekly templates by NAICS |
| `src/app/api/cron/send-weekly-fast/route.ts` | Send weekly briefings (~100ms/user) |
| `src/app/api/cron/precompute-pursuit-briefs/route.ts` | Pre-compute pursuit templates by NAICS |
| `src/app/api/cron/send-pursuit-fast/route.ts` | Send pursuit briefs (~100ms/user) |
| `src/app/alerts/preferences/page.tsx` | Alert/briefing preferences UI |
| `src/lib/utils/psc-crosswalk.ts` | PSC-NAICS crosswalk for broader search |
| `src/app/api/suggest-codes/route.ts` | AI code suggestion (Groq Llama 3.3 70B) |
| `src/app/api/sample-opportunities/route.ts` | Sample opportunity picker for profile calibration |
| `docs/govcon-market-research.md` | GAO market research framework for AI prompts |
| `docs/PRD-market-research-intelligence.md` | PRD for market research integration |

---

## Admin Endpoint Standard

- **Auth:** `?password=$ADMIN_PASSWORD` (or `ADMIN_PASSWORD` env var)
- **GET** = read/preview (safe)
- **POST** = execute (writes data)
- **Preview mode:** `?mode=preview` (default)
- **Execute mode:** `?mode=execute`
- **Response:** `{ success: boolean, message: string, data?: any, errors?: string[] }`

### Key Admin Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/admin/abuse-report` | View/clear abuse flags |
| `/api/admin/build-pain-points` | Rebuild agency pain points |
| `/api/admin/build-budget-data` | Rebuild budget data |
| `/api/admin/trigger-alerts` | Manually trigger alert emails |
| `/api/admin/send-test-briefing` | Generate and send test briefing |
| `/api/admin/grant-briefings` | Batch grant briefings access |
| `/api/admin/test-sam-awards` | Test SAM Contract Awards API |
| `/api/admin/test-sam-entity` | Test SAM Entity Management API |
| `/api/admin/test-sam-subaward` | Test SAM Subaward API |
| `/api/admin/test-sam-hierarchy` | Test SAM Hierarchy API |
| `/api/admin/test-market-intel-pipeline` | **Full Market Intel pipeline testing** |
| `/api/admin/sync-alert-to-notification` | Sync users between alert/notif tables |
| `/api/admin/send-naics-reminder` | Send NAICS setup reminder emails |
| `/api/cron/health-check` | Automated API health tests |
| `/api/admin/tool-health` | **AI Tool Health Dashboard** — unified monitoring |
| `/api/admin/apply-tool-errors-migration` | Apply tool_errors database migration |
| `/api/admin/mi-growth-brief` | **MI Growth Brief** — engagement metrics + behavioral queues |
| `/api/admin/qualify-customers` | **Customer Qualification Agent** — purchase-based scoring |
| `/api/admin/launch-manager-brief` | Launch Manager Brief — team execution guidance |

---

## MI Launch Command Center (May 2026)

**URL:** `https://mi.govcongiants.com/admin/launch-command-center`

**Purpose:** Single internal dashboard for launch execution, combining behavioral + purchase-based intelligence.

### Data Sources

| API | Purpose | Data |
|-----|---------|------|
| `/api/admin/mi-growth-brief` | Behavioral signals | User engagement, email metrics, 5 action queues |
| `/api/admin/qualify-customers` | Purchase scoring | 10-10 candidates, sales targets, rescue queue |
| `/api/admin/launch-manager-brief` | Execution guidance | Domain policy, launches, owner actions |

### Queues Displayed

**Growth Brief Queues (Behavioral):**
| Queue | Purpose | Owner |
|-------|---------|-------|
| Setup Invite | Users need account setup | Annelle / Sikander |
| Profile Nudge | Users need profile completion | Annelle / Sikander |
| Activation Rescue | Users showing activation signals | Annelle / Sikander |
| Pro Upgrade | Free users ready for upgrade | Branden |
| White Glove | High-value enterprise candidates | Branden |

**Customer Qualification Queues (Purchase-Based):**
| Queue | Purpose | Owner |
|-------|---------|-------|
| Founder Calls | Score 85+ (10-10 candidates) | Eric |
| Sales Outreach | High-value customers for upgrade | Branden |
| Rescue Queue | Paid customers who went dark | Annelle / Sikander |

### Scoring Model (Customer Qualification)

**Purchase Factors:**
- Ultimate Bundle buyer: +30
- MI Pro / Briefings subscriber: +25
- Multiple purchases: +20
- Any single purchase: +10

**Engagement Factors:**
- Profile complete: +15
- Custom NAICS (not defaults): +10
- Briefings enabled: +10
- App events (5+): +5

**Segments:**
- **10-10 Candidate**: Score 80+ and Ultimate/high-ticket → Founder calls
- **White-glove Candidate**: Score 70+ with paid purchase → Sales calls
- **MI Pro Upgrade**: Score 50+, free, profile complete, engaged → Upgrade campaign
- **Activation Candidate**: Incomplete profile (default NAICS), score 30+ → Setup nudges (Annelle/Sikander)
- **Rescue Candidate**: Paid but zero engagement → Re-engagement
- **Audience Only**: Profile complete, low score → Nurture sequence

### Key Files

| File | Purpose |
|------|---------|
| `src/app/admin/launch-command-center/page.tsx` | UI component (1100+ lines) |
| `src/app/api/admin/mi-growth-brief/route.ts` | Growth Brief API (654 lines) |
| `src/app/api/admin/qualify-customers/route.ts` | Qualification Agent (508 lines) |
| `src/app/api/admin/launch-manager-brief/route.ts` | Launch Brief API |

---

## AI Tool Health Dashboard (April 19, 2026)

**Purpose:** Unified monitoring for all AI-powered tools to track errors, success rates, and API provider health.

### Dashboard API

```bash
# Get dashboard data (last 7 days)
curl "https://getmindy.ai/api/admin/tool-health?password=$ADMIN_PASSWORD"

# Get specific tool data
curl "https://getmindy.ai/api/admin/tool-health?password=$ADMIN_PASSWORD&tool=content_reaper"

# Include resolved errors
curl "https://getmindy.ai/api/admin/tool-health?password=$ADMIN_PASSWORD&unresolvedOnly=false"

# Resolve an error
curl -X POST "https://getmindy.ai/api/admin/tool-health?password=$ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"action": "resolve", "errorId": "uuid", "notes": "Fixed by..."}'

# Check all provider health
curl -X POST "https://getmindy.ai/api/admin/tool-health?password=$ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"action": "check_providers"}'
```

### Monitored Tools

| Tool Name | API Endpoint | AI Provider |
|-----------|--------------|-------------|
| `content_reaper` | `/api/content-generator/generate` | Groq |
| `code_suggestions` | `/api/suggest-codes` | Groq |
| `briefings` | `/api/cron/*-briefings` | Groq |
| `market_scanner` | `/api/market-scanner` | Groq |
| `sample_opportunities` | `/api/sample-opportunities` | Groq |

### Error Types

| Type | Description |
|------|-------------|
| `ai_timeout` | AI provider didn't respond in time |
| `ai_rate_limit` | Hit API rate limits (429 errors) |
| `ai_token_limit` | Exceeded token limits |
| `api_error` | External API failures |
| `validation` | Invalid input/request |
| `internal` | Server-side errors |

### Provider Status

Tracks health of external APIs:
- **groq** — Primary AI provider
- **openai** — Secondary AI provider
- **sam_gov** — SAM.gov Opportunities API
- **usaspending** — USASpending.gov API
- **grants_gov** — Grants.gov API

### Database Tables

| Table | Purpose |
|-------|---------|
| `tool_errors` | Per-error log with stack traces |
| `tool_health_metrics` | Daily aggregates by tool |
| `api_provider_status` | Real-time provider health |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/tool-errors.ts` | Error logging library |
| `src/app/api/admin/tool-health/route.ts` | Dashboard API |
| `supabase/migrations/20260419_tool_errors.sql` | Database schema |

### Integration Example

```typescript
import { logToolError, recordToolSuccess, ToolNames, classifyError, AIProviders } from '@/lib/tool-errors';

// Log an error
await logToolError({
  tool: ToolNames.CONTENT_REAPER,
  errorType: classifyError(error),
  errorMessage: error.message,
  aiProvider: AIProviders.GROQ,
  aiModel: 'llama-3.3-70b-versatile',
});

// Record success
recordToolSuccess(ToolNames.CONTENT_REAPER).catch(() => {});
```

---

## Bug Prevention Rules

1. **Never `continue` after Supabase failure** — always run KV operations unconditionally.
2. **Never match comma-joined strings directly** — split on delimiters first.
3. **Formatting must be consistent server + client** — markdown must render correctly.
4. **Always persist state after generation** — upsert to database immediately.
5. **Arrays must be `.join(' ')` not interpolated** — avoid `${array}` producing comma-joined.
6. **Never `.slice()` user data silently** — make caps explicit or configurable.
7. **Use unified `user_notification_settings` table** — Old tables (`user_alert_settings`, `user_briefing_profile`) were dropped. All code uses unified table now.
8. **Always add fallback NAICS** — If user has no NAICS, use defaults: `541512, 541611, 541330, 541990, 561210`.
9. **Supabase LIKE uses `%` not `*`** — For pattern matching, use `naics_code.like.236%` not `naics_code.like.236*`. The `*` wildcard returns 0 results.
10. **All KV operations must have try-catch fallback** — KV quota can be exceeded (500K requests/month on free tier). Functions must gracefully degrade: rate limits allow requests, abuse checks return false, access checks return null. See `src/lib/abuse-detection.ts` and `src/lib/access-codes.ts` for patterns.

---

## Vercel KV Resilience (May 2026)

**Problem:** Upstash KV free tier has 500K requests/month limit. When exceeded, all KV operations throw `UpstashError: ERR max requests limit exceeded`.

**Solution:** All KV-dependent functions now have try-catch fallback handling:

| Function | On KV Failure |
|----------|---------------|
| `checkRateLimit()` | Returns `allowed: true` (allows request) |
| `trackGeneration()` | Returns 0, allows request |
| `isUserBlocked()` | Returns `false` (allows request) |
| `getMarketAssassinAccess()` | Returns `null` (free tier) |
| `getAbuseRecord()` | Returns 0 |
| `getFlaggedUsers()` | Returns empty array |

**Key Files:**
- `src/lib/rate-limit.ts` — Rate limiting with KV fallback
- `src/lib/abuse-detection.ts` — Abuse tracking with KV fallback
- `src/lib/access-codes.ts` — Access checks with KV fallback

**Monitoring:**
```bash
# Check KV usage in Vercel Dashboard → Storage → KV → Usage
# Logs show: "[RateLimit] KV unavailable for..." when quota exceeded
```

**Prevention:**
- Free tier: 500K requests/month, 10K commands/day
- Consider upgrading to Pro ($10/mo) for 10M requests/month
- KV quota resets on the 1st of each month

---

## Email Template Standard

- **Footer branding:** "GovCon Giants AI"
- **From address:** `hello@govcongiants.com`
- **Support email:** `service@govcongiants.com`
- **Phone:** 508-290-6692
- **Include:** activation link, "Manage preferences", "Unsubscribe"

---

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SMTP_USER=hello@govcongiants.com
SMTP_PASSWORD=...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

---

## 🔔 Pending Tasks

### Batch Enroll Bootcamp Attendees (April 12-19, 2026)

**Status:** Daily alerts confirmed working at scale. **Eligible audience = 1,540** as
of Jul 11, 2026 (`alerts_enabled=true` AND `alert_frequency IN (daily,weekdays,weekends)`;
alerts_enabled total 1,669) — free-daily is the permanent model. **Jul 11 cap fix (PR
#113, `d34ddd8a`):** the eligibility query silently returned only the first 1,000 PostgREST
rows → ~540 subscribers never processed; now paginated via `.range()` across the dispatcher
window (confirmed live — `processed` climbs past 1,000, sends 931–1,044/day). Capacity:
`DAILY_ALERT_BATCH_SIZE=250` × ~21 dispatcher runs = ~5,250/day; 1,540 drains in ~7 runs
(bump batch toward ~500 only when eligible nears ~3,000). 8,803 bootcamp attendees already
invited (last batch May 21). Remaining enroll batches can proceed.

**Action:** Enroll 8,804 bootcamp attendees from `data/bootcamp-attendees-to-enroll.txt`

```bash
# Run this after verifying alerts are working
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://getmindy.ai/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

**Source:** All GHL contacts with any "bootcamp" tag (contract-vehicles-bootcamp, jan31-bootcamp, feb-proposal-bootcamp, etc.)

---

## JTED 2026 Presentation & Guide

**Event:** AEC Industry Day at MacDill AFB — April 1, 2026

### Presentation
- **File:** `presentations/JTED-2026-Revised.html` (98 slides)
- **PowerPoint:** `presentations/JTED-2026-Compressed.pptx` (8MB, image-based)
- **Export script:** `node presentations/export-slides-compressed.js`
- **Status:** Complete with QR code

### Companion Guide (Complete)
- **Intel Pack PDF:** `presentations/JTED-2026-Intel-Pack.pdf`
- **Slides PDF:** `presentations/JTED-2026-Slides.pdf`
- **Landing page:** `govcongiants.com/jted-2026` (deployed)
- **GHL tag:** `jted-2026-landing`

### Key Files
| File | Purpose |
|------|---------|
| `presentations/JTED-2026-Revised.html` | 98-slide HTML source |
| `presentations/JTED-2026-Compressed.pptx` | PowerPoint (8MB) |
| `presentations/JTED-2026-Intel-Pack.pdf` | Companion guide |
| `presentations/export-slides-compressed.js` | JPEG export + PPTX |

---

## Sales Attribution (June 2, 2026 — PR #5)

getmindy.ai purchases feed a **unified cross-site dashboard** hosted at `govcongiants.com/admin/purchases`, alongside govcongiants.com sales. Both write to the same shared Upstash store (`market-assassin-codes`) with an identical key format.

- **`src/lib/purchase-attribution.ts`** — `@vercel/kv`-backed; key builder + `gfd:purchase:purchases` index-member format (`<site>:<id>`) MUST stay in sync with `govcon-funnels/src/lib/purchase-attribution.ts`.
- **`src/components/AttributionTracker.tsx`** — in root layout; writes the shared `gca_attr` cookie (first/last touch, UTM, click-ids).
- **`src/app/checkout/[product]/route.ts`** — maps Mindy Pro monthly/annual links, records a `CheckoutStart`, forwards `client_reference_id`.
- **`src/app/api/stripe-webhook/route.ts`** — ONE non-fatal `savePurchase()` call inside the existing `checkout.session.completed` handler (after Supabase dedup, before access provisioning). Joins `client_reference_id` → stored attribution. Do NOT move it before access provisioning.
- **Env:** `PURCHASE_SITE=mindy` (set in Vercel); KV vars already present (this project owns the store).

---

## Full-text search + global lookup (June 11, 2026)

The "biggest challenge" fix — **titles lie; the body has the truth.** Four-corpus search
+ a header lookup bar. (See memories `sam_description_body_capture`, `market_research_invalid_naics`.)

### Body-text capture (descriptions were EMPTY cache-wide)
SAM's `/search` list endpoint returns `description` as a LINK (`…/noticedesc?noticeid=`),
not text. The sync stored the link → every `sam_opportunities.description` was empty →
body search matched nothing.
- `src/lib/sam/notice-description.ts` — resolves the link → plain text (HTML-stripped, NUL-safe).
- `/api/cron/backfill-descriptions` — batched/resumable, dispatcher-fired (uses prod SAM key
  server-side; LOCAL key 400s on noticedesc). 2 jobs: active + `?inactive=1`. Drains rows
  where description is null/a-link.
- `sync-sam-opportunities` OMITS `description` from the upsert (was storing the link + would
  clobber backfilled text on re-sync). New notices insert NULL; backfill fills within minutes.

### Search (mi-dashboard) — 4 corpora + archive + word-boundary
`src/app/api/mi-dashboard/route.ts` `buildSearchOr()`:
- Searches **title + description + sow_text + department** (sow_text = the extracted SOW/PWS).
- **Word-boundary** for code-like terms ("M7" ≠ "M776") via Postgres `\m..\M` `imatch` regex;
  ILIKE substring for phrases.
- **`?status=active|inactive|all`** — search the archive (~59k inactive notices). Default active.
- **Active search ESCAPES the profile-NAICS/states filter** (two `.or()` calls AND together in
  PostgREST → keyword search was trapped inside the user's codes). Default view = profile-scoped;
  explicit search = full corpus. Explicit `?naics=`/`?state=` still apply.

### Global lookup bar (`src/components/app/GlobalLookup.tsx`)
In the `/app` header (members-only). Resolves three identifier types:
- **Contract number (PIID)** → `AwardDetailDrawer` (reuses `/api/app/award-detail?piid=`).
- **Company name / UEI** → `/api/contractors/search-bq` → navigate to `/contractors/[slug]`.
- UEI checked before PIID (12-char collision). Focus hint lists the three types.

### Contractor search bug (was returning 0 for everything)
`queryCached` (`src/lib/bigquery/cache.ts`) DEFAULTS to `cacheOnly: true` — returns `[]` on a
cache miss to protect public/unauthed traffic from cold BQ scans. `searchRecipients` never set
`cacheOnly: false`, so the in-app Contractors panel + lookup returned 0 despite 317K rows. Fix:
`searchRecipients({ liveBq: true })` threads `cacheOnly: !liveBq`; the authed `search-bq` route
passes `liveBq: true`. Also: name-search now matches exact UEI too. Diagnostic: `/api/admin/bq-health`.

## Launch ops + onboarding (June 10-11, 2026)

(See memory `mindy_launch_ops_jobs`.) Three dispatcher jobs + onboarding keyword capture:
- **`setup-invite-batch`** (50/day) — drains the 723 entitled-but-no-login beta users. Shared
  `src/lib/mindy/account-setup.ts` (`sendSetupInvite`). Email is Mindy navy→purple (NOT green).
- **`zero-alert-nudge`** (50/day) — sharp re-onboarding to prefilled-profile users getting 0
  alerts (88% of zero-alerts = placeholder NAICS, not a matching failure). Diagnosis:
  `/api/admin/zero-alert-diagnosis`.
- **`snapshot-metrics`** (daily) — `daily_metric_snapshots` table → dashboard trend charts
  (`/api/admin/metric-trends` + `MetricTrends.tsx`, recharts).
- **Onboarding** persists the user's REAL keywords (was dropping them) + ends at the Vault
  (`?panel=vault`). Save route REPLACES naics_codes (overwrites prefilled sweeps).
- **Semantic keywords from UEI** — `src/lib/market/semantic-keywords.ts` derives keywords by
  MEANING from past-perf + capabilities + NAICS titles (reuses `embeddings.ts` embedText+cosine,
  JSONB no-pgvector); seeds alerts additively + Vault teaching moment. (Memory `semantic_keywords_from_uei`.)
- **Dashboard:** MI→Mindy label rename; "Custom NAICS" is DISPLAY-ONLY, never a send gate.
  All emails rebranded green→navy/purple (kept urgency/score traffic-light colors).
- **Account menu** at bottom of sidebar (Settings/Switch/Sign out) — fixes unreachable
  sign-out on mobile (`h-dvh` + footer `shrink-0`). One sign-in surface (landing routes to /app).
- **Homepage** (`/mindy-landing`, NOT `/app` — getmindy.ai/ host-rewrites there; memory
  `getmindy_url_routing`): demo-driven rebuild — Vimeo reels (9:16), live-proof numbers, real
  top-board chips. **2FA toggle REMOVED** (it enforced nothing — decorative).

## SEO crawl health + dependency security (June 24, 2026)

**GSC check** (`npx tsx scripts/seo-report.ts`, sc-domain:getmindy.ai via `GCP_SA_JSON`): 28d clicks 191 (+3,083%), impressions 34K (+14,274%), avg pos 13.4 (from 41.2) — exploding off a tiny base. Standout: contract-number (PIID) searches like `19aqmm21f1496` pull big impressions at pos 2-3 but ~0 CTR; the `/awards/[id]` title ALREADY leads with the contract number to close that gap (prior fix). Contractor/agency/index meta templates already strong — no rewrites warranted (unlike govcongiants).

**robots.txt `/_next/` fix** (`636f4629`, `src/app/robots.ts`): the blanket `/_next/` disallow blocked all JS/CSS chunks → GSC flagged ~1,140 "Blocked by robots.txt". Added more-specific `Allow: /_next/static/` + `/_next/image` (Google matches most-specific rule) so Googlebot can render. Verified live.

**Sitemap 404s**: GSC showed 1,683 "Not found (404)" (Jun-13 crawl) — already fixed in main (BigQuery-sourced sitemap + `SUBPAGE_MIN_ROWS` thin-content gating). Live sitemap = 37,863 URLs, bad slugs absent. Stale GSC data will clear on re-crawl. Obsolete branch `fix/sitemap-404s-from-bigquery` can be deleted (superseded by gate-thin-subpages).

**Dependency security** (`bfe6fc28`): `npm audit` 47 vulns (2 critical, 10 high) → 24 (0 critical, 6 high).
- `jspdf` ^4.0.0→^4.2.1 (CRITICAL, direct), `next` 16.1.1→16.2.9 (HIGH, direct, non-major).
- `overrides` for runtime transitives: `fast-xml-parser` ^5.9.3 (CRITICAL, nested 5.2.5 via aws-sdk/gcloud), `axios` ^1.18.1 (via twilio), `ws` ^8.21.0 (via supabase realtime), `form-data` ^4.0.6.
- **Avoided `npm audit fix`** (wanted +81/−54 package churn + breaking @anthropic-ai/sdk).
- **xlsx** (`^0.18.5`, no npm fix): the `proposal/upload` route is 2FA-gated (`requireMIAuthSession`) → parser unreachable unauthenticated; other xlsx callers are admin/cron. Acceptable residual.
- **Remaining 6 highs** are dev/build-only (basic-ftp via puppeteer, flatted, minimatch, picomatch) or admin-only `nodemailer` (7.0.12; full fix needs breaking v9 — deferred follow-up).

---

*Last Updated: June 24, 2026 — SEO crawl health + dep security: robots.txt now allows /_next/static + /_next/image (was blocking all JS/CSS → ~1,140 "Blocked by robots.txt"); 1,683 sitemap 404s already fixed in main (BigQuery-sourced, re-crawl pending); meta templates already optimized (PIID-in-title on /awards/[id]). npm audit 47→24 vulns, 0 critical: jspdf 4.2.1 + next 16.2.9 + overrides (fast-xml-parser/axios/ws/form-data); xlsx upload is 2FA-gated; nodemailer v9 (breaking) deferred. See "SEO crawl health + dependency security" section. Prev Jun 11 (PM) — Full-text search overhaul: bodies were EMPTY cache-wide (SAM returns description as a link; sync stored it) → notice-description lib + backfill-descriptions crons (active+inactive). 4-corpus search (title+description+sow_text+department), word-boundary ("M7"≠"M776"), Active/Inactive/All archive toggle, active-search escapes profile-NAICS filter. Global lookup bar (/app header): contract#→award detail, company/UEI→/contractors/[slug]. FIXED contractor search returning 0 (queryCached cacheOnly default → searchRecipients now liveBq:true; restored Contractors panel). Launch ops: setup-invite-batch + zero-alert-nudge + snapshot-metrics dispatcher jobs; onboarding persists real keywords + ends at Vault; semantic-keywords-from-UEI; emails green→navy/purple; sidebar account menu (mobile sign-out fix); demo-driven homepage (/mindy-landing, Vimeo reels); 2FA toggle removed (decorative). See "Full-text search + global lookup" + "Launch ops + onboarding" sections. Prev: Free alert email phased messaging (30-day setup nudges → Welcome/FREE forever; `profile-setup.ts`). Opportunity detail CTAs: profile setup before Pro upsell. SAM attachment real filenames (`SamAttachmentLinks`, metadata API; sync cron preserves attachment metadata). Prev Jun 8: Keyword-first market research (NAICS is the wrong primary key; "drones"=70+ codes, obvious code=28%/miss 72%; keyword auto-derives 90%-coverage NAICS; PSC=what's-bought lesson; Market Coverage banner; phrase-resilient; onboarding grounds day-1 codes so alerts aren't broken). Email send guard (#58 — global per-recipient daily cap + suppression, fixes 12-emails/day churn; emailType audit). Award Intelligence spine (award-detail + incumbent intel woven through task orders / Expiring Contracts / bid-no-bid / My Pursuits / Today's Intel), office contact rosters (#16, DoDAAC-decoded), Vault POC fields, SOW export tables, active-first pursuit picker, pipeline next-action + dedup, LLM cost discipline (gpt-4o-mini reasoning + $15 cap), quarterly data-refresh cron (honest stamp). See "Keyword-first market research" + "Award Intelligence + Office Rosters" sections. Prev Jun 3: Daily alerts free-daily permanent (DAILY_ALERT_BETA). Jun 2: purchase attribution → unified sales dashboard. May 20: OAuth custom domain (auth.getmindy.ai), Proposal Assist V2, mi-beta → app rename, session TTL 30d*

---

## Mindy MCP Server — Phase 1 platform: billing / auth / transport (SHIPPED 2026-07-12)

A hosted, **credit-metered** MCP server (`mcp.getmindy.ai`) exposing Mindy's GovCon
intelligence to any MCP agent, with a self-serve dashboard at **`getmindy.ai/mcp`**.
All of Phase 1 is merged to `main` + every migration run & verified live (PRs #118–128).

**Slices shipped:** keys → edge auth → tool registry → **atomic credit ledger** →
**hybrid credits** (top-ups + Pro monthly allowance) → **hosted metered HTTP transport**
→ data-core tools → dashboard. `_ai_hint` gated OFF by default (data-first — see below).

**The billing model:**
- **Free 100 credits on a user's FIRST connect** (first key OR first keyless OAuth connect; `grantSignupCreditsIfFirst`, env `MCP_SIGNUP_CREDITS`, default 100 as of 2026-07-13; re-minting can't farm — gated on "no balance row yet"). One-time B2B trial (≈ one real evaluation), NOT a recurring grant.
- **Debit-on-success only, atomic.** `runMeteredTool` (`src/lib/mcp/metered.ts`) pre-checks balance → runs the tool → debits on success / **0 on failure**; zero-balance is rejected with a top-up message before the tool runs.
- **Atomicity is in Postgres**, not app code: `mcp_debit_credits` / `mcp_grant_credits` / `mcp_apply_credit` — the `UPDATE … WHERE balance >= amount RETURNING` (and `INSERT … ON CONFLICT DO NOTHING`) ARE the gates. 100 concurrent debits can't corrupt the balance (verified live); balance never < 0.
- **Top-ups are exactly-once** by Stripe session id; **Pro monthly** allowance is exactly-once by `pro:<email>:<YYYY-MM>` — both via `applyCreditOnce` → `mcp_apply_credit`.

**⚠️ THE BILLING SEAM (do not break):** the hosted HTTP edge MUST dispatch tool calls
through **`runMeteredTool`**, NOT raw `runMcpTool`. Raw dispatch = tools run for free.
Any new transport/entry point bills only if it goes through `runMeteredTool`.

**Corpus extraction guard (Layers A+B, `src/lib/mcp/extraction-guard.ts`):** protects ONLY
the proprietary tools (`PROPRIETARY_TOOLS` in `tool-registry.ts`: winning-playbook, podcast-
lessons, sblo-contact, federal-osbp) from bulk export — the public-data wrappers stay ungated.
Layer A = free signup credits can't buy proprietary calls (needs PAID standing: a ledger row
with reason `stripe_topup`/`pro_monthly`/`admin_grant`). Layer B = per-account rolling caps
(`MCP_PROPRIETARY_CAP_DAY`=40 / `_WEEK`=150). Wired in `runMeteredTool` right after the tier
gate. **Both flag-gated + default OFF** (`MCP_EXTRACTION_GUARD`); with `MCP_EXTRACTION_ENFORCE`
OFF it's **LOG-ONLY** (writes `shadow_requires_paid`/`shadow_throttled` call-log rows, call
still runs) so you measure impact before enforcing. FAIL-OPEN: a guard-query error allows the
call (never blocks a payer). No migration — `mcp_call_log.status` is unconstrained TEXT.
Rollout: run log-only → read the shadow rows → set caps to the 99th pct of real use → enforce.

**Key files:**
| File | Role |
|---|---|
| `src/lib/mcp/api-keys.ts` | issue/verify/revoke; stores sha256(key) only, shown once |
| `src/lib/mcp/auth.ts` | `authenticateMcpRequest` (Bearer / X-Mindy-API-Key → identity) |
| `src/lib/mcp/tool-registry.ts` | catalog + dispatch + `TOOL_CREDITS` (the tool source of truth) |
| `src/lib/mcp/credits.ts` | `getBalance`/`grantCredits`/`debitCredits`/`applyCreditOnce`/`logCall` |
| `src/lib/mcp/metered.ts` | `runMeteredTool` — the billing wrapper (the seam) |
| `src/lib/mcp/packages.ts` | server-trusted credit packages + `PRO_MONTHLY_CREDITS` |
| `src/lib/mcp/stripe-topup.ts` | `handleMcpCreditTopup(session)` — wired into `api/stripe-webhook` |
| `src/app/mcp/[transport]/route.ts` | hosted HTTP transport (verifyApiKey → runMeteredTool) |
| `src/app/mcp/page.tsx` + `src/app/api/mcp/account/route.ts` + `api/mcp/keys` | dashboard + its APIs |
| `src/app/api/cron/grant-mcp-pro-credits/route.ts` | monthly Pro-allowance grant (idempotent) |
| `src/app/api/admin/mcp-credits/route.ts` | admin grant/read (test credits pre-Stripe) |

**DB tables (all hand-run + verified live):** `mcp_api_keys`, `mcp_credit_balance`,
`mcp_credit_ledger`, `mcp_call_log`, `mcp_credit_topups`, `mcp_external_cache`
(migrations `20260712_mcp_*`). All RLS service-role-only.

**Still Eric's (config, not code):** claim `mcp.getmindy.ai` in Vercel → Domains ·
create Stripe credit products/links (`type=mcp_credit_topup, package=starter|plus|scale`)
+ set final $/credits in `packages.ts` · add the `grant-mcp-pro-credits` monthly cron row
· live click-through (mint key → connect Claude Desktop → call a tool → confirm the debit).

**Multi-session build note:** Phase 1 was built across parallel Claude sessions. Sharing
ONE working tree + `.git` entangled commits (a push carried another session's commit).
Fix + rule: **each concurrent session gets its own `git worktree`** — "separate branches"
alone does NOT isolate a shared `.git`. (Memory: the worktree collision + recovery.)

---

## Mindy MCP Server — Data Core tools (2026-07-12)

The Mindy MCP server exposes Mindy's proprietary + live-API intelligence to any AI agent.
Two transports wrap the **same transport-agnostic pure functions** (`src/mcp/tools/*.ts`):
- **stdio** (`src/mcp/server.ts`) — local dev + smoke (`npm run mcp:dev` / `npm run mcp:smoke`).
- **Hosted HTTP edge** (`src/app/mcp/[transport]/route.ts`) — dispatcher `src/lib/mcp/tool-registry.ts`,
  API-key auth + credit metering (Phase-1 Slice 2/3). `mcp.getmindy.ai` target.

**Tools live (4):** `get_winning_playbook` (proprietary RAG corpus — the moat), `get_pricing_intel`
(GSA CALC labor rates, promoted existing client), `get_incumbent_financials` (SEC EDGAR — public filers
only, private→`grounded=false` honest miss), `get_regulatory_demand` (Federal Register — "demand before SAM"
leading indicator). Credit prices in `TOOL_CREDITS`: playbook=1, pricing_intel=1, incumbent_financials=2,
regulatory_demand=1.

**Tool pattern (follow exactly — `winning-playbook.ts` is the reference):**
- Pure async fn `(input) → Result`. NO transport, NO auth, NO `console.log` (stdout is the MCP wire;
  diagnostics → `console.error`). Both transports wrap it → zero rework.
- `Result` carries `_meta: { grounded, degraded, <counts> }` — **ALWAYS ships** (machine-readable;
  the edge/agent branches on it). `grounded` = ≥1 real row returned; `degraded` = upstream *errored*
  (distinct from a genuine empty result — surface, don't swallow, via catch + `console.error`).
- `_ai_hint: { summary, how_to_use, key_caveats }` — **OPTIONAL, OFF by default** (data-first principle,
  Eric 2026-07-12: the raw grounded DATA is the moat; nothing narrated ships until explicitly enabled).
  Gate it: `if (mcpFlags.aiHint) result._ai_hint = buildHint(...)` (`mcpFlags.aiHint` reads
  `MCP_ENABLE_AI_HINT`, OFF by default; smoke sets it to exercise the layer).
- **No-fabrication contract:** `buildHint` branches `degraded → grounded → else` (the three-way ternary).
  When `!grounded && !degraded`, the hint MUST say "no data found" and instruct the agent NOT to invent.
  Every fact in a grounded hint must trace to the returned data (smoke asserts traceability). Never map a
  record to a NAICS/set-aside the source doesn't carry (Federal Register has NO NAICS tag — say so; do NOT
  invent one). EDGAR: no gov-vs-commercial revenue breakout unless the filer volunteers a segment.

**Shared response cache:** `mcp_external_cache` Supabase table (cache_key md5 UNIQUE, api_type,
query_params jsonb, response_data jsonb, fetched_at, expires_at, hit_count). `withCache<T>(apiType, params,
ttl, fetcher) → {value, fromCache}` in `src/lib/mcp/external-cache.ts` — degrades to no-cache on any error.
TTLs: EDGAR facts 24h / submissions 6h / tickers 24h; Federal Register 1h; CALC 12h. RLS service-role-only.

**Gotchas:**
- **GSA CALC is keyless and rate-limits per IP.** `fetchPricingIntel(naics)` fans out 5 parallel CALC calls
  (3 terms + 2 biz-size splits) → bursts past the limit on repeat runs. The client swallows 429s to `null`
  → tool reports `grounded=false, degraded=false` (indistinguishable from a genuine empty result). The smoke
  treats pricing-intel `grounded=false` as NON-FATAL for this reason (verified passing in a prior run); the
  permanent fix is the `mcp_external_cache` table (warm calls skip the fan-out). If pricing-intel stays
  grounded=false after CALC recovers, THAT's a regression.
- **SEC EDGAR requires `User-Agent: <name> (<contact email>)`** on every request (10 req/s ceiling). The
  client sends `Mindy-MCP-GovConGiants (<MCP_CONTACT_EMAIL or hello@govcongiants.com>)`. Public filers
  only — a private contractor name → no CIK match → `grounded=false` (do NOT invent financials).
- **Migrations are hand-run by Eric** (no auto-apply): `20260712_mcp_external_cache.sql` +
  `20260712_mcp_data_sources_seed.sql` (idempotent `ON CONFLICT DO UPDATE`). Verify live after running.

**Adding a new tool:** pure fn in `src/mcp/tools/<name>.ts` + client in `src/lib/<source>/` → register in
BOTH `src/lib/mcp/tool-registry.ts` (def + `listMcpTools`/`isMcpTool`/`runMcpTool` + `TOOL_CREDITS`) AND
`src/mcp/server.ts` (zod inputSchema) → add a `callTool` block to `scripts/mcp-smoke.mjs` (assert grounded +
traceability) → add a `data_sources` seed row + a `DatasetEntry` (provenance 'passthrough') in
`src/app/api/admin/data-inventory/route.ts` + a row in `docs/DATA-SOURCES-REGISTRY.md`.

---

## Mindy MCP Server — Keyless OAuth 2.1 (2026-07-13)

Agents connect to the hosted MCP transport by **signing in through their browser** —
no API key to copy. This is the DEFAULT connect path on `getmindy.ai/mcp`; API keys
still work and are demoted to a collapsed "Advanced — headless / CI" section.

**Gated OFF by default.** Every OAuth route 404s unless `MCP_OAUTH_ENABLED` is truthy
(`mcpFlags.oauth`, `src/lib/mcp/flags.ts` → `oauthGate()` in `src/lib/mcp/oauth/guard.ts`).
The feature can sit on prod exposing nothing until the flag is flipped. It is currently
**ON in prod** (verified: metadata endpoints 200, live smoke green, real Claude Desktop
pulled a solicitation).

**Flow (OAuth 2.1, public client, PKCE S256):**
DCR (`/oauth/register`, RFC 7591) → authorize consent (`/oauth/authorize` page →
`/api/oauth/authorize/approve`) → token (`/oauth/token`, authorization_code + refresh
rotation) → the MCP client calls `getmindy.ai/mcp/mcp` with a Bearer JWT. Discovery via
RFC 8414 (`/.well-known/oauth-authorization-server`) + RFC 9728 (protected-resource),
served through `next.config.ts` rewrites (Next won't serve `.well-known` folders).
Revoke = RFC 7009 (`/oauth/revoke`).

**Identity source:** the consent page reads the signed MI 2FA session
(`mi_beta_auth_token`), so the approver's email is the token identity — the same
server-verified path that fixed the /mcp 0-credits wrong-account bug
(`/api/mcp/session`). First OAuth connect gets the 100-credit welcome grant via
`grantSignupCreditsIfFirst` (can't be farmed — gated on "no balance row yet").

**Tokens (`src/lib/mcp/oauth/tokens.ts`):** stateless HS256 access JWTs, `aud`-bound to
`OAUTH_RESOURCE=https://getmindy.ai/mcp/mcp` (1h TTL); opaque hashed refresh tokens
(60d, rotated + revocable); single-use auth codes (5m). Signing secret =
`MCP_OAUTH_SIGNING_SECRET` (falls back to `ADMIN_PASSWORD` — dedicated env var is a
TODO). Persistence in `src/lib/mcp/oauth/store.ts` (atomic single-use code consume +
refresh rotation).

**⚠️ The billing seam still holds.** The transport verifier
(`src/app/mcp/[transport]/route.ts` `withMcpAuth`) tries `verifyAccessToken` (OAuth JWT)
first, then `verifyApiKey` — either way the call dispatches through **`runMeteredTool`**,
never raw `runMcpTool`. Keyless calls debit credits exactly like keyed ones. The transport
loops `mcpRegistrationList()` (`src/lib/mcp/tool-schemas.ts`) so **all tools** are
exposed (a prior bug exposed only 1 — caught by the live smoke; now 42, each carrying
read-only annotations — see the usage-visibility section below).

**Key files:** `src/lib/mcp/oauth/{tokens,store,guard}.ts`, `src/app/oauth/{register,token,revoke}/route.ts`,
`src/app/api/oauth/metadata/{authorization-server,protected-resource}/route.ts`,
`src/app/api/oauth/authorize/approve/route.ts`, `src/app/oauth/authorize/page.tsx`,
`src/app/api/mcp/session/route.ts` (server-verified identity), `src/app/mcp/page.tsx`
(keyless 3-step UI). Migration: `supabase/migrations/20260713_mcp_oauth.sql`
(`mcp_oauth_clients` / `_codes` / `_tokens`, RLS service-role-only — hand-run + verified).
Smoke: `scripts/mcp-oauth-smoke.mjs` (DCR→authorize→token→keyless-call→refresh→negatives;
needs `MI_AUTH_TOKEN`).

**Parked:** PR #135 (GitHub OAuth for app sign-in — Apple already merged); add
`mcp.getmindy.ai` to the token `aud` allowlist once the subdomain is claimed; provision a
dedicated `MCP_OAUTH_SIGNING_SECRET`.

---

## Mindy MCP Server — usage visibility + tool grouping (2026-07-15, PR #247)

Three additive UX fixes (from Eric's Higgsfield comparison) so users can see spend
against balance and Claude Desktop groups the toolset. All verified live via
`mcp-oauth-smoke.mjs` against prod (42 tools, a priced call debited 1223→1221).

- **Usage panel** on `getmindy.ai/mcp` (`src/app/mcp/page.tsx`) — signed-in visitors get a
  panel at the top: current balance + recent call history (tool · status · credits · when),
  Refresh + Top up. Wires up the pre-existing `GET /api/mcp/account` (balance + last 20
  `mcp_call_log` rows) that nothing rendered before. Front-end only.
- **Balance IN THE CHAT** (Higgsfield-style) — the hosted transport appends a footer text
  block to every PRICED tool result: `Mindy credits: N remaining · this call used X`,
  escalating to a top-up nudge at ≤`LOW_BALANCE_THRESHOLD` (20) and at 0. Free tools
  (`get_balance`) emit no footer. `runMeteredTool` already returns the post-debit
  `balance`, so **NO billing change** — also mirrored into `structuredContent._meta.credits`.
  Helpers `creditFooter` / `prettifyToolName` live in `src/app/mcp/[transport]/route.ts`.
- **Read-only tool ANNOTATIONS** — tools carried no MCP annotations, so Claude Desktop
  dumped all 42 into one flat "Other tools" bucket. Every Mindy tool is a read-only
  intel/compute lookup (none mutate the user's account or any external system), so
  `mcpRegistrationList()` (`src/lib/mcp/tool-schemas.ts`) now tags EVERY entry
  `{ readOnlyHint:true, idempotentHint:true, openWorldHint:true }` + a Title-Case `title`,
  passed into `server.registerTool`. Result: one clean "Read-only tools (42) — Always
  allow" bucket. **⚠️ Guard:** any future MUTATING tool MUST override with
  `readOnlyHint:false, destructiveHint:true` so it doesn't hide in the always-allow group.

The billing seam is untouched — the footer/annotations wrap the SAME `runMeteredTool`
dispatch; nothing bills for free.

---

## Mindy MCP Server — account area + usage charts (2026-07-16, PRs #251–253)

The `/mcp` surface split into a **connect landing** and a dedicated **account area**,
mirroring the OpenAI Platform / Anthropic Console layout (Eric's "make it a settings
page, not a home page").

- **`/mcp`** = Connect only (hero + keyless connect card + examples). Signed-in users get
  a **balance chip → Account** in the nav (`McpNav` gained `signedIn`/`balance` + an
  `account` active state). No usage/billing machinery here anymore.
- **`/mcp/account`** (`src/app/mcp/account/page.tsx`) = left-rail console:
  **Usage** (balance · 7-day credits graph · KPI tiles · spend-by-tool) · **Activity**
  (raw call log) · **Billing** (top-up · plan · auto-recharge full controls · payment
  method · **billing history**) · **API keys** (create/label/revoke — first UI
  for the existing `/api/mcp/keys`) · **Settings**. Deep-links: `?section=<id>`,
  `?autorecharge=saved`.
- **Charts** live in `src/app/mcp/usage-charts.tsx` (`UsageKpis`/`UsageOverTime`/
  `SpendByTool`/`ActivityLog` + shared `shortWhen`/`statusStyle`). Magnitude-by-category →
  ONE emerald hue, direct-labeled, no per-tool rainbow. Pure CSS/SVG bars (no chart lib).
  The day chart gives each bar its own track so value/day labels never overlap.
- **`/api/mcp/account`** returns a 30-day `usage` rollup `{ windowDays, totalCredits,
  totalCalls, byTool[], byDay[], capped }` (additive); `shadow_*` guard rows excluded.
- **Auto-recharge** Stripe return URLs repoint to `/mcp/account?autorecharge=...`.

**⚠️ Two client-auth gotchas on the `/mcp` APIs** (both bit this work — memory
`getmiapiheaders-returns-headers-object`): (1) `getMIApiHeaders()` returns a **Headers
object** — spreading it (`{...getMIApiHeaders()}`) drops the auth token → 401; mutate it
in place. (2) `account`/`autorecharge` use token-only `resolveMcpEmail`, but `keys` uses
`requireUserAuth` which needs the email in **`?email=`** (or JSON body), NOT the
`x-user-email` header.

**Phase 2 (SHIPPED, PR #255):** Billing history — `GET /api/mcp/billing-history`
(token-only) lists every credit ADDITION (`mcp_credit_ledger` delta > 0) newest-first
as dated receipts (reason → friendly label; a "free" badge only on signup/admin grants).
**Credit-denominated, NOT dollars** — neither `mcp_credit_ledger` nor `mcp_credit_topups`
stores a USD amount, and a credit count is ambiguous between a one-time pack and a
subscription month; per-event USD would need capturing the amount at grant time (a later
enhancement).

**Extraction guard (2026-07-16):** flipped ON in prod in **log-only/shadow** mode
(`MCP_EXTRACTION_GUARD=true`, `MCP_EXTRACTION_ENFORCE` unset). Verified live. Next:
read `shadow_*` rows → set caps to p99 → enforce. (Memory: `mcp-extraction-guard-logonly`.)

---

## Location search for opportunities (2026-07-16)

"Find all contracts in Florida" didn't work — Mindy matched agency/NAICS/DoDAAC but not
location. Root cause is a DATA gap, not just a missing filter: `sam_opportunities.pop_state`
(place of performance) is only **~36% filled** (SAM omits it on ~64% of notices — and it's
absent from `raw_data` too, so it's unrecoverable), while `office_address->>state` (the buying
office) is **~100% filled**.

**Fix = match place-of-performance OR buying-office state** (2-letter codes; both columns are
uppercase 2-letter). Widens FL ~51–55% (1694→2553 all / 136→211 open).
- `normalizeStateCode()` (`src/lib/utils/us-states.ts`) — full name ("Florida") or code → `FL`.
- `search_sam_opportunities` (`src/lib/chat/tier1-tools.ts`, TIER1 → auto-exposed on MCP) gained a
  `state` param + returns `location: {pop_state, pop_city, office_state}`. Filter:
  `.or('pop_state.eq.FL,office_address->>state.eq.FL')`.
- `mi-dashboard` state filter broadened to both columns (explicit + profile `location_states`),
  now normalizes full names from the URL.
- **Honest label:** location = "performed in — OR bought by an office in — <state>", because pure
  place-of-performance is sparse in SAM. Don't present it as comprehensive PoP.
- `/api/admin/backfill-pop-state` exists but recovers **~0** (SAM genuinely lacks the data); kept
  as an honest, idempotent no-op that would catch future recoverable rows. The sync already reads
  `placeOfPerformance.state.code` for new rows — unchanged.

## Verification Recipes — how to PROVE each surface works (rule #2)

The concrete "it works" evidence, centralized so skills/agents stop re-deriving it.
"It compiles" ≠ "it works." A 200 with 0 rows is a FAIL, not a pass.

**Page is live:** `curl -s -o /dev/null -w "%{http_code}\n" "https://getmindy.ai<route>"` → 200 (3xx to login = OK for gated, note it; 404/500 = fail).

**API returns real data (not just 200):**
```bash
curl -s -o /tmp/v.json -w "%{http_code}\n" "https://getmindy.ai/api/<route>?<params>"
node -e 'const d=require("/tmp/v.json");const r=d.results||d.data||d.rows||d.items||d;console.log("rows:",Array.isArray(r)?r.length:JSON.stringify(r).slice(0,200))'
```

**Panel actually renders the data** (rendered rows == API rows): run `/verify-panel <name>`. Catches the facet-bug class (API 56, UI shows 3).

**Migration landed** (never trust "Success. No rows returned" alone):
```bash
npx tsx -e "import dotenv from 'dotenv';dotenv.config({path:'.env.local'});import {createClient} from '@supabase/supabase-js';const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);(async()=>{const {error}=await sb.from('<table>').select('<new_col>').limit(1);console.log(error?'❌ NOT applied: '+error.message:'✅ column exists');})();"
```

**Cron is registered** (it's a `cron_jobs` row, NOT vercel.json; dispatcher ticks HOURLY so `*/10` really fires ~once/hr):
```bash
npx tsx -e "import dotenv from 'dotenv';dotenv.config({path:'.env.local'});import {createClient} from '@supabase/supabase-js';const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);(async()=>{const {data}=await sb.from('cron_jobs').select('name,cron_expression,last_run,active').eq('active',true);console.table(data);})();"
```

**Env var is in prod:** `vercel env ls production | grep -i <VAR>`.

**Backfill/drainer progress:** run `/backfill-status` (drained vs stalled vs progressing).

**Full deploy proof (all of the above for what a ship touched):** run `/verify-prod`.

### The screenshot-debug decision tree (the 386-turn loop)
A number/label on screen looks wrong → diagnose in THIS order before touching a component:
1. **Wrong DATA?** Query the source table/API, compare to screen. A "No X found" when data exists, or a stale figure = a **query/wiring bug** → fix the backend, don't mask it in the UI. (Most "still shows X" loops are this.)
2. **Stale CACHE?** DB is right but screen is old → fix the cache layer (KV / last-good / SWR), not the component.
3. **UI RENDER?** Data is right, presentation wrong → the component. Apply standing UI standards (counts at top · names not codes · chips clickable · spinner on load · legible contrast · vertical bars · no dead empty-state · jargon defined).
Then: `/ui-fix` (render) → `/verify-panel` (prove) → `/ship` → `/verify-prod`. Or hand the whole loop to the **fix-and-ship** agent.
