# GovCon Giants - Current Tasks

## Session State (March 16, 2026)

### Just Completed - Smart Profile System
- [x] Designed smart user profile schema (40+ fields)
- [x] Created SQL migration for user_briefing_profile enhancements
- [x] Built SmartUserProfile TypeScript types and service
- [x] Created profile API endpoints (GET/POST /api/profile, /api/profile/track)
- [x] Integrated smart profiles into all briefing generators:
  - [x] Contractor DB briefing generator
  - [x] Market Assassin briefing generator
  - [x] Recompete briefing generator
- [x] Pushed to GitHub (commits: d170aec, c396fca)

### Tomorrow's Priority Tasks
1. **Run SQL Migration** - Execute `src/lib/supabase/smart-profile-migration.sql` in Supabase
2. **Build Profile Onboarding UI** - New user profile setup wizard
3. **Test Smart Profile Learning** - Verify click tracking and preference weighting

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
| `src/lib/supabase/smart-profile-migration.sql` | Database schema (NOT YET RUN) |

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

### Profile Onboarding UI (NEXT)
- [ ] `/profile/setup` wizard page
- [ ] Step 1: Business basics (company name, CAGE, size)
- [ ] Step 2: NAICS codes (search/select)
- [ ] Step 3: Target agencies (checkboxes)
- [ ] Step 4: Certifications (multi-select)
- [ ] Step 5: Geographic preferences
- [ ] Progress bar, save on each step

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

**Last updated:** March 16, 2026 (Evening)
