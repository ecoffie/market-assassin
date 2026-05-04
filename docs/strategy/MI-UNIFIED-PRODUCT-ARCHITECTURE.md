# MI Unified Product Architecture

## The Core Insight

**Market Assassin already exists and is deeper than MI needs to be.**

The question is not "build MI from scratch" — it's "how do these tools work together as one unified experience?"

---

## Current Tool Inventory

| Tool | Job | Output | Frequency |
|------|-----|--------|-----------|
| **Market Assassin** | Build market strategy | Deep reports: agencies, buyers, spend, OSDBU contacts, IDVs, awards | On-demand research |
| **Daily Briefings** | What changed today? | 3-5 best-fit opportunities ranked by fit | Daily |
| **Weekly Deep Dives** | Weekly market summary | Trends, new forecasts, recompete alerts | Weekly |
| **Pursuit Briefs** | Analyze one target | Single opportunity deep analysis | On-demand |
| **Opportunity Hunter** | Search all matches | Full matching opportunity list | On-demand |
| **Recompete Tracker** | Find renewals | Expiring contracts by NAICS/agency | On-demand |
| **Contractor Database** | Find competitors/partners | 85K+ contractors searchable | On-demand |
| **Market Scanner** | 6-question framework | Who buys, how, incumbents, events, contacts | On-demand |
| **Forecast Intelligence** | Upcoming procurements | 7,648 forecasts, $94.5B pipeline | On-demand |
| **BD Assist Pipeline** | Track pursuits | Kanban board for opportunities | Ongoing |
| **Action Planner** | Task management | BD action items | Ongoing |

---

## The Architecture Question

**Should users navigate 11 separate tools, or ONE unified experience with tabs?**

### Current State: Fragmented
```
tools.govcongiants.org/opportunity-hunter
tools.govcongiants.org/recompete
tools.govcongiants.org/contractor-database
tools.govcongiants.org/forecasts
tools.govcongiants.org/bd-assist
tools.govcongiants.org/market-assassin
tools.govcongiants.org/briefings/dashboard
...etc
```

### Proposed State: Unified Dashboard
```
tools.govcongiants.org/mi
  └── /dashboard     (Daily Bid Targets - home)
  └── /opportunities (Full matching list - Opportunity Hunter)
  └── /market        (Market Assassin deep research)
  └── /recompetes    (Expiring contracts)
  └── /forecasts     (Upcoming procurements)
  └── /contractors   (Database search)
  └── /pipeline      (BD Assist tracking)
  └── /planner       (Action items)
  └── /settings      (Profile, NAICS, preferences)
```

---

## Product Positioning (Clear Distinction)

### Market Assassin = Strategy Map
**Job:** "Help me understand my market and decide where to hunt"

- Who buys what you sell?
- Which agencies should you target?
- Where is money flowing?
- Who are the OSDBU / buyer contacts?
- What IDVs, awards, incumbents matter?
- **Output:** Deep market research report
- **Frequency:** One-time or quarterly refresh
- **Price:** $297-$497 one-time (or included in MI subscription)

### Market Intelligence = Daily Radar
**Job:** "Watch my market and tell me what moved"

- What changed today?
- What new opportunity matches me?
- What deadline is approaching?
- Which of my target agencies just moved?
- **Output:** Daily bid targets + full dashboard
- **Frequency:** Daily/weekly recurring
- **Price:** $149/mo (MI Pro) to $499/mo (MI Team)

### The Relationship
> "Market Assassin shows you where to hunt. Market Intelligence watches that market every day and tells you what moved."

---

## Unified MI SaaS Tiers (Revised May 2026)

### MI Free - $0
**Entry tier with habit-forming daily touchpoint**

| Feature | Current Status |
|---------|----------------|
| Opportunity Hunter (market research) | ✅ BUILT |
| Daily Alerts (simple opp list, no AI) | ✅ BUILT |
| Weekly digest email | ✅ BUILT |
| NAICS profile setup | ✅ BUILT |
| Dashboard preview (limited view) | ✅ BUILT |

**Why Daily Alerts in Free:**
- **Habit-forming hook** — Daily email creates touchpoint
- **Same onboarding** — NAICS profile for both OH and Alerts
- **Natural upgrade path** — "Want AI analysis?" → MI Pro
- **Matches SaaS best practices** — Gate value amplifiers, not core value

### MI Pro - $149/mo
**One user, full intelligence stack**

