# Products, tools, pricing and launch operations

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

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

### 4. Recompete Tracker — **DISCONTINUED as a standalone product (2026-07-16)**
**Live surface:** the **Recompetes panel** in `/app` (`?panel=recompetes`), served by
`GET /api/recompete` → shared `queryExpiringContracts` (`src/lib/recompete/query.ts`).
**Sold as:** a **Pro feature** ("Recompete alerts, 12 mo out"). The public pricing page
sells Free/Pro/Teams only — there is **no $397 standalone** any more (Eric, "no that is gone").

- `/public/recompete.html` (the old $397 page) **308-redirects** to the panel
  (`next.config.ts`). It was live + ungated, serving `public/contracts-data.js` — a
  **Jun-22** snapshot, 9,450 grouped rows, **no UEI** — while the table holds 129,249 real
  rows (issue #303).
- **`public/contracts-data.js` must NOT be deleted** — `public/prime-lookup.html` still
  `<script src>`'s it and is live.
- Legacy access is intact **on purpose**: the `recompete:{email}` KV grant and the
  webhook's `recompete` tier mapping (`api/webhooks/stripe`) still work.
- ✅ Its Stripe payment link was **DEACTIVATED** in the dashboard (2026-07-17) — verified,
  the URL returns Stripe's "deactivated" page. Removing `stripeUrl` from `products.ts`
  only ever stopped US surfacing it; the dashboard was the actual kill. The product is
  fully retired: page redirects, code silent, link dead.

**Vehicle rollup (`src/app/api/recompete/route.ts`):**
Multiple-award IDIQs store N winner rows; we collapse them to ONE vehicle via
`recompeteVehicleKey` (IDV root + agency + NAICS — `src/lib/recompete/vehicle-grouping.ts`).
To group, the route pages the filtered set 1000 at a time (Supabase hard-caps responses
at 1000 rows) in a **sequential loop** bounded by **`GROUP_FETCH_CAP = 6000`**.

**⚠️ `pagination.total` is a FLOOR, not a global count.** Once the filtered set crosses
6,000 rows the cap truncates it, so the total under-counts — and the whole table is
129,249 rows, so any broad filter (no NAICS, `months=all`) hits it. `pagination.capped`
(added #302) is TRUE when this happens; **any UI showing the count MUST render "6,000+"
rather than a hard number** — otherwise it prints a confidently wrong figure, which is
the bug this table already had once (#301: "9,450 total in database").

*This paragraph previously described a head-count + `ceil(N/1000)` **parallel** page-read
design with a `SCAN_ROW_CAP = 20000`, and said the 6000 cap was "old". None of that is in
the code — no head-count, no parallel reads, no `SCAN_ROW_CAP`, and `GROUP_FETCH_CAP = 6000`
is still live. It was documented as fixed while the bug was still shipping. Corrected
2026-07-16; grep the route before trusting any of this.*

**Multi-NAICS (#302):** the shared `queryExpiringContracts` takes `naicsCodes?: string[]`
(OR across codes; `naics?: string` still works). `/api/recompete?naics=a,b` accepts
comma-separated. <6-char code = prefix (`naics_code LIKE '236%'`), 6-digit = exact.
Before this, comma-separated `naics` silently returned **0 rows** rather than erroring.

**Real per-contract data + hourly sync (Jul 16 — #280/#284, #288/#291):**
`recompete_opportunities` used to hold 9,388 rows that **were not contracts**:
`build-recompete-data` grouped awards on Recipient+Agency+NAICS and took the group's
EARLIEST end date, keeping one representative PIID — so a row's PIID and its expiry
date could describe **different contracts**, and none carried a UEI (93/9,481 = 0.98%).
Replaced with real per-contract rows from USASpending: **129,249 rows, 100% `incumbent_uei`**.
The grouped rows are flagged `quality_flag='grouped_synthetic'` (reversible; `query.ts`
already filters `quality_flag IS NULL`).

- **Sync lib:** `src/lib/recompete/usaspending-sync.ts`. Four endpoint constraints, each a
  silent-corruption trap: (1) `award_type_codes` must come from **ONE group** per request —
  mixing returns an **error**, not an empty set; (2) contracts vs IDVs have **different field
  schemas** — a contract field on an IDV query returns `undefined`, not an error; (3)
  `Type of Set Aside`/`Extent Competed`/`Number of Offers` return **NULL from this endpoint**
  no matter what — deliberately **not mapped**; (4) **no period-of-performance-end filter
  exists** (that `date_type` 500s their server) → the window is applied **client-side**.
  Running out of page budget reports `truncatedGroups` rather than a short list.
- **Full sweep:** `scripts/sync-recompete-full.ts` (dry-run default, resumable). 477 NAICS,
  ~38 min. NOTE: its summary prints `rows fetched` (this run) next to `written`
  (**cumulative from the resume file**) — different scopes, easy to misread.
- **Cron:** `/api/cron/sync-recompete-contracts`, `cron_jobs` row `25 * * * *`
  (`limit=40&budgetMs=240000`, `timeout_ms=290000`). Sweep is ~38 min vs Vercel's 300s cap,
  so each run drains NAICS under a **wall-clock budget** (not a fixed count — per-NAICS time
  is skewed 0.3s..65s). Ordered by `recompete_naics_by_staleness()` = least-recently-**ATTEMPTED**
  (`recompete_naics_sync`), **not** row freshness: a NAICS with no real contracts never gets a
  fresh row, so ranking by `MAX(last_synced_at)` pins it at the head forever and the cron spins
  on it. Every outcome is stamped (`ok`/`empty`/`truncated`/`error`) — stamping the **empty**
  ones is what keeps the queue moving. Truncated/failed shard → **non-2xx** = failed job.
- **`lead_time_months` was always wrong** until Jul 16: `EXTRACT(MONTH FROM AGE(...))` returns
  only the months component (0-11) and **discards the years** — a contract 18 months out stored
  `6`. `recompete_stats` buckets `expiring_6/12/18_months` off it, so those were wrong for as
  long as the trigger existed.
- **`recompete_changes`** (append-only): the sync upserts on `contract_id`, so every run
  **overwrites** the prior row, and USASpending serves only current state — no "as of" query.
  Any change not recorded **while it happens is gone permanently and cannot be backfilled at
  any price**. Tracks `period_of_performance_current_end`, `potential_total_value`,
  `incumbent_uei`. Diff is taken **before** the upsert (afterwards the old value is gone) and
  written **after** it succeeds. Callers MUST select every `TRACKED_FIELDS` column —
  `diffContracts` throws on an absent key rather than logging a phantom `null -> value`.

**Measured daily (#315):** `snapshot-metrics` records `recompete_changes_total` (the moat's
size) + `recompete_changes_new` (daily accrual) into `daily_metric_snapshots` → the trend
charts. **A flat `_total` across days is the ALARM** — an empty log because nothing drifted and
an empty log because the cron died look IDENTICAL, and unlike every other bug here, that one
cannot be repaired after the fact. You can re-run a query; you cannot re-run yesterday. Never
hand-type this figure into a doc (it went stale by morning three times on Jul 16).

**✅ FIXED — briefings now read the live table (#292 → #299).** They used to read
`@/data/contracts-data.json` (2.8 MB bundled at build, frozen **2026-04-08**, 9,450 grouped
records, **no UEI field**) as the **PRIMARY** source, shadowing the live path — it never
missed, so the stale data won *because* it was populated. `fpds-recompete.ts` now calls the
shared `queryExpiringContracts` (`src/lib/recompete/query.ts`) — the same lib the MCP
`get_expiring_contracts` tool uses, so the mirror rule holds by construction. Verified live:
**0/50 → 50/50** rows carry a real UEI. The same defect was then found on two MORE surfaces —
the in-app panel (#301 → #302) and the $397 page (#303 → #306). **Grep for the pattern, not
the instance:** a populated stale source beside a live one always wins.

**Still open:** `snapshot-recompetes` has **never run** (confirmed — no `cron_jobs` row, zero
`cron_job_runs`) though three docs claim "7:15 AM daily". The legacy USASpending fallback
(`usaspending-fallback.ts:418`) still doesn't request `'Recipient UEI'` and filters on
`date_signed` as a "proxy for expiring soon" — it only runs on a miss now, but it's still wrong.

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

> ⛔ **Pursuit Brief RETIRED 2026-09-28** (product decision, no replacement, no remediation). Sales copy + the save-path auto-request were removed (#1791); the generator, `precompute-pursuit-briefs` / `send-pursuit-fast` / `cron/pursuit-brief` crons, the orphan `api/opportunities/pursuit-brief` endpoint and the watchdog's pursuit checks were deleted in the follow-up dead-code PR. Historical pursuit briefs in `briefing_log` still DISPLAY (briefings page, DashboardPanel, `api/briefings/latest`). Pursuit references below are history — do not rebuild them.

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
Resend is the only provider (the Office 365 fallback was removed 2026-10-27; a Resend failure throws).
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
| `olga@olaexecutiveconsulting.com` | Olga Alcaraz |
| `louis.reed@reedasolutions.com` | Louis Reed |
| `jaisonsolutions@gmail.com` | Tabitha Ruffin |
| `aj@cypherintel.com` | Andre Jerry |

⚠️ **Register the account the advocate WORKS FROM, not their app signup.** Tabitha connects as
`jaisonsolutions@gmail.com`; her `tfeast15@gmail.com` signup holds the auth account and is NOT
where she works. Credits granted to the signup address sat unspent while the demo account ran
dry. Comp access and campaign exclusion only matter where the person actually is.

**John Simmons (`johnpalmer101@gmail.com`) is NOT an advocate** — a customer. AJ moved to
comp/testimonial 2026-07-19 and **back to advocate 2026-08-28**; he stays in
`campaign-exclusions.ts` too, which is additive (that list suppresses campaigns, this one
grants comp Pro).

**They exhaust the `PRO_MONTHLY_CREDITS` allowance inside a single demo session** (it was
250/mo at the time; 1,500/mo as of 2026-09-14 — read `packages.ts`, not this line) —
all four were topped up by hand in the week of 2026-08-24. Advocates doing live demos are
comped by design; the wall is not a conversion signal for them.

### Memberships
| Membership | Price | Includes |
|------------|-------|----------|
| Federal Help Center | $99/mo | MA Standard + Alert Pro + OH Pro (revoked on cancel) |

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

## Sales Attribution (June 2, 2026 — PR #5)

getmindy.ai purchases feed a **unified cross-site dashboard** hosted at `govcongiants.com/admin/purchases`, alongside govcongiants.com sales. Both write to the same shared Upstash store (`market-assassin-codes`) with an identical key format.

- **`src/lib/purchase-attribution.ts`** — `@vercel/kv`-backed; key builder + `gfd:purchase:purchases` index-member format (`<site>:<id>`) MUST stay in sync with `govcon-funnels/src/lib/purchase-attribution.ts`.
- **`src/components/AttributionTracker.tsx`** — in root layout; writes the shared `gca_attr` cookie (first/last touch, UTM, click-ids).
- **`src/app/checkout/[product]/route.ts`** — maps Mindy Pro monthly/annual links, records a `CheckoutStart`, forwards `client_reference_id`.
- **`src/app/api/stripe-webhook/route.ts`** — ONE non-fatal `savePurchase()` call inside the existing `checkout.session.completed` handler (after Supabase dedup, before access provisioning). Joins `client_reference_id` → stored attribution. Do NOT move it before access provisioning.
- **Env:** `PURCHASE_SITE=mindy` (set in Vercel); KV vars already present (this project owns the store).

---

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

*Last Updated: July 17, 2026 — The silent-failure sweep. **`count ?? 0` is data fabrication**: a table that does not exist returns `count=null, error=null, HTTP 204` — NO error — so `?? 0` turns "I don't know" into "zero" and destroys the only signal separating missing from empty. It cancelled a delete for five `vault_*` tables that never existed (names GUESSED from the feature, not read from the migration; real ones are `user_*`) and reported a clean 0 for months (#307); it recorded nine days of fake metrics in snapshot-metrics (190 emails erased). Now Bug Prevention Rule #11 + gate rule B (#309/#312). **The gate was blind on FOUR independent axes** — EXCLUDE skipped admin/cron/scripts (backwards: nobody reads a cron's stdout, so silent there is WORSE), SCAN_ROOTS never walked scripts/ at all, no count-null rule existed, and the walk matched only .ts/.tsx so every .mjs was invisible to BOTH rules (#311/#312/#314). Widening one axis proved nothing about the others — each fix found the next one still hiding. Baselined at 103; the ratchet blocks anything NEW. Two rule traps, both found by TESTING not assuming: strip comments (fixes now QUOTE the pattern while explaining it) and a bare /error/ token is NOT error handling (an auth guard's `{ error: 'Unauthorized' }` 5 lines up hid 5 sites). **The moat now counts itself** (#315): `recompete_changes_total`/`_new` snapshot daily — a FLAT total is the alarm, and that history cannot be backfilled at any price. Recompete chain all verified LIVE, not from green builds. Prev — Recompete real per-contract data + hourly sync. `get_expiring_contracts` returned `incumbent_uei: null` on EVERY row (93/9,481 = 0.98%); the 9,388 rows weren't contracts (grouped on Recipient+Agency+NAICS, group's EARLIEST end date, one representative PIID — so PIID and expiry could describe different contracts). Replaced with real USASpending per-contract rows: 129,249 rows, 100% UEI, 477/477 NAICS, zero truncation, ~38 min (#280 → PR #284). Grouped rows flagged `grouped_synthetic`. `lead_time_months` was ALWAYS wrong (EXTRACT(MONTH FROM AGE()) drops the years — 18mo stored as 6), so `recompete_stats` expiring_6/12/18 buckets were wrong for as long as the trigger existed. Then scheduled it: `/api/cron/sync-recompete-contracts` hourly via `cron_jobs` (sweep ~38min vs 300s cap → wall-clock-budget shards, ordered by least-recently-ATTEMPTED, not row freshness — a 0-contract NAICS pins the queue head forever otherwise), plus append-only `recompete_changes` (the sync overwrites on upsert and USASpending has no "as of" query, so unrecorded change = gone permanently) (#288 → PR #291). THEN FIXED the shadowing (issue #292, was "found, not fixed"): briefings never read `recompete_opportunities` at all — they read a frozen Apr-08 `contracts-data.json` (9,450 grouped rows, NO uei field) as PRIMARY, which shadowed the live path because it never missed. Briefings now use the shared `queryExpiringContracts` (#299 — verified live: 0/50 → 50/50 rows carry a real UEI). Same defect found on TWO more surfaces: the in-app Recompetes panel filtered a Jun-22 static file client-side and printed its length as "9,450 total in database" while `/api/recompete` sat unreachable behind an early return (#301 → #302; also added `naicsCodes?: string[]` to the shared query — profiles carry 3-5 codes, the lib took one; verified live 0 → 5,897); and the $397 Recompete Tracker page served the same snapshot, ungated — the product is DISCONTINUED (recompete is a Pro feature) so `/recompete.html` now 308s to the live panel (#303 → #306; its Stripe link is disabled manually — code can't). ⚠️ `public/contracts-data.js` must NOT be deleted: `prime-lookup.html` still loads it. CLAUDE.md's "truthful global count" paragraph described a head-count + PARALLEL page-read design with SCAN_ROW_CAP that DOES NOT EXIST — the route is a sequential loop still capped at GROUP_FETCH_CAP=6000, so `pagination.total` is a FLOOR (#304; `pagination.capped` flags it). Tooling: the five phantom skills CLAUDE.md told the model to run now exist, on `verify-live.mjs` (a 200 with 0 rows is a FAIL) + `db.mjs` (#296). Prev — Market spend reconciliation + one-shot tools. **ONE canonical market query** (`src/lib/market/spend-query.ts`) now shared by fpds-top-n + the market report — never hand-roll the filter (that split is what killed the Spending-by-Agency chart, #245). FIXED LIVE: fpds-top-n **404'd every dominant keyword** ("security guard" $6B / "janitorial" $1.9B / "roofing" $578M returned "No federal market found") — the gate's promised NAICS fall-through was never implemented; it uses the **LEAD code only** (roofing's coverage set dragged in 236220 → measured $77.7B of building construction, not $1.34B of roofing). FIXED LIVE: `topCodePct` measured the promoted LEAD not the biggest → report + Market Coverage banner rendered **"the biggest NAICS is only 0%"** for drones; split into `topCodePct` (biggest-by-$, DISPLAYED) vs `leadCodePct` (the ranking gate) — 8/10 keywords unchanged, hvac keeps 238220 specialty trade. Report gained `basis{}` + a **reconciliation line** ("336411 alone = $69M/28% vs $242.7M across 42 NAICS → misses 72%") — the answer to "your data is wrong". One-shot tools ALL 3 SHIPPED: market report + hosted `/reports/<id>` share link (#289), CRM push (#285/#286, BYO GHL — provision path DROPPED), calendar `include_ics` (#287, dated events only, never guessed). Pricing is **WIRED, not blocked** (that stale note cost a round-trip — grep `packages.ts` before stating a price). KNOWN/UNFIXED: keyword-coverage measures 1 FY vs the canonical 3 FY — a product decision (aligning moves "drones $243M"→$384M). See "Market spend: ONE shared query" + "One-Shot Composite Tools" sections. Prev Jun 24 — SEO crawl health + dep security: robots.txt now allows /_next/static + /_next/image; npm audit 47→24 vulns, 0 critical. Prev Jun 11 (PM) — Full-text search overhaul (bodies were EMPTY cache-wide), 4-corpus search, global lookup bar, contractor search 0-results fix, launch-ops crons, demo homepage. Prev Jun 8 — Keyword-first market research (NAICS is the wrong primary key; "drones"=70+ codes, obvious code=28%/miss 72%), Award Intelligence spine, office contact rosters, LLM cost discipline. Prev Jun 3 — Daily alerts free-daily permanent. Jun 2 — purchase attribution. May 20 — OAuth custom domain, mi-beta → app rename.

---
