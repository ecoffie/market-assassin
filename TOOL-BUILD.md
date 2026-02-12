# GovCon Giants - Tool Build Roadmap

Master feature list and development roadmap for all GovCon tools. This file consolidates all planned enhancements, to-do items, and future features.

---

## Table of Contents
- [Federal Market Assassin](#1-federal-market-assassin)
- [Recompete Contracts Tracker](#2-recompete-contracts-tracker)
- [Opportunity Hunter / Opp Scout Pro](#3-opportunity-hunter--opp-scout-pro)
- [GovCon Content Generator](#4-govcon-content-generator)
- [Federal Contractor Database](#5-federal-contractor-database)
- [Action Planner Dashboard](#6-action-planner-dashboard)
- [LinkedIn Lead Magnet](#7-linkedin-lead-magnet)
- [30-Day Certification Program](#8-30-day-certification-program)
- [General Platform Tasks](#9-general-platform-tasks)

---

## 1. Federal Market Assassin

**Current:** $297 Standard (4 reports) / $497 Premium (8 reports)

### Must-Have (Launch Readiness)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Rate Limiting & Abuse Detection | HIGH | Pending | Limit 50 queries/day/user, 5/hour/IP. Flag suspicious activity (100+ generations). Use express-rate-limit or Vercel built-in. Add `abuse_score` column. |
| RLS & JWT Hardening | HIGH | Pending | Add JWT expiration check + auto-refresh. Add `WITH CHECK` for all write policies. |
| Pagination & Infinite Scroll | HIGH | Pending | 50 per page + lazy load. Use TanStack Table. Add loading spinner. |
| Error Handling & User Feedback | MEDIUM | Pending | Try-catch on all fetches + toast library. "Try again" button on failures. |
| Mobile Responsiveness | MEDIUM | Pending | Tailwind responsive classes. Test on iPhone/Android. |

### High-Value Adds

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| AI Win Probability Score | HIGH | Pending | Score 1-100% based on user profile (NAICS, certs, location). Color badges: green 70%+, yellow 50-70, red <50. Use Groq/OpenAI. |
| Teaming Recommendation Engine | HIGH | Pending | Suggest 3-5 primes per report based on subcontracting needs. Include draft outreach email. |
| Location Optimization | MEDIUM | Pending | "Near Me" filter (user ZIP) + Proximity Score. Haversine formula for distance. |
| Agency Gap Analysis | MEDIUM | Pending | Show agencies with unmet small biz goals (e.g., "DoD under 3% SDVOSB spend"). |
| Custom Alerts | MEDIUM | Pending | User sets NAICS/agency watchlists. Weekly email with new data + scores. Supabase Edge Function + cron. |
| Proposal Prep Starter | LOW | Pending | One-click "Start Proposal" button. Export key data + AI outline prompt. Integrate with AI Proposal Toolkit. |

### Future Polish (Post-Launch)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Ghosting Intel | MEDIUM | Pending | Competitor weaknesses, past loss reasons. AI summary from FPDS data. Add "Ghost Report" button. |
| Historical Trends Graphs | LOW | Pending | Agency spend charts, win rate visuals. Chart.js integration. |
| User Notes & Sharing | LOW | Pending | Private notes per report + shareable team links. Supabase notes table. |
| Tool Integrations | LOW | Pending | Link to Opportunity Scout, Content Generator, CRM export (Salesforce/HubSpot). |
| Expand Agency Pain Points Database | MEDIUM | Pending | Add more pain points per agency in `src/data/agency-pain-points.json`. Cross-tool priority — feeds Market Assassin, Content Generator, and Opportunity Hunter. |

### Simulated Data Elimination

Tracking all instances of hardcoded/simulated data that should be replaced with real figures.

| # | Location | Issue | Fix | Priority |
|---|----------|-------|-----|----------|
| 1 | SpendingTrendChart.tsx:83-95 | Hardcoded Q4 multipliers `[0.85, 0.90, 0.95, 1.30, 0.88, 0.92]` | Replaced with real FY2025 vs FY2026 budget data from `budgetComparison` prop | **DONE** |
| 2 | generate-all/route.ts:450-482 | Mock `$10M` agency spending fallback when no `selectedAgencyData` | Removed mock fallback — returns empty report with "re-run search" message | **DONE** |
| 3 | find-agencies/route.ts:818-920 | Static DoD command expansion distributes spending by formula | Added `isEstimated: true` flag on all expanded agencies, "Est." badge in UI | **DONE** |
| 4 | planner/resources/page.tsx:30-62 | 5 placeholder YouTube video IDs | Replace with real video IDs (needs Eric's videos) | HIGH |
| 5 | command-info.ts:441-631 | Generic "OSBP Director" contacts for DoD commands | Build real SBLO database from SAM.gov | MEDIUM |
| 6 | command-info.ts:838-868 | DoD spending distribution formula `budget * 0.15` etc. | Marked with `isEstimated: true` — distribution formula labeled, not hidden | **DONE** |
| 7 | generate-all/route.ts:527-551 | Generic forecast recommendations with no real forecast URLs | Populate real forecast URLs from command databases | LOW |

---

## 2. Recompete Contracts Tracker

**Current:** $397 (one-time)

### Must-Have (Launch Readiness)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Pagination & Loading | HIGH | Pending | Shows all 6,925 contracts = slow. Add 25-50 per page. Use TanStack Table or simple JS pagination. |
| Advanced Filtering & Search | HIGH | Pending | Multi-select NAICS, range sliders for value, sort by total value/due date. Fuse.js for fuzzy search. |
| Export Options | HIGH | Pending | CSV, PDF, Excel. Use js-xlsx for Excel, html2pdf for PDF. Add "Export Filtered Results" button. |
| Mobile Responsiveness | MEDIUM | Pending | Stats cards stack poorly. Use `grid-cols-1 md:grid-cols-5`. |
| Error Handling & Data Freshness | MEDIUM | Pending | Friendly error message + retry. Add "Last Updated" badge. |
| Security & Abuse Prevention | HIGH | Pending | Limit exports (5/day for non-Pro). Watermark PDF exports with user email. |
| **Location Feature** | HIGH | Pending | Add location filtering capability. |

### High-Value Adds

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| AI Win Probability Score | HIGH | Pending | Score each recompete 1-100% based on NAICS, certs, location, incumbent weakness. |
| Teaming Suggestions | HIGH | Pending | 3-5 primes per recompete. Include draft outreach email. |
| Custom Alerts | MEDIUM | Pending | NAICS/agency watchlists. Daily/weekly email with new recompetes. |
| Historical Trends Dashboard | MEDIUM | Pending | Past winners, average value, win rates. Agency overview tab with spend graphs. |
| Location Optimization | MEDIUM | Pending | "Near Me" filter + Proximity Score. Haversine formula. |
| Proposal Prep Starter | LOW | Pending | One-click "Start Proposal" per recompete. Export key data + AI outline. |

### Future Polish (Post-Launch)

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Ghosting Intel | MEDIUM | Pending | Competitor weaknesses, past loss reasons, win themes. "Ghost Report" button. |
| Set-Aside Gap Analysis | MEDIUM | Pending | Agencies with unmet small biz goals (e.g., "DoD under 3% SDVOSB spend"). |
| User-Contributed Notes | LOW | Pending | Private notes/tags per recompete. Saved in Supabase. |
| Integration Hub | LOW | Pending | Connect to Opportunity Scout and Market Assassin. |

---

## 3. Opportunity Hunter / Opp Scout Pro

**Current:** Free tier + $49 Pro

### Planned Features

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Pain Points Feature | HIGH | Pending | Add agency pain points analysis. |
| Expand Agency Pain Points Database | MEDIUM | Pending | More pain points per agency in `src/data/agency-pain-points.json`. Shared data source with Market Assassin and Content Generator. |
| CSV Export/Print | HIGH | Pending | Print results to CSV for offline use. |
| Enhanced Pro Features | MEDIUM | Pending | Differentiate Pro tier with advanced filters and data. |
| Agency Spending Analysis | MEDIUM | Pending | Deeper spending breakdown by NAICS. |
| Prime Contractor Matching | MEDIUM | Pending | Match user profile to relevant primes. |

---

## 4. GovCon Content Generator

**Current:** $197 Standard / $397 Full Fix

### Planned Features

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Post Originality & Variety | HIGH | Done | Shuffle pain points, inject random content lenses, anti-repetition instructions, higher temperature for angle generation. |
| Expand Agency Pain Points Database | MEDIUM | Pending | More pain points per agency in `src/data/agency-pain-points.json`. Shared data source with Market Assassin and Opportunity Hunter. |
| Advanced AI Templates | MEDIUM | Pending | More content styles and formats. |
| Scheduling Integration | LOW | Pending | Direct LinkedIn scheduling. |
| Analytics Dashboard | LOW | Pending | Track post performance. |

---

## 5. Federal Contractor Database

**Current:** $497 (one-time)

### Planned Features

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Enhanced Search | MEDIUM | Pending | More filter options. |
| Company Profiles | LOW | Pending | Detailed contractor profiles with history. |
| Teaming Match | LOW | Pending | AI-powered teaming suggestions. |

---

## 6. Action Planner Dashboard

**Current:** Included with purchases / standalone

### Must Complete

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Finish ACTION_PLANNER | HIGH | Pending | Complete all remaining functionality. |
| Phase Completion Tracking | MEDIUM | Pending | Visual progress indicators. |
| Resource Library Expansion | LOW | Pending | Add more videos and templates. |

---

## 7. LinkedIn Lead Magnet

### Must Complete

| Feature | Priority | Status | Notes |
|---------|----------|--------|-------|
| Finish LinkedIn Lead Magnet | HIGH | Pending | Complete the lead magnet implementation. |
| Integration with Email Sequence | MEDIUM | Pending | Connect to automated email follow-up. |

---

## 8. 30-Day Certification Program

**Planned:** $797 Early Bird / $997 Regular / $1,497 VIP

### Program Structure

A new certification program mapping to real BD job requirements ($80K-$150K+ roles).

### Modules (Mapped to Job Requirements)

| Module | Job Skills Covered | Week |
|--------|-------------------|------|
| Opportunity Identification & Qualification | SAM.gov, market intelligence tools | Week 1 |
| Market Research & Intelligence Analysis | Agency spending patterns, pain points | Week 1-2 |
| Teaming & Partnering Strategy | Partner identification, subcontracting | Week 3 |
| Proposal Development & Writing | Executive summaries, win themes | Week 3-4 |
| Relationship Building & Outreach | LinkedIn/email outreach | Week 2-3 |
| Compliance & Risk Assessment | CMMC, FAR requirements | Week 3 |
| Capture Planning & Win Strategy | Capture plans, competitor ghosting | Week 4 |

### What's Included
- Lifetime access to full GovCon Giants tool suite
- 30 days of job-ready training
- Official certification badge + LinkedIn certificate
- Directory listing (primes/agencies browse certified pros)
- Private community access

---

## 9. General Platform Tasks

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Add back GovCon Resources page | MEDIUM | Pending | Restore to website after update. |
| Data Protection (All Tools) | HIGH | Pending | Watermarks on exports, canary traps for scrapers. |
| Beta Testing Program | MEDIUM | Pending | 50-100 free users for feedback. |
| Integration Between Tools | LOW | Pending | Cross-tool data sharing and workflows. |
| **PSC-NAICS Crosswalk Integration** | HIGH | Pending | Bi-directional NAICS-PSC mapping so searches use both codes. SAM.gov solicitations often have wrong NAICS but correct PSC (or vice versa). One NAICS → 50+ PSCs. Build crosswalk from USAspending, dual-search in find-agencies, agencies/lookup, idv-search. See PSC-NAICS integration plan. |
| **FY2026 Budget / Legislation Integration** | HIGH | Pending | Pull enacted appropriations (Congress.gov), identify currently funded agencies (USAspending budget_authority), spending checkup chart (FY2025 vs FY2026), agency/sub-agency/command/office hierarchy. Focus on agencies with fresh FY2026 funding. See FY2026 budget plan. |

---

## Development Priorities

### Immediate (This Week)
1. Recompete Tracker: Pagination, exports, location feature
2. Market Assassin: Rate limiting, pagination
3. Finish Action Planner
4. Finish LinkedIn Lead Magnet

### Short-Term (2-4 Weeks)
1. PSC-NAICS Crosswalk Integration (cross-tool)
2. AI Win Probability Score (both tools)
3. Teaming Suggestions (both tools)
4. Custom Alerts system
5. Mobile responsiveness fixes

### Medium-Term (1-3 Months)
1. FY2026 Budget / Legislation Integration (budget checkup page, spending chart)
2. Historical trends dashboards
3. Ghosting Intel feature
4. Set-Aside Gap Analysis
5. Tool integrations
6. 30-Day Certification Program launch

---

## Monetization Notes

### Potential Pro Add-Ons
- AI Scoring + Teaming: $97 add-on
- Premium Alerts: $29/month
- Certification Program: $797-$1,497

### Price Increase Triggers
- After adding AI Win Score + Teaming to Recompete: $397 -> $497-$697
- After adding Ghosting Intel: Premium tier

---

*Last Updated: February 12, 2026*
