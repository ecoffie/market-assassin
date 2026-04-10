# PRD: BD Assist Platform

> Bringing DOD Top 100 BD capabilities to SMBs through a unified, AI-powered platform.

## Executive Summary

Today we have **2 tools** (Market Assassin, Content Reaper), **2 databases** (Recompete, Contractor DB), a **lead magnet** (Opportunity Hunter), and **add-ons** (Alerts, Briefings). SMBs buy what they need and own it forever.

But for firms ready to scale, they need more than tools—they need a **BD department**.

**BD Assist** is the enterprise tier: a unified platform with Federal Market Scanner, Pipeline Tracker, Teaming CRM, and Capture AI. It's for contractors who want the full workflow, not just individual tools.

**Key principle:** Keep tools separate for SMBs. BD Assist is the upgrade for firms who outgrow à la carte.

---

## User Acquisition Funnel

**Goal:** Full cycle from free tools → hooked users → paid platform

### The 45-Day Hook Strategy

```
FREE ENTRY POINTS                    HOOK PERIOD                     CONVERSION
─────────────────                    ───────────                     ──────────

Opportunity Hunter (Free)  ────┐
                               │
Market Scanner (Free)      ────┼──► 45 Days Free Alerts    ──► BD Assist ($49-199/mo)
                               │    + Daily Briefings
Federal Events (Free)      ────┤         │
                               │         │
Forecasts (Free)           ────┘         ▼
                                   "You found 47 opportunities
                                    last month. Upgrade to
                                    track them all."
```

### Persistent Tracking (Key Differentiator)

When users interact with any tool, the system should **remember and track indefinitely**:

| Tool | What Gets Tracked | Updates User Receives |
|------|-------------------|----------------------|
| **Recompete Tracker** | Contracts user flags for monitoring | Expiration alerts, incumbent changes, solicitation posts |
| **Contractor Database** | Companies saved as potential partners | SBLO changes, new certifications, teaming opportunities |
| **Opportunity Hunter** | Searches and saved opportunities | Status changes, amendments, related postings |
| **Federal Market Scanner** | NAICS + location combinations | New spending, forecasts, events in their market |

### Conversion Triggers

| Trigger | Message | Upgrade Path |
|---------|---------|--------------|
| 10+ saved opportunities | "You're tracking 10 opps. Upgrade to get win probability scores." | BD Assist Pro |
| 5+ saved contractors | "Get instant alerts when your partners win contracts." | BD Assist Pro |
| 3+ recompete flags | "These contracts expire soon. Get capture strategies." | BD Assist Enterprise |
| Weekly brief opened 4x | "You love the intel. Unlock daily briefings + pursuit tracking." | BD Assist Pro |

---

## Part 1: How Enterprise BD Teams Work

### DOD Top 100 BD Department Structure

| Role | FTE Count | Annual Cost | Activities |
|------|-----------|-------------|------------|
| BD Director/VP | 1 | $180-250K | Strategy, pipeline oversight, win/loss analysis |
| Capture Manager | 2-4 | $140-180K each | Opportunity pursuit, competitive intel, teaming |
| Market Analyst | 1-2 | $80-120K each | Market scanning, agency research, spending analysis |
| Proposal Manager | 1-2 | $100-140K each | Compliance, content coordination, reviews |
| Contracts/Pricing | 1 | $100-130K | Contract structure, pricing strategy |
| BD Rep/Account Mgr | 2-4 | $90-130K each | Relationship building, customer intel |

**Total BD team cost: $800K-$1.5M/year**

SMBs can't afford this. BD Assist gives them 80% of the capability at 2% of the cost.

---

### Daily Activities by Role

#### Market Research Analyst (What they do 40 hrs/week)

| Activity | Time | Frequency | Tools Used |
|----------|------|-----------|------------|
| Scan SAM.gov for new opps | 2 hrs | Daily | SAM.gov, saved searches |
| Check Grants.gov | 30 min | Daily | Grants.gov |
| Monitor agency forecast pages | 1 hr | Weekly | Each agency site manually |
| Track recompetes (FPDS/USASpending) | 2 hrs | Weekly | USASpending.gov |
| Build agency profiles | 4 hrs | Monthly | GAO reports, agency strategic plans |
| Analyze spending patterns | 3 hrs | Monthly | USASpending, FPDS |
| Find industry day events | 1 hr | Weekly | Agency OSDBUs, APEX |
| Competitive research | 2 hrs | Weekly | LinkedIn, press releases, SAM |

