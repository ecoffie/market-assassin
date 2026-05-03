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

### Phase 1: OpenGovIQ Export & Discovery (Week 1-2)
**Goal:** Get all Base44 data and schemas out, understand what we're migrating

#### Week 1: Schema Export
| Task | Owner | Deliverable | Status |
|------|-------|-------------|--------|
| Login to Base44 admin panel | Eric | Access confirmed | ⬜ |
| Export all entity schemas as JSON | Eric | `base44-schemas.json` | ⬜ |
| Screenshot all entity relationships | Eric | `base44-erd.png` | ⬜ |
| Document field types per entity | Claude | `base44-field-mapping.md` | ⬜ |
| Count records per entity | Eric | Record counts table | ⬜ |

#### Week 2: Automation & Workflow Audit
| Task | Owner | Deliverable | Status |
|------|-------|-------------|--------|
| List all automations/triggers | Eric | `base44-automations.md` | ⬜ |
| Document automation logic (when/then) | Claude | Automation specs | ⬜ |
| Identify email templates | Eric | Template list | ⬜ |
| Map to Next.js equivalents (cron, API routes) | Claude | Migration mapping | ⬜ |
| Export sample data (10 records per entity) | Eric | `base44-sample-data/` | ⬜ |

**Entities to migrate (from Base44 screenshot):**

| Entity | Priority | Records (est.) | Supabase Table |
|--------|----------|----------------|----------------|
| Contact | P0 | ~500 | `contacts` |
| Pipeline (Opportunity) | P0 | ~200 | `pipeline_items` |
| Conversation | P0 | ~1,000 | `conversations` |
| EmailAccount | P1 | ~10 | `email_accounts` |
| EmailMessage | P1 | ~5,000 | `email_messages` |
| Automation | P1 | ~20 | `automations` |
| ActivityLog | P1 | ~10,000 | `activity_logs` |
| CalendarEvent | P2 | ~100 | `calendar_events` |
| Comment | P2 | ~500 | `comments` |
| Feedback | P2 | ~50 | `feedback` |
| ContractVehicleAnalysisTask | P2 | ~30 | `cv_analysis_tasks` |
| ContractVehicleSummary | P2 | ~100 | `cv_summaries` |
| DataSource | P3 | ~10 | `data_sources` |
| ApplicationSetting | P3 | ~50 | `app_settings` |
| ApplicationMessageTemplate | P3 | ~20 | `message_templates` |
| ForecastRequest | P3 | ~100 | `forecast_requests` |

---

### Phase 2: Supabase Schema Design (Week 2-3)
**Goal:** Create unified database with proper relationships

#### Core Tables (P0)
```sql
-- contacts: CRM contacts from OpenGovIQ
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  email TEXT,
  name TEXT,
  company TEXT,
  title TEXT,
  phone TEXT,
  linkedin_url TEXT,
  contact_type TEXT, -- 'prime', 'sub', 'agency', 'osdbu'
  tags TEXT[],
  notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- pipeline_items: Opportunity tracking
CREATE TABLE pipeline_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  opportunity_id TEXT, -- SAM.gov notice ID
  title TEXT NOT NULL,
  agency TEXT,
  value NUMERIC,
  stage TEXT DEFAULT 'tracking', -- tracking, pursuing, bidding, submitted, won, lost
  stage_changed_at TIMESTAMPTZ,
  due_date TIMESTAMPTZ,
  win_probability INTEGER,
  notes TEXT,
  contacts UUID[], -- linked contact IDs
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- conversations: Communication history
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  contact_id UUID REFERENCES contacts(id),
  pipeline_item_id UUID REFERENCES pipeline_items(id),
  channel TEXT, -- 'email', 'call', 'meeting', 'linkedin'
  subject TEXT,
  content TEXT,
  direction TEXT, -- 'inbound', 'outbound'
  conversation_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Execution Tables (P1)
```sql
-- email_accounts: Connected email accounts
CREATE TABLE email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  provider TEXT, -- 'google', 'microsoft', 'smtp'
  email TEXT NOT NULL,
  credentials JSONB, -- encrypted
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- automations: Workflow definitions
CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  trigger_type TEXT, -- 'stage_change', 'deadline', 'new_opp', 'schedule'
  trigger_config JSONB,
  action_type TEXT, -- 'email', 'task', 'notification', 'webhook'
  action_config JSONB,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- activity_logs: Audit trail
CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  entity_type TEXT, -- 'contact', 'pipeline', 'proposal'
  entity_id UUID,
  action TEXT, -- 'created', 'updated', 'deleted', 'stage_changed'
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### RLS Policies
```sql
-- Users can only see their own data
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own contacts" ON contacts
  FOR ALL USING (auth.uid() = user_id);

-- Team members can see team data (for Team tier)
CREATE POLICY "Team members see team data" ON contacts
  FOR SELECT USING (
    user_id IN (
      SELECT member_id FROM team_members
      WHERE team_id = (SELECT team_id FROM team_members WHERE member_id = auth.uid())
    )
  );
```

---

### Phase 3: UI Migration (Week 3-6)
**Goal:** Rebuild OpenGovIQ screens in Next.js

#### Week 3-4: Core CRM/Pipeline
| Component | Base44 Source | Next.js Location | Effort |
|-----------|---------------|------------------|--------|
| Contact List | Contacts entity | `/execution/contacts/page.tsx` | 2 days |
| Contact Detail | Contact view | `/execution/contacts/[id]/page.tsx` | 1 day |
| Pipeline Board | Pipeline entity | Enhance `/bd-assist` | 2 days |
| Pipeline Detail | Opportunity view | `/execution/pipeline/[id]/page.tsx` | 1 day |
| Activity Timeline | ActivityLog | `<ActivityFeed />` component | 2 days |

#### Week 5: Proposal Manager
| Component | Base44 Source | Next.js Location | Effort |
|-----------|---------------|------------------|--------|
| Proposal List | Proposals entity | `/execution/proposals/page.tsx` | 1 day |
| Proposal Editor | AI generation | `/execution/proposals/[id]/page.tsx` | 3 days |
| Template Library | Templates | `/execution/proposals/templates/page.tsx` | 1 day |
| Export (PDF/DOCX) | Export feature | API route + jsPDF | 2 days |

#### Week 6: AI Workbench
| Component | Base44 Source | Next.js Location | Effort |
|-----------|---------------|------------------|--------|
| Agent List | AI Workbench | `/execution/workbench/page.tsx` | 1 day |
| Agent Builder | Custom agents | `/execution/workbench/new/page.tsx` | 3 days |
| Document Upload | Knowledge base | `/execution/workbench/documents/page.tsx` | 2 days |
| Chat Interface | Agent chat | `<AgentChat />` component | 2 days |

---

### Phase 4: Unified Navigation (Week 6-7)
**Goal:** Single entry point, tab-based navigation

#### Navigation Structure
```
/dashboard                    ← Home (daily briefings, metrics, quick actions)
│
├── /intelligence             ← Intelligence layer (MI Pro)
│   ├── /briefings           ← Daily/Weekly/Pursuit
│   ├── /opportunities       ← Opportunity Hunter (search)
│   ├── /recompetes          ← Recompete Tracker
│   ├── /forecasts           ← Forecast Intelligence
│   ├── /market              ← Market Assassin (deep research)
│   └── /contractors         ← Contractor Database
│
├── /execution               ← Execution layer (MI + Execution tier)
│   ├── /pipeline            ← BD Assist Pipeline
│   ├── /contacts            ← CRM (from OpenGovIQ)
│   ├── /proposals           ← Proposal Manager (from OpenGovIQ)
│   ├── /workbench           ← AI Agents (from OpenGovIQ)
│   └── /automations         ← Workflows (from OpenGovIQ)
│
├── /team                    ← Team management (Team tier+)
│   ├── /members             ← Add/remove team members
│   ├── /activity            ← Team activity feed
│   └── /settings            ← Team preferences
│
└── /settings                ← User settings
    ├── /profile             ← NAICS, preferences
    ├── /billing             ← Subscription, invoices
    └── /integrations        ← Email, calendar connections
```

