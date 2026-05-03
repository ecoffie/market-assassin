# Unified GovCon Platform Architecture

## The Problem: Tool Fragmentation

**Current State:** Multiple overlapping tools, 2 tech stacks, confusing user experience

| Tool | Current Location | Tech Stack | Status | Future |
|------|------------------|------------|--------|--------|
| Market Assassin | tools.govcongiants.org/market-assassin | Next.js/Supabase | ✅ Live | → MI Pro |
| Opportunity Hunter | tools.govcongiants.org/opportunity-hunter | Next.js/Supabase | ✅ Live | → MI Free |
| Recompete Tracker | tools.govcongiants.org/recompete | Next.js/Supabase | ✅ Live | → MI feature |
| Contractor Database | tools.govcongiants.org/contractor-database | Next.js/Supabase | ✅ Live | → MI feature |
| Forecast Intelligence | tools.govcongiants.org/forecasts | Next.js/Supabase | ✅ Live | → MI feature |
| Market Scanner | tools.govcongiants.org/bd-assist (SCANNER tab) | Next.js/Supabase | ✅ Live | → MI feature |
| BD Assist Pipeline | tools.govcongiants.org/bd-assist | Next.js/Supabase | ✅ Live | → Execution tier |
| Action Planner | tools.govcongiants.org/planner | Next.js/Supabase | ✅ Live | → Execution tier |
| Daily Briefings | Email + Dashboard | Next.js/Supabase | ✅ Live | → MI Pro core |
| Weekly Deep Dives | Email | Next.js/Supabase | ✅ Live | → MI Pro core |
| Pursuit Briefs | Email + Dashboard | Next.js/Supabase | ✅ Live | → MI Pro core |
| **OpenGovIQ** | app.base44.com (separate) | **Base44 (no-code)** | ✅ Live | → Execution tier |

**The Issues:**
1. Users don't know which tool to use
2. Opportunity Hunter and Market Assassin overlap (same data, different depth)
3. No unified navigation
4. OpenGovIQ on separate platform (Base44)
5. Can't cross-reference data between tools
6. Selling "11 tools" vs "1 platform"

---

## Key Decision: OH + MA Consolidation

**Opportunity Hunter** and **Market Assassin** are the same product at different depths.

| Aspect | Opportunity Hunter | Market Assassin |
|--------|-------------------|-----------------|
| Job | Find opportunities | Understand your market |
| Data | SAM + Grants | Same + agency intel + spending |
| Price | Free | Paid |
| Role | Lead generation | Conversion |

**Decision:** Merge them into one product with tiers.

| Old Name | New Name | Access |
|----------|----------|--------|
| Opportunity Hunter | **MI Free** | Search, limited results, lead capture |
| Market Assassin | **MI Pro** | Full search + briefings + intel |

**Benefits:**
- One product name to market
- Clear upgrade path (Free → Pro)
- No confusion about "which tool"
- OH continues to drive leads, just under MI Free branding

---

## The Vision: One Platform, Three Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     GOVCON GIANTS PLATFORM                       │
│                    tools.govcongiants.org                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐│
│  │   INTELLIGENCE   │  │    EXECUTION     │  │   WHITE GLOVE    ││
│  │     (MI Layer)   │  │ (OpenGovIQ Layer)│  │  (Coach Layer)   ││
│  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤│
│  │ Daily Briefings  │  │ Pipeline/CRM     │  │ BD Coaching      ││
│  │ Weekly Deep Dive │  │ Proposal Manager │  │ Strategy Calls   ││
│  │ Pursuit Briefs   │  │ AI Workbench     │  │ Proposal Support ││
│  │ Market Assassin  │  │ Team Management  │  │ Market Research  ││
│  │ Opp Hunter       │  │ Automations      │  │ Custom Briefings ││
│  │ Recompete Tracker│  │ Email/Calendar   │  │ Account Manager  ││
│  │ Forecasts        │  │ Activity Logs    │  │                  ││
│  │ Contractor DB    │  │ Reporting        │  │                  ││
│  │ Market Scanner   │  │                  │  │                  ││
│  └──────────────────┘  └──────────────────┘  └──────────────────┘│
│         $149/mo              $167/mo             $5,000+/mo      │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    SHARED SERVICES                         │  │
│  │  • Unified Auth (Supabase)    • Single User Profile       │  │
│  │  • Shared Database            • Cross-tool Analytics      │  │
│  │  • Unified Navigation         • Single Billing            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Product Tiers (Unified)

### Tier 1: MI Pro - $149/mo
**"Know what to pursue"**

All intelligence tools:
- Daily AI Briefings (personalized bid targets)
- Weekly Deep Dives (market trends)
- Pursuit Briefs (opportunity analysis)
- Market Assassin (strategy research)
- Opportunity Hunter (search all opps)
- Recompete Tracker (expiring contracts)
- Forecast Intelligence (upcoming procurements)
- Contractor Database (competitors/partners)
- Market Scanner (6-question framework)

**Single user, full intelligence stack**