**Our tools that replace this:**
- Daily Alerts → SAM.gov + Grants.gov scanning
- Market Intelligence → AI analysis + briefings
- Federal Market Scanner → Spending, forecasts, events
- Recompete Tracker → Expiration monitoring
- Agency Sources API → Agency profiles
- Pain Points Database → Agency priorities

#### Capture Manager (What they do 40 hrs/week)

| Activity | Time | Frequency | Tools Used |
|----------|------|-----------|------------|
| Qualify opportunities (go/no-go) | 3 hrs | Weekly | Scoring matrix, spreadsheets |
| Competitive analysis | 4 hrs | Per opportunity | SAM awards, LinkedIn, press |
| Identify teaming partners | 3 hrs | Per opportunity | DSBS, networking, conferences |
| Customer engagement | 8 hrs | Weekly | Email, calls, meetings |
| Update pipeline/CRM | 2 hrs | Daily | Salesforce, Pipedrive |
| Gate reviews | 2 hrs | Per opportunity | Internal meetings |
| Develop capture strategy | 4 hrs | Per opportunity | Playbooks, templates |

**Our tools that partially cover this:**
- Win Probability Scoring → Qualification support
- Contractor Database → Teaming partners
- Teaming Plays (in briefings) → AI-suggested partners
- Action Planner → Task tracking

**Gap:** No pipeline/CRM, no capture workflow, no competitive intel system.

#### BD Director (What they do 40 hrs/week)

| Activity | Time | Frequency | Tools Used |
|----------|------|-----------|------------|
| Pipeline review | 4 hrs | Weekly | CRM dashboards |
| Win/loss analysis | 2 hrs | Monthly | Historical data |
| Strategic planning | 4 hrs | Quarterly | Market research, forecasts |
| Resource allocation | 2 hrs | Weekly | Capacity planning |
| Executive relationship building | 8 hrs | Weekly | Meetings, events |
| Revenue forecasting | 2 hrs | Monthly | Pipeline × probability |

**Our tools that could support this:**
- Market Assassin reports → Strategic analysis
- (Gap: No pipeline dashboard, no win/loss tracking)

---

## Part 2: Current Tool Inventory

### What We Have Today

#### A. Data Sources (MCP Layer)

| MCP Server | Data | Status | Notes |
|------------|------|--------|-------|
| `samgov-mcp` | Opportunities, entities, forecasts | ✅ Live | Primary opp source |
| `grantsgov-mcp` | $700B grants | ✅ Live | Grant opportunities |
| `usaspending-mcp` | $7.5T historical awards | ✅ Live | Spending, awards |
| `multisite-mcp` | NIH, DARPA, NSF, labs | ✅ Live | 106 opps, expanding |

#### B. Intelligence APIs

| API Endpoint | Function | Status | Can be MCP? |
|--------------|----------|--------|-------------|
| `/api/market-scan` | Spending analysis, visibility gap | ✅ Live | Yes |
| `/api/agency-sources` | 250 agency procurement profiles | ✅ Live | Yes |
| `/api/federal-events` | 30 event sources, conferences | ✅ Live | Yes |
| `/api/recompete` | Expiring contracts | ✅ Live | Yes |
| `/api/forecasts` | 7,764 forecasts, 13 agencies | ✅ Live | Yes |
| `/api/pain-points` | Agency priorities database | ✅ Live | Yes |
| `/api/budget-intel` | FY budget authority | ✅ Live | Yes |
| `/api/agency-hierarchy` | Federal org structure | ✅ Live | Yes |

#### C. User-Facing Products

**Tools (Standalone, One-Time Purchase):**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Market Assassin | `/market-assassin` | $297-497 | Strategic market reports |
| Content Reaper | `/content-generator` | $197-397 | AI LinkedIn content |

**Databases (Standalone, One-Time Purchase):**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Recompete Tracker | `/recompete` | $397 | Expiring contracts |
| Contractor Database | `/contractor-database` | $497 | 3,500+ contractors + SBLOs |

