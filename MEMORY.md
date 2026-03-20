# Market Assassin - Session History

This file contains detailed session history for the Market Assassin project. For current project context, see [CLAUDE.md](./CLAUDE.md).

---

## Session 30 (Mar 20, 2026)

### Win Probability Scoring for Daily Briefings
- Added intelligent fit scoring to opportunity alerts (0-100%)
- New file: `src/lib/briefings/win-probability.ts`
- **6 scoring factors:**
  - NAICS Match (0-25 pts) — exact, prefix, or related
  - Set-Aside Eligibility (0-25 pts) — matches user certifications
  - Agency Experience (0-15 pts) — has past performance with agency
  - Contract Size Fit (0-15 pts) — within user's typical range
  - Capability Match (0-10 pts) — keywords match profile
  - Contract Vehicle (0-10 pts) — user holds required vehicle
- **Tiers:** excellent (75%+), good (60-74%), moderate (45-59%), low (30-44%), poor (<30%)
- Color-coded badges in email: green, lime, yellow, orange
- Shows fit summary for opportunities ≥45%
- Updated types in `src/lib/briefings/delivery/types.ts`

### Rate Limiting & Abuse Detection (Complete)
- **Report generation:** 50/day per user (email-based via KV)
- **Unauthenticated IPs:** 5/hour (stricter than 30/hour for authenticated)
- **Abuse thresholds:**
  - Warning: 100 generations (console log)
  - Flag: 250 generations (stored in `abuse:flag:{email}`)
  - Block: 500+ generations (blocks API access)
- **Admin endpoint:** `/api/admin/abuse-report`
  - `GET ?password=XXX` — view all flagged users
  - `GET ?password=XXX&email=X` — check specific user
  - `POST { action: "clear", email: "X" }` — clear flag after review
- **Auto-block:** `isUserBlocked(email)` check in `generate-all/route.ts`
- Updated `src/lib/rate-limit.ts` with `checkUnauthenticatedIPRateLimit()` and usage getters
- Updated `src/lib/abuse-detection.ts` with full flagging system

### Usage API Fix
- Replaced stub endpoints that returned hardcoded `limit: 999`
- Now returns real KV-based usage data
- Files fixed:
  - `/api/usage/route.ts`
  - `/api/usage/check/route.ts`
  - `/api/usage/increment/route.ts`

### Recompete Tracker Verification
- Confirmed all requested features already implemented:
  - Pagination (25/50/100/All selector)
  - CSV export with user email watermark
  - Excel export via SheetJS
  - PDF export with GovCon Giants branding
  - Location filtering (regions + state checkboxes + "Near Me")
  - Mobile responsive (3 breakpoints: 1024px, 768px, 400px)

### Action Planner Status Review
- Mostly complete, needs YouTube video IDs from Eric
- Weekly digest cron not yet configured in vercel.json
- Password reset email path incomplete

### LinkedIn Lead Magnet Status
- Separate project at `/Users/ericcoffie/Linkedin App`
- MVP complete (Profile Optimizer phase)
- Not part of Market Assassin codebase

### Commits
- `c7a3f9b` — Rate limiting, abuse detection, usage API fix

---

## Session 29 (Mar 18, 2026)

### Alerts Signup Bug Fix
- User reported "Failed to save alert profile" error from `/alerts/signup`
- **Root causes identified:**
  1. `source: 'free-signup'` wasn't recognized as free tier (only `'opportunity-hunter-free'` was)
  2. Upsert attempted to insert `source` column which doesn't exist in `user_alert_settings` table
- **Fixes applied to `src/app/api/alerts/save-profile/route.ts`:**
  - Added `|| source === 'free-signup'` to `isFreeSource` check
  - Removed `source` field from database upsert
  - Added lazy initialization for Supabase
- Commits: `97f99eb`, `63eeb92`
- Tested and confirmed working

### Daily Health Check System
- Built automated health check at `/api/cron/health-check`
- **12 tests across 5 categories:**
  - Critical Flows: Alerts Signup (Free), Profile API (GET), Profile Setup Page, Alerts Signup Page
  - Page Health: Homepage, Store, Opportunity Hunter
  - Data APIs: USASpending Proxy, Pain Points, Contractors
  - Access Control: Content Generator Access Denied
  - Lead Capture: Lead Capture API