#### Sidebar Component
```tsx
// src/components/layout/UnifiedSidebar.tsx
const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: HomeIcon,
    tier: 'free'
  },
  {
    name: 'Intelligence',
    icon: LightBulbIcon,
    tier: 'pro',
    children: [
      { name: 'Briefings', href: '/intelligence/briefings' },
      { name: 'Opportunities', href: '/intelligence/opportunities' },
      { name: 'Recompetes', href: '/intelligence/recompetes' },
      { name: 'Forecasts', href: '/intelligence/forecasts' },
      { name: 'Market Research', href: '/intelligence/market' },
      { name: 'Contractors', href: '/intelligence/contractors' },
    ]
  },
  {
    name: 'Execution',
    icon: RocketIcon,
    tier: 'execution', // MI + Execution tier
    children: [
      { name: 'Pipeline', href: '/execution/pipeline' },
      { name: 'Contacts', href: '/execution/contacts' },
      { name: 'Proposals', href: '/execution/proposals' },
      { name: 'AI Workbench', href: '/execution/workbench' },
      { name: 'Automations', href: '/execution/automations' },
    ]
  },
  {
    name: 'Team',
    icon: UsersIcon,
    tier: 'team', // Team tier+
    children: [
      { name: 'Members', href: '/team/members' },
      { name: 'Activity', href: '/team/activity' },
    ]
  },
];
```

#### Dashboard Home Page
| Section | Content | Data Source |
|---------|---------|-------------|
| Today's Briefing | Top 3-5 opportunities | `briefing_templates` |
| Pipeline Summary | Stage counts, total value | `pipeline_items` |
| Upcoming Deadlines | Next 7 days | `pipeline_items.due_date` |
| Recent Activity | Last 10 actions | `activity_logs` |
| Quick Actions | Add opp, search, new contact | UI buttons |

---

### Phase 5: Data Migration (Week 7-8)
**Goal:** Move live data from Base44 to Supabase

#### Migration Script Structure
```javascript
// scripts/migrate-base44-to-supabase.js

const migration = {
  // Step 1: Export from Base44
  async exportFromBase44() {
    // Use Base44 API or CSV export
    // Save to /migrations/base44-export-YYYY-MM-DD/
  },

  // Step 2: Transform data
  async transformData() {
    // Map Base44 fields → Supabase fields
    // Handle foreign key relationships
    // Generate UUIDs for new records
  },

  // Step 3: Import to Supabase
  async importToSupabase() {
    // Insert in dependency order:
    // 1. contacts (no dependencies)
    // 2. pipeline_items (references contacts)
    // 3. conversations (references both)
    // 4. activity_logs (references all)
  },

  // Step 4: Verify
  async verifyMigration() {
    // Count records match
    // Spot check 10 random records
    // Verify relationships intact
  }
};
```

#### Migration Checklist
| Step | Task | Verification | Status |
|------|------|--------------|--------|
| 1 | Export Base44 contacts | Count matches | ⬜ |
| 2 | Export Base44 pipeline | Count matches | ⬜ |
| 3 | Export Base44 conversations | Count matches | ⬜ |
| 4 | Export Base44 activity logs | Count matches | ⬜ |
| 5 | Run transformation script | No errors | ⬜ |
| 6 | Import to Supabase staging | Counts match | ⬜ |
| 7 | Test UI with staging data | All pages load | ⬜ |
| 8 | Import to Supabase prod | Counts match | ⬜ |
| 9 | Verify prod UI | All pages load | ⬜ |
| 10 | Update DNS/auth | Login works | ⬜ |

---

### Phase 6: Launch (Week 8-9)
**Goal:** Unified platform live

#### Beta Launch (4 existing OpenGovIQ customers)
| Customer | Contact | Status | Feedback |
|----------|---------|--------|----------|
| Customer 1 | TBD | ⬜ Invited | |
| Customer 2 | TBD | ⬜ Invited | |
| Customer 3 | TBD | ⬜ Invited | |
| Customer 4 | TBD | ⬜ Invited | |

#### Launch Checklist
| Task | Owner | Deadline | Status |
|------|-------|----------|--------|
| Beta invites sent | Eric | Week 8 Day 1 | ⬜ |
| Beta feedback collected | Eric | Week 8 Day 5 | ⬜ |
| Critical bugs fixed | Dev | Week 9 Day 1 | ⬜ |
| Pricing page updated | Eric | Week 9 Day 2 | ⬜ |
| Announcement email drafted | Eric | Week 9 Day 3 | ⬜ |
| Base44 deprecation notice | Eric | Week 9 Day 4 | ⬜ |
| Public launch | Eric | Week 9 Day 5 | ⬜ |

#### Post-Launch Monitoring
| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Page load time | <2s | >5s |
| Error rate | <1% | >5% |
| Daily active users | Growing | -20% WoW |
| Support tickets | <5/day | >20/day |

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