### Tier 2: MI + Execution - $316/mo ($149 + $167)
**"Know what to pursue AND execute on it"**

Everything in MI Pro, plus:
- Pipeline/CRM Management
- Proposal Manager (AI-generated)
- AI Workbench (private agents)
- Email/Calendar Integration
- Deadline Tracking
- Activity Logs

**Single user, full stack**

### Tier 3: Team - $1,000/mo (5 seats)
**"BD team intelligence + execution"**

Everything in Tier 2, plus:
- 5 user seats
- Team admin dashboard
- Shared pipeline views
- Per-user preferences
- Team activity feed
- Role-based access

**$200/seat/mo = $2,400/seat/year**

### Tier 4: Enterprise - $2,500+/mo
**"Organization-wide deployment"**

Everything in Team, plus:
- 15+ seats
- Custom AI agents
- Playbook automation
- SSO/SAML
- API access
- White-label reports
- Dedicated support

### Tier 5: White Glove - $5,000+/mo
**"Done-for-you BD"**

Everything in Enterprise, plus:
- Dedicated BD coach
- Weekly strategy calls
- Custom market research
- Proposal support
- Account manager

---

## Technical Architecture

### Current State (Fragmented)

```
Market Assassin (Next.js)          OpenGovIQ (Base44)
├── /market-assassin               ├── Entities (Contact, Pipeline, etc.)
├── /opportunity-hunter            ├── Automations
├── /recompete                     ├── AI Workbench
├── /forecasts                     ├── Email Integration
├── /contractor-database           └── Team Management
├── /bd-assist
├── /planner
└── /briefings

Supabase DB                        Base44 DB
├── opportunities                  ├── contacts
├── forecasts                      ├── conversations
├── contractors                    ├── pipeline_items
├── user_profiles                  ├── email_accounts
└── briefing_history               └── automations
```

### Target State (Unified)

```
tools.govcongiants.org (Next.js)
├── /dashboard          ← Home (daily briefings, key metrics)
├── /intelligence
│   ├── /briefings      ← Daily/Weekly/Pursuit
│   ├── /opportunities  ← Opportunity Hunter
│   ├── /recompetes     ← Recompete Tracker
│   ├── /forecasts      ← Forecast Intelligence
│   ├── /market         ← Market Assassin
│   └── /contractors    ← Contractor Database
├── /execution
│   ├── /pipeline       ← CRM/Pipeline (from OpenGovIQ)
│   ├── /proposals      ← Proposal Manager (from OpenGovIQ)
│   ├── /workbench      ← AI Agents (from OpenGovIQ)
│   └── /automations    ← Workflows (from OpenGovIQ)
├── /team               ← Team management (if Team tier)
└── /settings           ← Profile, preferences, billing

Supabase DB (Unified)
├── -- INTELLIGENCE --
├── opportunities
├── forecasts
├── contractors
├── briefing_history
├── market_research
├── -- EXECUTION (migrated from Base44) --
├── contacts
├── conversations
├── pipeline_items
├── proposals
├── email_accounts
├── automations
├── activity_logs
├── -- SHARED --
├── users
├── teams
├── subscriptions
└── analytics
```

---

## Migration Plan

### Phase 1: OpenGovIQ Export (Week 1-2)
**Goal:** Get all Base44 data and schemas out

1. Export Base44 entity schemas as JSON
2. Document all automations/workflows
3. Export all data via Base44 API or CSV
4. Map entities to Supabase tables

**Entities to migrate (from screenshot):**
- ActivityLog
- ApplicationMessageTemplate
- ApplicationSetting
- Automation
- AvailableLanguage
- CalendarEvent
- Comment
- Contact
- ContractVehicleAnalysisTask
- ContractVehicleSummary
- Conversation
- DataSource
- EmailAccount
- EmailMessage
- Feedback
- ForecastRequest
- (and more...)

### Phase 2: Supabase Schema (Week 2-3)
**Goal:** Create unified database

1. Create Supabase tables matching Base44 entities
2. Set up relationships (foreign keys)
3. Create indexes for performance
4. Set up Row Level Security (RLS)

### Phase 3: UI Migration (Week 3-6)
**Goal:** Rebuild OpenGovIQ screens in Next.js

1. Map Base44 UI components to existing MI components
2. Build Pipeline/CRM views
3. Build Proposal Manager
4. Build AI Workbench (integrate with existing AI)
5. Build Automation engine

### Phase 4: Unified Navigation (Week 6-7)
**Goal:** Single entry point, tab-based navigation

1. Create `/dashboard` home page
2. Build unified sidebar (Intelligence | Execution | Team | Settings)
3. Implement deep linking between tools
4. Add "Add to Pipeline" from any opportunity

### Phase 5: Data Migration (Week 7-8)
**Goal:** Move live data from Base44 to Supabase

1. Export all Base44 records
2. Transform to Supabase format
3. Import to production Supabase
4. Verify data integrity
5. Switch DNS / update auth

### Phase 6: Launch (Week 8-9)
**Goal:** Unified platform live