| Feature | Current Status |
|---------|----------------|
| Everything in Free, unlimited | ✅ |
| Daily Briefings (AI-powered, win probability) | ✅ BUILT |
| Weekly Deep Dives | ✅ BUILT |
| Pursuit Briefs | ✅ BUILT |
| Full Opportunity Dashboard | ✅ BUILT |
| Market Assassin (strategy) | ✅ BUILT |
| Recompete Tracker | ✅ BUILT |
| Forecast Intelligence | ✅ BUILT |
| Contractor Database | ✅ BUILT |
| Market Scanner (6Q) | ✅ BUILT |
| BD Pipeline (lite) | ✅ BUILT |
| Saved searches & export | ✅ BUILT |
| Feedback loop (rate matches) | ❌ NEEDS BUILD |
| Unified navigation | ✅ BUILT |

### Key Difference: Daily Alerts vs Daily Briefings

| Feature | Daily Alerts (Free) | Daily Briefings (Pro) |
|---------|---------------------|----------------------|
| Delivery | Email | Email + Dashboard |
| Content | Simple opportunity list | AI-curated top 3-5 matches |
| Analysis | None | Win probability score |
| Strategy | None | Strategic recommendations |
| "Why this?" | None | Match reasoning |
| Next steps | None | Action items |
| Price | $0 | $149/mo |

### MI Team - $499/mo
**5 seats, shared intelligence**

| Feature | Current Status |
|---------|----------------|
| Everything in MI Pro | ✅ |
| 5 user seats | ❌ NEEDS BUILD |
| Team admin dashboard | ❌ NEEDS BUILD |
| Per-user alert preferences | ❌ NEEDS BUILD |
| Shared pipeline views | ⚠️ PARTIAL |
| Team activity log | ❌ NEEDS BUILD |

### MI Enterprise - $2,500/mo
**Unlimited seats, white-label, API**

| Feature | Current Status |
|---------|----------------|
| Everything in MI Team | - |
| Unlimited seats | ❌ NEEDS BUILD |
| API access | ❌ NEEDS BUILD |
| White-label reports | ❌ NEEDS BUILD |
| Custom briefing templates | ⚠️ PARTIAL |
| SSO/SAML | ❌ NEEDS BUILD |
| Dedicated support | Process only |

### MI Enterprise Plus - $5,000+/mo
**White Glove + Software**

| Feature | Current Status |
|---------|----------------|
| Everything in MI Enterprise | - |
| Dedicated BD coach | Process only |
| Custom market research | Manual delivery |
| Proposal support | Manual delivery |
| Monthly strategy calls | Process only |

---

## What Actually Needs Building

### Priority 1: Unified Navigation (MI Pro)
**Effort:** Medium (2-3 weeks)
**Impact:** Makes product feel like ONE thing, not 11 tools

- Single `/mi` entry point
- Tab-based navigation between tools
- Consistent header/sidebar across all views
- User profile/preferences in one place

### Priority 2: Feedback Loop (MI Pro)
**Effort:** Low (1 week)
**Impact:** Makes intelligence get smarter over time

On every opportunity:
- 👍 Good match
- 👎 Bad match
- 🚫 Not my industry
- 📏 Too big/small
- ✅ Already knew about it
- ⭐ Want more like this

Track: clicks, saves, dismissals, conversions

### Priority 3: Team Seat Management (MI Team)
**Effort:** Medium (2-3 weeks)
**Impact:** Unlocks $499/mo tier

- Add users to organization
- Role-based access (admin, user)
- Per-user NAICS/alert preferences
- Team activity feed

### Priority 4: Enhanced Daily Bid Targets (MI Pro)
**Effort:** Low (1 week)
**Impact:** Makes daily briefing more actionable

Each opportunity should show:
- **Why This Matched** (NAICS, set-aside, agency, location)
- **Who Is Buying** (office, contact, past awards)
- **Can I Win This?** (incumbent, competition level, bid count)
- **Next Action** (download docs, call OSDBU, check forecast, add to pipeline)

---

## Beta Strategy (from Wealth GENIUS framework)

### Not All 9,000 at Once

| Wave | Segment | Size | Timing |
|------|---------|------|--------|
| 1 | Paid customers (FHC, bundles) | 100-250 | Week 1-2 |
| 2 | Alert users ($19/mo) | 200-300 | Week 3-4 |
| 3 | Warm leads (clicked recently) | 500 | Week 5-6 |
| 4 | Cold list reactivation | 2,000 | Week 7-8 |
| 5 | Public launch | Rest | Week 9+ |

