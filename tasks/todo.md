# GovCon Giants - Current Tasks

## Session State (March 17, 2026)

### Just Completed - Daily Health Check System ✅
- [x] Fixed alerts signup bug ("Failed to save alert profile")
  - Added `'free-signup'` to `isFreeSource` check
  - Removed invalid `source` column from upsert
  - Added lazy Supabase initialization
  - Commits: `97f99eb`, `63eeb92`
- [x] Built automated daily health check system
  - 12 tests across 5 categories (Critical Flows, Page Health, Data APIs, Access Control, Lead Capture)
  - Email alerts on failures
  - JSON/HTML output formats
  - Added to vercel.json cron (daily at 12:00 UTC)
  - Commit: `d2875bf`
- [x] Fixed Lead Capture test (invalid resourceId → `ai-prompts`)
  - Commits: `da554fe`, `89a9ab9`
- [x] **All tests passing: 12/12 (100% pass rate)**

### Health Check Access
```
HTML: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026&format=html
JSON: https://tools.govcongiants.org/api/cron/health-check?password=galata-assassin-2026
```

### Smart Profile System ✅ (Previous Session)
- [x] Designed smart user profile schema (40+ fields)
- [x] Created SQL migration for user_briefing_profile enhancements
- [x] Built SmartUserProfile TypeScript types and service
- [x] Created profile API endpoints (GET/POST /api/profile, /api/profile/track)
- [x] Integrated smart profiles into all briefing generators
- [x] **Ran SQL migration in Supabase** (fixed missing JSONB columns)
- [x] **Built profile onboarding UI** (`/profile/setup` - 5-step wizard)
- [x] **Built profile complete page** (`/profile/complete`)
- [x] **Created evaluation criteria** (`tasks/evaluation-criteria.md`)
- [x] **Fixed TypeScript build error** (added capabilityKeywords to BriefingUserProfile)
- [x] Pushed all fixes (commits: 8070d6f, e74fb7f, 393464b)

### Vercel Build Status ✅
- **Build succeeded**
- Pages live at:
  - `/profile/setup?email=test@example.com`
  - `/profile/complete?email=test@example.com`

### Next Tasks
1. **Test profile tracking** with real click interactions
2. **Record demo video** for /opp page

---

## Smart Profile System (NEW)

### Architecture
```
User clicks briefing item → /api/profile/track records interaction →
learn_from_click() updates clicked_naics[], clicked_agencies[] →
getBriefingProfile() returns topNaics, topAgencies (click-weighted) →
Briefing generators use weighted preferences for personalization
```

### Key Files
| File | Purpose |
|------|---------|
| `src/lib/smart-profile/types.ts` | SmartUserProfile, BriefingUserProfile interfaces |
| `src/lib/smart-profile/service.ts` | Profile CRUD, interaction recording, completeness |
| `src/app/api/profile/route.ts` | GET/POST profile management |
| `src/app/api/profile/track/route.ts` | Interaction tracking + email pixel |
| `src/lib/supabase/smart-profile-migration.sql` | Database schema ✅ RUN |
| `src/app/profile/setup/page.tsx` | 5-step onboarding wizard |
| `src/app/profile/complete/page.tsx` | Completion confirmation page |
| `tasks/evaluation-criteria.md` | QA checklist for all features |

### Profile Fields
- **Location**: state, zip_code, metro_area, geographic_preference
- **Business**: company_name, cage_code, company_size, annual_revenue
- **Certifications**: certifications[], set_aside_preferences[], verified_*
- **Capabilities**: capability_keywords[], past_performance_agencies[], contract_vehicles[]
- **Engagement**: engagement_score (0-100), briefings_opened, briefings_clicked
- **Learned**: clicked_naics[], clicked_agencies[], clicked_companies[], naics_weights{}

### Engagement Scoring
- Opens: +2 per open (max +20)
- Clicks: +5 per click (max +30)
- Inactivity: -2 per day after 7 days
- Range: 0-100

---

## Previous Session Work

### Session 26 - Contractor DB Briefing
- [x] Built Contractor DB briefing system
- [x] Types, data aggregator, email templates, generator
- [x] Admin endpoint: `/api/admin/generate-contractor-db-briefing`
- [x] Full and condensed formats

### Session 25 - Alert Pro
- [x] OH Pro now included with Alert Pro ($19/mo) purchase
- [x] Synced tools OH with shop version (email gate first)
- [x] Added weekly alerts auto-signup on email capture
- [x] Redesigned /opp landing page with visual storytelling

---

## Key Product Info

| Product | Price | Stripe ID | Payment Link |
|---------|-------|-----------|--------------|
| Alert Pro | $19/mo | `prod_U9rOClXY6MFcRu` | `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y` |
| Tool Pro | $49 | - | `https://buy.stripe.com/7sIaGqevYeIcdri147` |

---

## Backlog

### Profile Onboarding UI ✅ COMPLETE
- [x] `/profile/setup` wizard page
- [x] Step 1: Business basics (email, company name, CAGE, size)
- [x] Step 2: NAICS codes + capability keywords
- [x] Step 3: Target agencies (24 common agencies grid)
- [x] Step 4: Certifications + contract vehicles
- [x] Step 5: Geographic preferences (state, zip, preference)
- [x] Progress bar, save on each step
- [x] `/profile/complete` confirmation page

### Video Demo
- [ ] Record 2-minute demo video for /opp page
- [ ] Embed actual video (currently placeholder)

### Labor Rate Analytics MVP
- [ ] Scrape/import GSA CALC+ labor rate data
- [ ] Search by labor category
- [ ] Filter by contract vehicle
- [ ] Show min/median/max rates
- [ ] "Price to Win" calculator

### Auth System (CMMC Compliance)
- [ ] Build /login, /register, /forgot-password pages
- [ ] Add auth middleware to protect tool routes
- [ ] Migrate existing users
- [ ] Add MFA (TOTP) option

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume command:** `/continue`

**Last updated:** March 17, 2026 (Session 28)