- **Features:**
  - Password auth (`galata-assassin-2026`) or CRON_SECRET bearer token
  - JSON and HTML output formats
  - Email alerts on failures (to `service@govcongiants.com`)
  - Response time tracking
  - Critical vs non-critical test classification
- Added to `vercel.json` cron: `0 12 * * *` (daily at 12:00 UTC with `?email=true`)
- Commit: `d2875bf`

### Lead Capture Test Fix
- Initial test failed with "Invalid resource ID"
- Investigation revealed `/api/capture-lead` requires valid `resourceId` from `FREE_RESOURCES` list
- Fixed test to use `resourceId: 'ai-prompts'` instead of `source: 'health-check'`
- Commits: `da554fe`, `89a9ab9`
- **Final result: 12/12 tests passing (100% pass rate)**

### Health Check Access URLs
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

### Content Reaper Length Optimization
- Researched LinkedIn 2026 best practices (1,200-1,700 chars optimal)
- Updated all 11 templates with strict character/word limits
- Added 25+ additional AI filler patterns to strip
- Added `trimPost()` function for oversized posts
- Added `getPostMetrics()` for char/word counts
- Reduced Grok max_tokens from 2000 to 600
- Tested: Posts now 1,100-1,200 chars (status: `optimal`)
- Commit: `089537c`

### Key Files
| File | Change |
|------|--------|
| `src/app/api/alerts/save-profile/route.ts` | Fixed free-signup recognition, removed invalid column |
| `src/app/api/cron/health-check/route.ts` | NEW: Automated health check system |
| `vercel.json` | Added health-check cron job |
| `src/app/api/content-generator/generate/route.ts` | Updated templates with strict length limits |
| `src/lib/utils/humanize-post.ts` | Added trimPost(), getPostMetrics(), expanded filler patterns |

---

## Session 27 (Mar 17, 2026)

### Smart User Profile System
- Built personalized briefing system that learns from user behavior
- **40+ profile fields:** location, business, certifications, capabilities, engagement
- **Engagement scoring (0-100):** +2/open, +5/click, -2/day inactivity after 7 days
- **Learned preferences:** clicked_naics[], clicked_agencies[], clicked_companies[]
- **Weighted preference calculation:** topNaics, topAgencies, topCompanies

### Profile Service (`src/lib/smart-profile/`)
- `types.ts` — SmartUserProfile, BriefingUserProfile, ProfileUpdatePayload
- `service.ts` — getSmartProfile, updateProfile, getBriefingProfile, recordInteraction
- `index.ts` — exports

### API Endpoints
- `GET/POST /api/profile` — profile CRUD with completeness breakdown
- `GET/POST /api/profile/track` — interaction tracking + email open pixel

### UI Components
- `/profile/setup` — 5-step onboarding wizard
- `/profile/complete` — completion confirmation page

### Briefing Generator Integration
- Contractor DB, Market Assassin, Recompete generators now use smart profiles
- Fall back to explicit preferences if no click history

### Commits
- `d170aec`, `c396fca`, `8070d6f`, `e74fb7f`, `393464b`

---

## Session 26 (Mar 16, 2026)

### Contractor DB Briefing System
- Built full Contractor Database briefing matching Eric's intel format
- Module: `/src/lib/briefings/contractor-db/`
- Admin endpoint: `/api/admin/generate-contractor-db-briefing`
- Full and condensed formats

---

## Session 25 (Mar 16, 2026)

### Opportunity Hunter Redesign & Alert Pro Integration
- **OH Pro now included with Alert Pro** — purchasing $19/mo Alert Pro automatically grants OH Pro access
- Updated webhook (`stripe-webhook/route.ts`):
  - Sets `ospro:{email}` KV flag when Alert Pro purchased
  - Calls `updateAccessFlags(email, 'hunter_pro')` for Supabase
  - Alert Pro Product ID: `prod_U9rOClXY6MFcRu`
  - Alert Pro Price ID: `price_1TBXfuK5zyiZ50PBWbdLfZ3F`
  - Payment Link: `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y`

### Tools OH Synced with Shop Version
- Copied shop's email-gate-first flow to tools.govcongiants.org
- Flow: Show 3 agencies → email capture → show 10 agencies
- Added weekly alerts auto-signup on email gate submission
- Added dual upgrade options after email gate:
  - Alert Pro ($19/mo): Unlimited daily alerts + all agencies
  - Tool Only ($49): All agencies, weekly alerts only