**Lead Magnet (Free Entry Point):**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Opportunity Hunter | `/opportunity-hunter` | Free (+$19/mo Pro) | Find SAM.gov opps, hook users |

**Add-Ons (Subscription, Enhances Tools):**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Daily Alerts | Email | $19/mo | Opportunity notifications |
| Daily Briefings | `/briefings` | $49/mo | AI market intelligence |

**Free Utilities:**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Forecasts | `/forecasts` | Free | Browse 7,764 agency forecasts |
| Action Planner | `/planner` | Free | Task management |

**BD Assist Exclusive (Coming):**

| Product | URL | Price | Purpose |
|---------|-----|-------|---------|
| Federal Market Scanner | `/bd-assist` | $199/mo (BD Assist) | 6-question market intel |
| Pipeline Tracker | `/bd-assist` | $199/mo (BD Assist) | Opportunity tracking |
| Teaming CRM | `/bd-assist` | $199/mo (BD Assist) | Partner outreach management |
| Capture AI | `/bd-assist` | $199/mo (BD Assist) | Win strategy guidance |

#### D. Data Assets

| Asset | Records | Value |
|-------|---------|-------|
| Agency Pain Points | 2,765 across 250 agencies | Intel gold |
| Contractor Database | 3,500+ with SBLO contacts | Teaming |
| Federal Forecasts | 7,764 from 13 agencies | 6-18 month heads up |
| Budget Data | 47 toptier agencies | Strategy planning |

---

## Part 3: Gap Analysis

### What Enterprise BD Teams Have That We Don't

| Capability | Enterprise Tool | Our Status | Priority |
|------------|-----------------|------------|----------|
| Pipeline CRM | Salesforce, Pipedrive | ❌ None | HIGH |
| Capture workflow | Gate review process | ❌ None | HIGH |
| Go/no-go scoring | Capture matrices | ⚠️ Win Probability (basic) | MEDIUM |
| Competitive intel | Manual research | ❌ None | HIGH |
| Teaming outreach | CRM + email | ❌ None | MEDIUM |
| Proposal library | SharePoint, templates | ❌ None | LOW |
| Customer contacts | CRM | ❌ None | MEDIUM |
| Win/loss tracking | CRM reports | ❌ None | MEDIUM |
| Unified dashboard | Custom BI | ❌ None | HIGH |

### The Core Problem

We have **12 products** doing parts of what a BD team does, but:
1. No unified login/experience
2. No shared pipeline view
3. No workflow connecting intel → pursuit → win
4. User must context-switch between tools

---

## Part 4: BD Assist Vision

### The Simple Premise

**"Your AI-powered BD team for $49/month"**

One login. One dashboard. Five capabilities:
1. **Intel** - What's out there? (Market Intelligence)
2. **Pipeline** - What am I pursuing? (Opportunity Tracker)
3. **Teaming** - Who can help me win? (Partner Network)
4. **Capture** - How do I position? (AI Guidance)
5. **Insights** - How am I doing? (Analytics)

### User Experience Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        BD ASSIST                                 │
│                    "Your BD Department"                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DAILY VIEW (Default Landing)                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ TODAY'S BRIEF                                            │   │
│  │ • 3 new opportunities matching your profile              │   │
│  │ • 1 recompete deadline in 30 days                        │   │
│  │ • GSA Industry Day next Tuesday                          │   │
│  │ • Suggested teaming: Booz Allen looking for 8(a) subs    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  PIPELINE SNAPSHOT                                               │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐      │
│  │ TRACKING │ PURSUING │ BIDDING  │ SUBMITTED│ AWARDED  │      │
│  │    12    │    5     │    2     │    1     │    3     │      │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘      │
│                                                                  │
│  QUICK ACTIONS                                                   │
│  [Scan Market] [Add Opportunity] [Find Partners] [Run Report]   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  INTEL     PIPELINE     TEAMING     CAPTURE     INSIGHTS        │
└─────────────────────────────────────────────────────────────────┘
```

### Tab Details

#### 1. INTEL Tab (Market Intelligence + Scanner)
What it does:
- Daily/Weekly briefings
- Market scanning (SAM, Grants, Forecasts, Events)
- Agency deep dives
- Spending analysis

Powered by:
- Market Intelligence briefings
- Federal Market Scanner APIs
- Forecasts, Recompetes, Events

**Federal Market Scanner Output Format:**

For any NAICS + Location input, answer these 6 questions:

```
User Input: NAICS 238220 (HVAC), Georgia

