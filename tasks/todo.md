# GovCon Giants - Current Tasks

## Session State (March 12, 2026)

### Just Completed
- [x] Fixed Activate License flow - now checks all 3 sources (user_profiles, purchases, KV)
- [x] Added clickable tool links to activation page on govcon-shop
- [x] Fixed Market Assassin URL (/federal-market-assassin)
- [x] Created AUTH-STRATEGY.md - CMMC-compliant unified auth plan
- [x] Created PRODUCT-ROADMAP.md - compete with $50K GovWin

### Next Up: Labor Rate Analytics MVP
**Goal:** Build a labor rate search tool using GSA CALC+ data

**Data Source:** https://calc.gsa.gov/ (free public data)

**Features to Build:**
- [ ] Scrape/import GSA CALC+ labor rate data
- [ ] Search by labor category (e.g., "Senior Software Engineer")
- [ ] Filter by contract vehicle (OASIS+, Alliant 2, GSA MAS)
- [ ] Show min/median/max rates
- [ ] Regional adjustments
- [ ] Export to Excel
- [ ] "Price to Win" calculator

**Files to Create:**
- `/src/app/labor-rates/page.tsx` - Main search UI
- `/src/app/api/labor-rates/route.ts` - API endpoint
- `/src/data/labor-rates.json` - Cached rate data
- `/src/app/api/admin/build-labor-rates/route.ts` - Admin endpoint to refresh data

**Monetization:** Premium feature in Market Assassin Premium or standalone $197/year

---

## Backlog (Auth & Features)

### Auth System (CMMC Compliance)
- [ ] Build /login, /register, /forgot-password pages
- [ ] Add auth middleware to protect tool routes
- [ ] Migrate existing users (send "Set Your Password" emails)
- [ ] Add MFA (TOTP) option
- [ ] Add audit logging for auth events
- [ ] Build unified dashboard with single navigation

### Future Features
- [ ] Pipeline CRM (capture tracker with Shipley gates)
- [ ] Teaming Partner Network (contractor matching)
- [ ] AI Proposal Writer (RFP parsing, compliance matrix, win themes)

---

## Quick Reference

**Projects:**
- Market Assassin (tools): `~/Market Assasin/market-assassin`
- GovCon Shop (production): `~/govcon-shop`

**Resume command:** `/continue`

**Last updated:** March 12, 2026