### Beta Success Metrics

| Metric | Target |
|--------|--------|
| Email open rate | 40%+ |
| Click rate into dashboard | 10%+ |
| Users who save/inspect 1+ opp/week | 25%+ |
| "Would be disappointed if gone" | 10%+ |
| Warm users convert to paid | 5-10% |
| Users reply with feedback | 20+ |

### The One Question to Answer
> "Did MI help you decide what to pursue this week?"

If yes → price goes up.
If no → fix the product before scaling.

---

## Competitive Landscape Analysis

### The Big Three in GovCon Intelligence

| Company | Product | Target Market | Price Range |
|---------|---------|---------------|-------------|
| **Deltek** | GovWin IQ | Mid-Large contractors ($10M-$500M+) | $13K-$119K/year (avg $29K) |
| **Unanet** | GovIntel + CRM | Small-Mid contractors ($2M-$100M) | $2,500-$50K+/year |
| **GovCon Giants** | MI (Market Intelligence) | Small contractors (<$10M) | $1,788-$30K/year |

---

### Deltek GovWin IQ ($13K-$119K/year)

**What They Do Well:**
- Spot opportunities years before RFP drops
- Deep pricing intelligence and competitive analysis
- Relationship-building tools with buyers/partners
- FedRAMP Moderate Equivalency (CMMC Level 2)
- Largest database (decades of historical data)

**What Users Complain About:**
- "Financial strain on small business due to exorbitant price"
- Complex interface, steep learning curve
- 60-day cancellation notice or auto-renewal trap
- Overkill for small contractors

**Who Buys:** $10M-$500M+ contractors who can justify the cost

---

### Unanet GovIntel + CRM ($2,500-$50K+/year)

**What They Do Well:**
- **Auto-ingests opportunities** from any source (SAM, agency portals)
- **Auto-scores and prioritizes** winnable opportunities
- **Partner/teaming identification** - surfaces primes/subs aligned to GWACs
- **Award tracking** - pricing, awardees, OEMs, resellers
- **Proposal AI** - auto-generate proposals from past wins
- Single database connecting CRM → ERP → Project Management

**Product Suite:**
| Product | Function | Starting Price |
|---------|----------|----------------|
| GovIntel | Market intelligence, opportunity tracking | ~$2,500/year |
| CRM for GovCon | Pipeline, capture, proposals | Custom quote |
| ERP GovCon | Accounting, compliance, DCAA | $4,000+/year (10 users) |
| ProposalAI | AI-generated proposal content | Included with CRM |
| GovChannel | Partner/teaming network | Included with GovIntel |

**What Users Complain About:**
- Initial setup/migration "incredibly difficult, time consuming, expensive"
- Interface not as polished as modern SaaS
- Less deep historical data than Deltek

**Who Buys:** $2M-$100M contractors who need CRM + ERP integration

---

### GovCon Giants MI (Our Position)

**Our Sweet Spot:** The contractor who:
- Can't afford $29K+ for Deltek
- Doesn't need Unanet's full ERP/CRM stack
- Wants **daily intelligence** without enterprise complexity
- Is <$10M revenue, often 1-10 person BD team
- Needs to know "what to pursue this week" not "manage 100 active bids"

**Our Advantages:**
| Feature | Deltek | Unanet | MI |
|---------|--------|--------|-----|
| Daily AI briefings | ❌ | ❌ | ✅ |
| Pursuit-level analysis | ✅ | ✅ | ✅ |
| Weekly deep dives | ❌ | ❌ | ✅ |
| Recompete tracking | ✅ | ✅ | ✅ |
| Forecast intelligence | ✅ | ✅ | ✅ |
| Contractor database | ✅ | ✅ | ✅ |
| Market research (6Q) | ❌ | ❌ | ✅ |
| BD coaching available | ❌ | ❌ | ✅ |
| Small business focus | ❌ | ⚠️ | ✅ |
| Entry price | $13,000/yr | $2,500/yr | $1,788/yr |

**What We Do That They Don't:**
1. **Daily AI Briefings** - No one sends personalized daily bid targets
2. **Weekly Deep Dives** - No one sends weekly market summaries
3. **Pursuit Briefs** - On-demand deep analysis per opportunity
4. **Coaches on Staff** - White Glove includes BD coaching, not just software
5. **Small Business DNA** - We are them, we serve them, we understand $0-$10M pain