Output:
├── WHO is buying HVAC in Georgia?
│   ├── Fort Benning — $12M/year (DOD)
│   ├── VA Atlanta Medical Center — $4M/year
│   ├── CDC Campus — $8M/year (HHS)
│   └── GSA Region 4 — $6M/year
│
├── HOW are they buying?
│   ├── 40% GSA Schedule 56 (you need this)
│   ├── 30% Direct contracts (posted on SAM)
│   ├── 20% Existing BPAs (contact these COs)
│   └── 10% Micro-purchases (get in vendor database)
│
├── WHO has the contracts now?
│   ├── Johnson Controls — Fort Benning (expires 2027)
│   ├── Trane — VA Atlanta (expires 2026) ← RECOMPETE
│   └── Local contractor — CDC (8(a) set-aside)
│
├── WHAT opportunities exist RIGHT NOW?
│   ├── SAM.gov: 3 active (RFQ, Sources Sought, Pre-sol)
│   ├── Grants.gov: 0
│   ├── GSA eBuy: 2 (if you have schedule)
│   └── Forecasts: 5 planned in next 12 months
│
├── WHAT events should you attend?
│   ├── VA Atlanta Industry Day — May 15
│   ├── Fort Benning Small Business Fair — June 3
│   └── Georgia APEX Matchmaking — April 22
│
└── WHO do I talk to?
    ├── OSDBU contacts per agency
    ├── Small Business Specialists
    └── Contracting Officers
```

**Data Sources per Question:**

| Question | Primary API | Fallback |
|----------|-------------|----------|
| Who's buying? | USASpending MCP | Agency Hierarchy API |
| How are they buying? | USASpending (vehicle analysis) | Agency Sources API |
| Who has it now? | USASpending (incumbents) | Recompete Tracker |
| What's available? | SAM.gov + Grants.gov + Multisite MCPs | Forecasts API |
| What events? | Federal Events API | Agency calendars |
| Who to talk to? | Agency Hierarchy API | Contractor DB (SBLOs) |

#### 2. PIPELINE Tab (New - Must Build)
What it does:
- Track opportunities through stages
- Set reminders and deadlines
- Go/no-go decision support
- Win probability scoring

Stages:
```
TRACKING → PURSUING → BIDDING → SUBMITTED → WON/LOST
   │           │          │          │
   └── Qualify ─┴── Capture ┴── Propose ┘
```

Data model:
```typescript
interface TrackedOpportunity {
  id: string;
  noticeId: string;              // SAM.gov notice ID
  title: string;
  agency: string;
  value: string;
  responseDeadline: Date;
  stage: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | 'won' | 'lost';
  winProbability: number;
  notes: string;
  teamingPartners: string[];
  nextAction: string;
  nextActionDate: Date;
  addedAt: Date;
  updatedAt: Date;
}
```

#### 3. TEAMING Tab (Contractor DB + Network)
What it does:
- Search contractor database
- AI-suggested partners (from briefings)
- Track outreach status
- Save preferred partners list

Powered by:
- Contractor Database (3,500+)
- USASpending teaming data (future)
- Subaward relationships (when API available)

#### 4. CAPTURE Tab (AI Guidance)
What it does:
- Capture strategy templates
- Competitive analysis (who's bidding)
- Agency pain point matching
- Differentiator suggestions

Powered by:
- Pain Points Database
- Win Probability Scoring
- Claude AI analysis

#### 5. INSIGHTS Tab (Analytics)
What it does:
- Pipeline value by stage
- Win rate trends
- Time-to-decision metrics
- Market share in NAICS

Powered by:
- Pipeline data
- USASpending historical

---

## Part 5: Technical Architecture

### Current State → Target State

```
CURRENT (Fragmented)                    TARGET (Unified)
─────────────────────                   ──────────────────