- Alert confirmation banner shows "Weekly Alerts Activated"

### /opp Landing Page Visual Redesign
- Complete overhaul of govcongiants.org/opp
- Hero with browser chrome tool mockup showing interface preview
- "See It In Action" video demo section with placeholder
- Before/After comparison showing 4 pain points solved
- Sample alert email preview (realistic inbox look)
- Pricing comparison: Free tier vs Alert Pro ($19/mo)
- Market Assassin upsell section at bottom
- Deployed: commit `9da94d7`

### Key Stripe/Product Info
| Item | ID/URL |
|------|--------|
| Alert Pro Product | `prod_U9rOClXY6MFcRu` |
| Alert Pro Price | `price_1TBXfuK5zyiZ50PBWbdLfZ3F` |
| Alert Pro Payment Link | `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y` |
| OH Pro Payment Link | `https://buy.stripe.com/7sIaGqevYeIcdri147` |

### Product Hierarchy (Updated)
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 10 agencies, 5 opps/week alerts |
| Tool Pro | $49 one-time | All agencies, pain points, export, weekly alerts |
| Alert Pro | $19/mo | All agencies + unlimited daily alerts (includes Tool Pro) |

---

## Session 24 (Mar 15, 2026)

### Lindy Intelligence API
- Unified endpoint for Lindy AI automation
- `/api/lindy/intelligence?email=X` — returns briefings, recompetes, contractor activity, recommended actions
- `/api/lindy` — API documentation endpoint
- `/api/admin/send-test-briefing?email=X` — generates AND sends briefing email
- Recommended actions include: deadline alerts, content angles, competitor watch, outreach suggestions
- Data freshness metadata for polling optimization

### Commits
- `c09f164` — Lindy Intelligence API

---

## Session 23 (Mar 14, 2026)

### Multi-NAICS Support & Smart Sampling
- **Multi-NAICS input** — users can now enter comma-separated NAICS codes (e.g., "236, 238, 541511")
- Created `src/lib/utils/naics-expansion.ts`:
  - `parseNAICSInput()` — parse comma/space-separated input
  - `expandNAICSCode()` — expand prefix to all matching 6-digit codes (e.g., "236" → all 236xxx)
  - `expandNAICSCodes()` — batch expansion with deduplication
  - NAICS_DATABASE covers construction (23x), IT (51x), professional services (54x), admin (56x)
- Updated agency finder (`find-agencies/route.ts`) with smart sampling:
  - Two-pass fetch: 5K by Award Amount + 5K by Award Date
  - Deduplication by Award ID prevents double-counting
  - Multi-NAICS searches get 10,000 contracts total (vs 5,000 single)
- Updated `CoreInputForm.tsx` placeholder: "e.g., 236, 238320, 541511"

### Alert Profile Multi-NAICS
- Updated `save-profile/route.ts` to accept:
  - `naicsCodes[]` — direct array
  - `naicsInput` — comma-separated string
  - `pscCode` — expands via PSC→NAICS crosswalk
- All inputs merged and expanded before saving to `user_alert_settings`

### TypeScript Fix
- Fixed `auth.tier` error in `generate-all/route.ts`
- Changed to use `getMarketAssassinTier(email)` function instead

### Contract Query Analysis
- 541511 (IT): 12,795 total contracts → 39% coverage with 5K sample
- 8(a) set-aside: 729 contracts → 100% coverage
- Construction SB (multi-NAICS): 8,004 contracts → 62% coverage with 5K
- Smart sampling ensures both big contracts AND recent small awards captured

### Commits
- `db482e2` — Fix TypeScript error: use getMarketAssassinTier instead of auth.tier
- `edec40a` — Add multi-NAICS support with prefix expansion and PSC crosswalk
- `4f661e0` — Add multi-NAICS support to Market Assassin agency lookup
- `6e61cad` — Add smart sampling for agency recommendations

---

## Session 19 (Mar 8, 2026)

### Daily GovCon Intelligence Briefings
- Built complete briefings system for personalized daily intel emails
- Web intelligence pipeline with FPDS health monitoring + SAM.gov fallback
- Briefing generation using Groq API, scheduled delivery via Vercel cron
- Cost analysis: ~$2.85/user/month at scale