**What They Do That We Need:**
| Gap | Deltek | Unanet | MI Status | OpenGovIQ Status |
|-----|--------|--------|-----------|------------------|
| Auto-ingest from agency portals | ✅ | ✅ | ⚠️ Partial | ✅ BUILT |
| Auto-score opportunities | ✅ | ✅ | ✅ Built | ✅ BUILT |
| Partner/teaming network | ✅ | ✅ | ✅ Built | ✅ BUILT |
| Proposal AI generation | ✅ | ✅ | ❌ Not built | ✅ BUILT (Proposal Manager) |
| CRM/Pipeline | ✅ | ✅ | ⚠️ Partial | ✅ BUILT (Pipeline Management) |
| Team seat management | ✅ | ✅ | ❌ Needs build | ✅ BUILT ($2K/seat/year) |
| Private AI Workbench | ❌ | ❌ | ❌ Not built | ✅ BUILT |
| Custom AI agents | ❌ | ❌ | ❌ Not built | ✅ BUILT |
| Playbook automation | ❌ | ❌ | ❌ Not built | ✅ BUILT |

---

## THE MISSING PIECE: OpenGovIQ Already Has Enterprise Features

OpenGovIQ is the enterprise CRM/AI platform we already built. It covers EVERY gap MI has.

### OpenGovIQ Feature Inventory

**AI Tools & Content Generation:**
- 24/7 GovCon Coach
- Proposal Manager (AI-generated proposals)
- RFI Response Generator
- Capability Statement Generator
- White Paper Generator
- Pro Writer (Grants)

**Compliance & Registrations:**
- SAM.gov Registration guidance
- SBA Profile Optimizer
- FAR Aid and Compliance

**Research & Market Intelligence:**
- Federal Forecasts
- Federal Opportunities
- Federal Contracts
- Agency Spending
- Market Intelligence

**Workflow / Execution:**
- Project Manager
- Pipeline Management
- Automated Workflow
- Deadline / Opportunity Tracking
- Real-Time Analytics

**Enterprise Features:**
- Custom AI Workbench (private agents on YOUR docs)
- Customizable tools
- Private AI agents
- Cloud-based solution
- Enhanced privacy
- Extensive knowledge base
- Seamless integration
- Custom proposal developer
- Team seats ($2,000/seat/year)

### OpenGovIQ Pricing (APEX Illinois Quote)

| Tier | Annual Cost | Per Seat |
|------|-------------|----------|
| Foundation | $50,000/year | ~$3,333/seat (15 seats) |
| Accelerated | $68,000/year | ~$4,533/seat (15 seats) |
| Per-seat (standalone) | $2,000/seat/year | $167/mo |

---

## REVISED ARCHITECTURE: MI + OpenGovIQ = Complete Stack

The answer isn't "build team seats for MI." The answer is **unify MI + OpenGovIQ**.

### Product Stack (Unified)

| Layer | Product | Job | Price |
|-------|---------|-----|-------|
| **Intelligence** | MI (Market Intelligence) | Daily radar, briefings, bid targets | $149/mo |
| **Strategy** | Market Assassin | Deep market research | Included in MI or $297 one-time |
| **Execution** | OpenGovIQ | CRM, pipeline, proposals, AI agents | $167/mo/seat |
| **White Glove** | Coaches + Software | Done-for-you BD | $5K+/mo |

### How They Work Together

```
MI (Intelligence Layer)
├── Daily Bid Targets → "Here's what to pursue"
├── Weekly Deep Dives → "Here's what changed"
├── Pursuit Briefs → "Here's the analysis"
└── FEEDS INTO ↓

OpenGovIQ (Execution Layer)
├── Pipeline Management → Track the pursuit
├── Proposal Manager → Generate the response
├── AI Workbench → Private agents on your docs
├── Team Collaboration → Multiple seats
└── Deadline Tracking → Don't miss anything
```

### The Bundle That Competes with Deltek/Unanet

| Tier | What's Included | Annual Price | vs Deltek | vs Unanet |
|------|-----------------|--------------|-----------|-----------|
| **MI Pro** | Intelligence only (1 seat) | $1,788 | 86% less | 29% less |
| **MI + OpenGovIQ** | Intelligence + Execution (1 seat) | $3,792 | 87% less | 62% less |
| **Team (5 seats)** | Full stack for BD team | $12,000 | 59% less | 52% less |
| **Enterprise (15 seats)** | Full org deployment | $50,000 | 14% less | Equal |

### Competitive Position (Updated)