┌─────────────┐                        ┌─────────────────────┐
│ Opp Hunter  │──┐                     │                     │
├─────────────┤  │                     │    BD ASSIST        │
│ Alerts      │──┤                     │    DASHBOARD        │
├─────────────┤  │                     │                     │
│ Briefings   │──┤     ────────►       │  ┌──────┬──────┐   │
├─────────────┤  │                     │  │Intel │Pipe- │   │
│ Scanner     │──┤                     │  │      │line  │   │
├─────────────┤  │                     │  ├──────┼──────┤   │
│ Recompete   │──┤                     │  │Team- │Capt- │   │
├─────────────┤  │                     │  │ing   │ure   │   │
│ Forecasts   │──┤                     │  └──────┴──────┘   │
├─────────────┤  │                     │                     │
│ Market Asn  │──┤                     └─────────────────────┘
├─────────────┤  │                              │
│ Contractor  │──┤                              ▼
│ DB          │──┘                     ┌─────────────────────┐
└─────────────┘                        │    API GATEWAY      │
       │                               │  (Unified Backend)  │
       ▼                               └─────────────────────┘
┌─────────────┐                                │
│ 4 MCP Svrs  │                        ┌───────┴───────┐
│ 8 APIs      │                        ▼               ▼
│ (Unconnected)                  ┌─────────┐    ┌─────────┐
└─────────────┘                  │ Our APIs│    │MCP Layer│
                                 └─────────┘    └─────────┘
```

### API Consolidation

All internal APIs become callable from one gateway:

```typescript
// BD Assist API Gateway
export const bdAssistAPI = {
  // Intel
  intel: {
    getBriefing: (date: string) => fetch('/api/briefings'),
    scanMarket: (naics: string, state: string) => fetch('/api/market-scan'),
    getForecasts: (filters) => fetch('/api/forecasts'),
    getRecompetes: (filters) => fetch('/api/recompete'),
    getEvents: (filters) => fetch('/api/federal-events'),
  },

  // Pipeline (new)
  pipeline: {
    list: () => fetch('/api/pipeline'),
    add: (opp) => fetch('/api/pipeline', { method: 'POST', body: opp }),
    update: (id, data) => fetch(`/api/pipeline/${id}`, { method: 'PATCH' }),
    getStats: () => fetch('/api/pipeline/stats'),
  },

  // Teaming
  teaming: {
    search: (query) => fetch('/api/contractors/search'),
    getSuggested: (oppId) => fetch(`/api/teaming/suggest/${oppId}`),
    savePartner: (data) => fetch('/api/teaming/saved', { method: 'POST' }),
  },

  // Capture
  capture: {
    getStrategy: (oppId) => fetch(`/api/capture/${oppId}`),
    getCompetitors: (naics, agency) => fetch('/api/competitive-intel'),
    getPainPoints: (agency) => fetch('/api/pain-points'),
  },

  // Insights
  insights: {
    getPipelineValue: () => fetch('/api/insights/pipeline'),
    getWinRate: () => fetch('/api/insights/win-rate'),
    getMarketShare: (naics) => fetch('/api/insights/market-share'),
  },
};
```

### MCP Integration (For AI/Agent Use)

Create unified `bdassist-mcp` that wraps existing MCPs:

```typescript
// bdassist-mcp tools
const tools = [
  // From samgov-mcp
  'search_opportunities',
  'get_opportunity',

  // From grantsgov-mcp
  'search_grants',

  // From usaspending-mcp
  'search_contracts',
  'get_office_spending',

  // From multisite-mcp
  'search_multisite',

  // New BD Assist tools
  'add_to_pipeline',
  'update_pipeline_stage',
  'suggest_teaming_partners',
  'generate_capture_strategy',
  'calculate_win_probability',
];
```

---

## Part 6: Database Schema

### New Tables for Pipeline

```sql
-- User pipeline (tracked opportunities)
CREATE TABLE user_pipeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,

  -- Opportunity reference
  notice_id TEXT,                    -- SAM.gov notice ID (if from SAM)
  source TEXT DEFAULT 'sam.gov',     -- sam.gov, grants.gov, manual
  external_url TEXT,

  -- Core fields
  title TEXT NOT NULL,
  agency TEXT,
  value_estimate TEXT,
  naics_code TEXT,
  set_aside TEXT,
  response_deadline TIMESTAMPTZ,

  -- Pipeline tracking
  stage TEXT DEFAULT 'tracking',     -- tracking, pursuing, bidding, submitted, won, lost
  win_probability INTEGER,           -- 0-100
  priority TEXT DEFAULT 'medium',    -- low, medium, high

  -- Notes and actions
  notes TEXT,
  next_action TEXT,
  next_action_date DATE,

  -- Teaming
  teaming_partners TEXT[],           -- Array of company names
  is_prime BOOLEAN DEFAULT true,

  -- Outcome (for won/lost)
  outcome_date DATE,
  outcome_notes TEXT,
  award_amount TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_email, notice_id)
);