1. Beta with existing OpenGovIQ users (4 customers)
2. Fix any issues
3. Announce unified platform
4. Deprecate Base44 instance

---

## What We Keep vs What We Build

### Already Built (Keep As-Is)
| Component | Location | Status |
|-----------|----------|--------|
| Market Assassin | Next.js | ✅ Keep |
| Opportunity Hunter | Next.js | ✅ Keep |
| Recompete Tracker | Next.js | ✅ Keep |
| Forecasts | Next.js | ✅ Keep |
| Contractor DB | Next.js | ✅ Keep |
| Market Scanner | Next.js | ✅ Keep |
| BD Assist Pipeline | Next.js | ✅ Keep |
| Daily Briefings | Next.js | ✅ Keep |
| Weekly Deep Dives | Next.js | ✅ Keep |
| Pursuit Briefs | Next.js | ✅ Keep |
| Auth System | Supabase | ✅ Keep |

### Migrate from Base44
| Component | Base44 | Build in Next.js |
|-----------|--------|------------------|
| Contact/CRM | Entities | New pages |
| Pipeline Management | Entities | Enhance existing |
| Proposal Manager | AI features | New component |
| AI Workbench | Custom agents | New component |
| Email Integration | EmailAccount/Message | New service |
| Automations | Automation entity | Cron jobs |
| Activity Logs | ActivityLog | New table + UI |

### New Builds Required
| Component | Effort | Priority |
|-----------|--------|----------|
| Unified navigation shell | 2-3 weeks | P0 |
| Feedback loop (rate matches) | 1 week | P1 |
| Team seat management | 2 weeks | P1 |
| Proposal Manager UI | 2 weeks | P2 |
| AI Workbench UI | 2 weeks | P2 |
| Automation engine | 3 weeks | P3 |

---

## Pricing Comparison (Final)

| Tier | GovCon Giants | Deltek | Unanet |
|------|---------------|--------|--------|
| Entry (1 seat) | **$149/mo** | $1,083/mo | $208/mo |
| Full Stack (1 seat) | **$316/mo** | $2,500/mo | $500/mo |
| Team (5 seats) | **$1,000/mo** | $5,000/mo | $2,500/mo |
| Enterprise (15 seats) | **$4,167/mo** | $10,000/mo | $8,333/mo |

**Positioning:**
> "Enterprise GovCon intelligence at small business prices.
> Daily briefings Deltek doesn't offer. Private AI Unanet doesn't have.
> 50-80% less than the competition."

---

## Next Steps

### Immediate (This Week)
1. [ ] Export Base44 entity schemas
2. [ ] Document all Base44 automations
3. [ ] Count records per entity
4. [ ] Design unified navigation wireframe

### Short-term (Weeks 1-4)
1. [ ] Create Supabase migration tables
2. [ ] Build unified nav shell
3. [ ] Add feedback loop to briefings
4. [ ] Start Pipeline UI migration

### Medium-term (Weeks 5-8)
1. [ ] Complete OpenGovIQ UI migration
2. [ ] Build team seat management
3. [ ] Migrate live data
4. [ ] Beta test with existing customers

### Launch (Week 9)
1. [ ] Announce unified platform
2. [ ] Update pricing pages
3. [ ] Deprecate Base44
4. [ ] Pitch Laurie with full platform

---

## The Pitch

### The Problem (What They Know)

> "To win government contracts, you need 11 disconnected platforms:
> - **SAM.gov** for opportunities
> - **USASpending.gov** for award history
> - **FPDS** for contract data (now retired)
> - **GSA Calc** for pricing benchmarks
> - **Grants.gov** for grants
> - **Acquisition.gov** for forecasts
> - **Agency OSDBU sites** for contacts
> - **Google Sheets** to track everything
> - **Google Docs** for proposals
> - **Your inbox** for deadlines
> - **Prayer** that you don't miss something
>
> That's 11 tabs, 11 logins, and zero integration."

### The Solution

> "**Market Intelligence** brings it all together:
>
> - **Daily Briefings** tell you what to pursue today
> - **Market Research** shows you who's buying and why
> - **Pipeline** tracks your pursuits in one place
> - **AI** writes your proposals and responses
>
> One platform. One login. Everything a BD team needs."

### The Tiers

| Tier | What You Get | Price |
|------|--------------|-------|
| **MI Free** | Search opportunities (limited) | $0 |
| **MI Pro** | Full intelligence + daily briefings | $149/mo |
| **MI + Execution** | Intelligence + CRM + AI proposals | $316/mo |
| **MI Team** | 5 seats, shared pipeline | $1,000/mo |
| **MI Enterprise** | 15+ seats, API, white-label | $2,500+/mo |
| **White Glove** | Done-for-you BD + coaching | $5,000+/mo |

### The Comparison

> "Deltek GovWin costs $29,000/year average.
> Unanet costs $10,000+/year.
> We cost $1,788/year for MI Pro.
>
> Same intelligence. Daily briefings they don't offer.
> 80% less than Deltek. Built for small business."

---

*Last Updated: May 3, 2026*