### Federal Help Center Integration
- FHC $99/mo membership now auto-grants MA Standard + Daily Briefings
- Stripe webhook handles new subscriptions (`checkout.session.completed`)
- Subscription cancellation revokes access automatically
  - Listens to `customer.subscription.deleted` and `customer.subscription.updated`
  - Revokes `access_assassin_standard`, `access_briefings` in Supabase
  - Deletes `ma:{email}`, `briefings:{email}` from KV
- FHC Product IDs: `prod_TaiXlKb350EIQs` (39 active), `prod_TMUmxKTtooTx6C` (8 active)
- Total: 47 FHC members, $4,623 MRR

### Email System Fixes
- Fixed purchase confirmation emails - now routes to correct template per product
- New email templates created:
  - `sendContentReaperEmail()` - Content Reaper access
  - `sendRecompeteEmail()` - Recompete Tracker access
  - `sendBundleEmail()` - Bundle purchases with all tool links
  - `sendFHCWelcomeEmail()` - FHC welcome with MA + Briefings info

### Admin Endpoints
- `/api/admin/sync-fhc-members` - Pull FHC subscribers from Stripe, grant access
- `/api/admin/grant-briefings` - Batch grant briefings to MA Standard users
- `/api/admin/user-audit` - Check duplicates, bundle mismatches, cleanup redundant flags
- `/api/admin/fpds-health` - FPDS API health monitoring and testing

### Access Control Updates
- Added `access_briefings` flag to user_profiles
- Added `briefings:{email}` KV key
- Bundle access updated:
  - Pro Giant ($997): includes 1 year briefings
  - Ultimate ($1,497): includes lifetime briefings
- Premium includes Standard (redundant Standard flags cleaned up)

---

## Session 18 (Feb 21, 2026)

### Free Resource Pages
- Fixed all 8 free download pages with correct `checkoutUrl` pointing to resource files
- Added email gate to `ProductPageAppSumo` for free resources (captures leads to Supabase)
- Expanded `/free-resources` page from 5 to 11 resources

### Store Page Fixes
- Content Reaper link corrected
- Agency count updated from 175 to 250

---

## Session 17 (Feb 18, 2026)

### SAT Entry Point Analysis
- Zero extra API calls - SAT (≤$250K) and micro (≤$10K) computed during existing award aggregation
- Agency type fields: `satSpending`, `satContractCount`, `microSpending`, `microContractCount`
- Market Assassin Premium: Entry Points tab with `satFriendlinessScore` (0-100)
- Opportunity Hunter: blurred SAT teaser with Market Assassin upgrade CTA

### FY2026 Budget Data
- Expanded from 23 to 47 toptier agencies
- 175-entry sub-agency parent map (218/250 agencies resolve, 87%)

### AgencySelectionTable
- 5 sort mode pills
- "Easy Entry" badge for agencies with >50% SAT spending

---

## Session 16 (Feb 15, 2026)

### Agency Pain Points System
- Built comprehensive pain points database: 250 agencies, 2,765 pain points, 2,500 spending priorities
- Admin endpoint: `/api/admin/build-pain-points`
- Public API: `/api/pain-points`
- Used by Content Reaper, Market Assassin, and Opportunity Hunter

---

## Session 15 (Feb 12, 2026)

### Market Assassin Premium Reports
- Added 4 additional premium reports (8 total vs 4 standard)
- Entry Points analysis
- Competitive landscape
- Budget authority integration

---

## Session 14 (Feb 9, 2026)

### Content Reaper Enhancements
- Bulk export to .docx and .zip
- 30 posts per generation
- 250 agency support
- Content calendar feature

---

## Session 13 (Feb 6, 2026)

### Opportunity Hunter Pro
- Agency spending analysis
- NAICS targeting
- Pro tier ($49) with advanced filters

---

## Session 12 (Feb 3, 2026)

### Recompete Tracker
- Expiring contracts search
- Filtering by agency, NAICS, value
- Export functionality

---

## Session 11 (Jan 31, 2026)

### Federal Contractor Database
- 3,500+ contractors loaded
- SBLO contact information
- Search and filter functionality

---

## Session 10 (Jan 28, 2026)

### Action Planner
- 5 phases, 36 tasks
- Progress tracking
- PDF export with jsPDF

---

## Sessions 1-9 (Jan 2026)

### Foundation Work
- Initial Next.js setup with Turbopack
- Supabase integration
- Stripe payment flow
- Basic Market Assassin tool
- Content Reaper v1
- Email system with nodemailer
- KV access control system

---

*Last Updated: March 20, 2026*