| Feature | Deltek | Unanet | MI + OpenGovIQ |
|---------|--------|--------|----------------|
| Daily AI briefings | ❌ | ❌ | ✅ |
| Private AI on your docs | ❌ | ❌ | ✅ |
| Proposal AI generation | ✅ | ✅ | ✅ |
| Team seat management | ✅ | ✅ | ✅ |
| Pipeline/CRM | ✅ | ✅ | ✅ |
| Custom AI agents | ❌ | ❌ | ✅ |
| Playbook automation | ❌ | ⚠️ | ✅ |
| BD coaching available | ❌ | ❌ | ✅ |
| Small business pricing | ❌ | ⚠️ | ✅ |
| Entry price | $13K/yr | $2.5K/yr | $1.8K/yr |

---

### Price Comparison (Annual)

| Tier | Deltek | Unanet | MI |
|------|--------|--------|-----|
| Entry/Basic | $13,000 | $2,500 | $1,788 |
| Standard | $29,000 (avg) | $10,000+ | $5,988 |
| Team/Pro | $50,000+ | $25,000+ | $30,000 |
| Enterprise | $119,000+ | $100,000+ | $60,000+ |

**Our positioning:**
> "Enterprise GovCon intelligence at small business prices"

---

### Competitive Strategy

**Don't compete on features with Deltek/Unanet.** They have 20+ years of data and enterprise features.

**Compete on:**
1. **Daily Value** - They get monthly dashboards, we send daily briefings
2. **Price** - 50-80% less than Deltek for similar intelligence
3. **Simplicity** - No 3-6 month implementation, start today
4. **Coaching** - White Glove includes human BD support
5. **Small Business Focus** - Built for <$10M contractors, not Lockheed

**Positioning Statement:**
> "Deltek is for contractors who can afford $30K/year. Unanet is for contractors who need ERP integration. MI is for contractors who just need to know what to pursue this week."

---

## REVISED Build Strategy

**Don't build team seats in MI. Use OpenGovIQ for execution layer.**

### What MI Needs (Intelligence Layer)
1. **Unified Navigation** - Single `/mi` entry point with tabs
2. **Feedback Loop** - Rate matches to improve intelligence
3. **Enhanced Bid Targets** - Why/Who/Win/Action per opportunity
4. **OpenGovIQ Integration** - "Add to Pipeline" button → pushes to OpenGovIQ

### What OpenGovIQ Already Has (Execution Layer)
- Team seat management ✅
- Pipeline/CRM ✅
- Proposal AI ✅
- Private AI agents ✅
- Workflow automation ✅

### New Build Order

1. **MI Unified Nav** (2-3 weeks) - Make MI feel like one product
2. **MI Feedback Loop** (1 week) - Learn what matches work
3. **MI ↔ OpenGovIQ Bridge** (2 weeks) - Push opportunities to OpenGovIQ pipeline
4. **Unified Login** (1 week) - Single auth across MI + OpenGovIQ

**Total to unified stack:** 6-7 weeks

### The Play

Instead of building team seats in MI:
- MI Pro ($149/mo) = Individual intelligence
- MI + OpenGovIQ ($317/mo) = Intelligence + Execution
- Team package (5 seats) = $1,000/mo = $12K/year

This is 59% less than Deltek and includes features they don't have (daily briefings, private AI agents).

---

## The Funnel That Sells Itself

**MI Free → MI Pro conversion funnel:**

1. **User signs up for MI Free** (OH + Daily Alerts)
2. **Daily email creates habit** — opens every morning
3. **Sees value but wants more** — "Why did this match me?"
4. **Upgrades to MI Pro** ($149/mo) for AI analysis
5. **MI Pro Annual** ($1,788/year) includes Market Assassin free

**Why this works:**
- Daily Alerts is the habit-forming hook
- Same onboarding (NAICS profile) for all users
- Clear value gap: simple list → AI intelligence
- 2026 SaaS best practice: hybrid freemium model

---

## Next Steps

1. [ ] Build unified `/mi` navigation shell
2. [ ] Add feedback buttons to daily briefings
3. [ ] Enhance bid targets with "Why/Who/Can I Win/Next Action"
4. [ ] Run beta with 100-250 paid customers
5. [ ] Test $99/mo vs $149/mo pricing
6. [ ] Build team seats for MI Team launch
7. [ ] Pitch Laurie at $499/mo × 5 seats = $2,495/mo (or individual seats at $149)

---

*Last Updated: May 3, 2026 — MI Free includes OH + Daily Alerts (habit-forming hook)*