-- Pipeline stage history
CREATE TABLE pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID REFERENCES user_pipeline(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Saved teaming partners
CREATE TABLE user_teaming_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  partner_type TEXT,                 -- prime, sub, jv
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  naics_codes TEXT[],
  certifications TEXT[],
  notes TEXT,
  outreach_status TEXT,              -- none, contacted, responded, meeting, partnered
  last_contact DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Win/loss tracking for insights
CREATE TABLE pipeline_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  pipeline_id UUID REFERENCES user_pipeline(id),
  outcome TEXT NOT NULL,             -- won, lost
  outcome_date DATE,
  award_amount NUMERIC,
  winner TEXT,                       -- If lost, who won?
  lessons_learned TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_pipeline_user ON user_pipeline(user_email);
CREATE INDEX idx_pipeline_stage ON user_pipeline(stage);
CREATE INDEX idx_pipeline_deadline ON user_pipeline(response_deadline);
CREATE INDEX idx_teaming_user ON user_teaming_partners(user_email);
```

---

## Part 7: Pricing Strategy

### Current Product Structure (Keep As-Is)

| Type | Product | Price | What It Does |
|------|---------|-------|--------------|
| **Tool** | Market Assassin | $297-497 | Strategic market reports |
| **Tool** | Content Reaper | $197-397 | AI LinkedIn content |
| **Database** | Recompete Tracker | $397 | Expiring contracts |
| **Database** | Contractor Database | $497 | 3,500+ contractors + SBLOs |
| **Lead Magnet** | Opportunity Hunter | Free (+$19/mo Pro) | Find SAM.gov opps |
| **Add-on** | Daily Alerts | $19/mo | Opportunity notifications |
| **Add-on** | Daily Briefings | $49/mo | AI market intelligence |

**Philosophy:** SMBs buy what they need, own it forever. Tools stay separate.

### Current Bundles (Keep As-Is)

| Bundle | Price | Includes |
|--------|-------|----------|
| **Starter** | $697 | Opp Hunter Pro + Recompete + Contractor DB |
| **Pro Giant** | $997 | Contractor DB + Recompete + MA Standard + Content Gen |
| **Ultimate** | $1,497 | Everything + MA Premium + Lifetime Briefings |

### BD Assist: Enterprise Tier (NEW)

For firms ready to scale beyond individual tools.

| Tier | Price | Includes |
|------|-------|----------|
| **BD Assist** | $199/mo | All tools + Federal Market Scanner + Pipeline + Teaming CRM + Capture AI + Insights |
| **BD Assist Annual** | $1,997/yr | Same as above (17% discount) |

**What BD Assist Adds (Beyond Tool Access):**

| Feature | In Individual Tools? | In BD Assist? |
|---------|---------------------|---------------|
| Market Assassin reports | ✅ (if purchased) | ✅ Included |
| Recompete data | ✅ (if purchased) | ✅ Included |
| Contractor search | ✅ (if purchased) | ✅ Included |
| Daily Briefings | ✅ (if purchased) | ✅ Included |
| **Federal Market Scanner** | ❌ | ✅ **Exclusive** |
| **Pipeline Tracker** | ❌ | ✅ **Exclusive** |
| **Teaming CRM** | ❌ | ✅ **Exclusive** |
| **Capture AI** | ❌ | ✅ **Exclusive** |
| **Win/Loss Analytics** | ❌ | ✅ **Exclusive** |
| **Unified Dashboard** | ❌ | ✅ **Exclusive** |

### Early Adopter Rewards

| Existing Purchase | BD Assist Benefit |
|-------------------|-------------------|
| **Ultimate Bundle ($1,497)** | 🎁 **FREE lifetime BD Assist** |
| Pro Giant Bundle ($997) | 6 months BD Assist free |
| Starter Bundle ($697) | 3 months BD Assist free |
| Any single tool | 1 month BD Assist free |

**Ultimate buyers get grandfathered in permanently.** They took the biggest bet on us early — they deserve the full platform.

---

## Part 8: Implementation Phases

### Phase 1: Unify Intel (Current Focus) - 2 weeks
- [x] Market Intelligence unified page (`/briefings`)
- [x] Settings panel integration
- [x] Feedback system
- [ ] Add Scanner tab to `/briefings`
- [ ] Rename to BD Assist Intel

### Phase 2: Pipeline Tracker - 3 weeks
- [ ] Database schema (user_pipeline)
- [ ] `/api/pipeline` CRUD endpoints
- [ ] Pipeline UI component
- [ ] "Add to Pipeline" button on opportunities
- [ ] Stage drag-and-drop
- [ ] Deadline notifications

### Phase 3: Teaming Integration - 2 weeks
- [ ] Contractor search in platform
- [ ] Partner saving
- [ ] Outreach tracking
- [ ] AI partner suggestions (from briefings)

### Phase 4: Unified Dashboard - 2 weeks
- [ ] New `/bd-assist` route (or `/dashboard`)
- [ ] Tab navigation (Intel, Pipeline, Teaming, Capture, Insights)
- [ ] Daily view landing
- [ ] Quick actions

### Phase 5: Capture AI - 2 weeks
- [ ] Capture strategy generation
- [ ] Competitive intel (incumbents, past winners)
- [ ] Differentiator suggestions
- [ ] Go/no-go scorecard

### Phase 6: Insights - 1 week
- [ ] Pipeline value chart
- [ ] Win rate calculation
- [ ] Stage duration metrics

### Phase 7: Polish & Launch - 2 weeks
- [ ] Mobile responsiveness
- [ ] Onboarding flow
- [ ] Help documentation
- [ ] Pricing page
- [ ] Migration communications

**Total: ~14 weeks to full BD Assist**

---

## Part 9: Success Metrics

| Metric | Target | Measure |
|--------|--------|---------|
| Active users | 500 → 2,000 | Monthly active |
| Pipeline opportunities | 10+ per user | Average tracked opps |
| Conversion | 5% → 15% | Free → Paid |
| Churn | <5%/month | Monthly churn |
| NPS | >50 | Quarterly survey |
| Revenue | $50K MRR | 6 months post-launch |

---

## Part 10: Competitive Differentiation

### vs. GovWin/Deltek ($10K+/year)
- **We're cheaper:** $99/mo vs $10K+/yr
- **We're simpler:** No training required
- **We're AI-first:** Briefings, not just data dumps

### vs. SAM.gov (Free)
- **We save time:** AI prioritizes opportunities
- **We add intel:** Pain points, forecasts, events
- **We track pipeline:** SAM.gov has no memory

### vs. Capture2 / Pipeline Pro
- **We include intel:** Not just pipeline tracking
- **We're GovCon-specific:** Built for federal
- **We have data:** 7,764 forecasts, 3,500 contractors

### The Moat
1. **Data assets** we've built (pain points, forecasts, contractors)
2. **AI analysis** others don't have
3. **Unified experience** vs fragmented tools
4. **SMB pricing** enterprise can't match

---

## Appendix: Existing Tool Migration Map

| Current Tool | BD Assist Location | Migration |
|--------------|-------------------|-----------|
| Opportunity Hunter | Intel → Opportunities | Keep as entry point |
| Daily Alerts | Intel → Notifications | Merge into briefings |
| Market Intelligence | Intel → Briefings | Core of Intel tab |
| Federal Market Scanner | Intel → Scanner | Integrate as sub-tab |
| Recompete Tracker | Intel → Recompetes | Integrate as filter |
| Forecasts | Intel → Forecasts | Integrate as filter |
| Market Assassin | Intel → Reports | Premium feature |
| Contractor Database | Teaming → Search | Core of Teaming |
| Action Planner | Pipeline → Tasks | Merge concepts |
| Content Reaper | (Separate product) | Keep standalone |

---

*Created: April 9, 2026*
*Status: Strategy Document - Pending Review*
