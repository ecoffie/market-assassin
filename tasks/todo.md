# GovCon Giants - Current Tasks

## Session State (March 16, 2026)

### Just Completed
- [x] OH Pro now included with Alert Pro ($19/mo) purchase
- [x] Synced tools OH with shop version (email gate first)
- [x] Added weekly alerts auto-signup on email capture
- [x] Added dual upgrade options (Alert Pro $19/mo vs Tool Only $49)
- [x] Redesigned /opp landing page with visual storytelling
- [x] Deployed /opp to govcongiants.org (commit 9da94d7)
- [x] SMTP alerts@govcongiants.com working (security policy fixed)

### Key Product Info
| Product | Price | Stripe ID | Payment Link |
|---------|-------|-----------|--------------|
| Alert Pro | $19/mo | `prod_U9rOClXY6MFcRu` | `https://buy.stripe.com/8x24gA1oifvAcFv3OEfnO0y` |
| Tool Pro | $49 | - | `https://buy.stripe.com/7sIaGqevYeIcdri147` |

### Product Hierarchy
| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 10 agencies, 5 opps/week |
| Tool Pro | $49 one-time | All agencies, pain points, export, weekly alerts |
| Alert Pro | $19/mo | All agencies + unlimited daily alerts (includes Tool Pro) |

---

## Backlog

### Video Demo
- [ ] Record 2-minute demo video for /opp page
- [ ] Embed actual video (currently placeholder)

### Labor Rate Analytics MVP
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
- GovCon Funnels (marketing): `~/govcon-funnels`

**Resume command:** `/continue`

**Last updated:** March 16, 2026
