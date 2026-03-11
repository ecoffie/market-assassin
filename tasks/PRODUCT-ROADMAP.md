# GovCon Giants: Enterprise Product Roadmap

## Strategic Vision: The $997/year Deltek Killer

**Goal:** Build a full-stack GovCon intelligence and operations platform that delivers 80% of GovWin IQ's value at 2% of the cost, specifically designed for small businesses ($1M-$50M revenue).

**Competitive Positioning:**
| Competitor | Annual Cost | Target Market | Our Advantage |
|------------|-------------|---------------|---------------|
| Deltek GovWin IQ | $13,000 - $119,000 | Mid-market to Enterprise | 10-100x cheaper, AI-native |
| Bloomberg BGOV | $8,000 - $25,000 | Large contractors | Small business focus |
| GovDash | $15,000 - $50,000 | Mid-market | No per-seat pricing |
| Federal Compass | $5,000 - $15,000 | All sizes | More actionable intelligence |
| GovTribe Pro | $600/year | Small business | More comprehensive tools |
| **GovCon Giants** | **$997/year** | Small business | All-in-one platform |

---

## Current State (What We Have)

### Tools Live Today
1. **Federal Market Assassin** - Agency pain points, spending analysis, market assessment
2. **Recompete Tracker** - 5,000+ expiring contracts with USASpending links
3. **Federal Contractor Database** - 3,500+ contractors with SBLO contacts
4. **Opportunity Hunter** - NAICS-based opportunity discovery
5. **Daily Briefings** - Personalized intel emails (opportunities, awards, recompetes)
6. **Content Reaper** - AI LinkedIn post generator

### Current Pricing
- Individual tools: $49 - $497
- Pro Giant Bundle: $997 (includes 1 year briefings)
- Ultimate Bundle: $1,497 (lifetime briefings)
- Federal Help Center: $99/month

---

## Phase 1: Core Intelligence Platform (Q2 2026)
**Theme:** Close the intelligence gap with GovWin

### 1.1 Labor Rate Analytics 🎯 **HIGH PRIORITY**
*GovWin charges $7,000+ extra for this feature alone*

**Features:**
- GSA Schedule labor rate database (scrape CALC+ data)
- Rate comparison by labor category, region, contract vehicle
- Historical rate trends (2020-2026)
- "Price to Win" calculator
- Export for proposal pricing

**Data Sources:**
- [GSA CALC+](https://calc.gsa.gov/) - Free public data
- USASpending labor category obligations
- GSA Advantage schedule prices

**Implementation:**
```
/labor-rates page
- Search by labor category (e.g., "Senior Software Engineer")
- Filter by contract vehicle (OASIS+, Alliant 2, GSA MAS)
- Show min/median/max rates
- Regional adjustments
- Export to Excel
```

**Monetization:** Premium feature in Market Assassin Premium or standalone $197/year

---

### 1.2 Pipeline CRM (Capture Tracker)
*Replace spreadsheet chaos*

**Features:**
- Opportunity pipeline with Shipley-style gates (Qualify → Capture → Proposal → Award)
- Go/No-Go decision matrices
- Win probability scoring
- Competitor tracking per opportunity
- Activity timeline
- Team assignments
- Due date alerts via Daily Briefings

**Database Schema:**
```sql
pipeline_opportunities (
  id, user_email, opportunity_id,
  stage (qualify/capture/proposal/submitted/won/lost),
  win_probability, estimated_value,
  competitors[], teammates[],
  go_nogo_score, notes,
  next_action, next_action_date,
  created_at, updated_at
)

pipeline_activities (
  id, opportunity_id, user_email,
  activity_type (note/meeting/call/document/decision),
  description, created_at
)
```

**Integration:**
- Auto-populate from Opportunity Hunter saves
- Sync with Daily Briefings for deadline alerts
- Import from SAM.gov saved searches

**Monetization:** Included in Pro Giant+ bundles, or $297/year standalone

---

### 1.3 Teaming Partner Network
*GovWin charges extra for teaming intelligence*

**Features:**
- Match contractors by NAICS, certifications, past performance
- "Looking for Prime" / "Looking for Sub" marketplace
- Joint venture compatibility scoring
- NDA/Teaming Agreement templates
- In-platform messaging
- Past teaming history from USASpending

**Data Sources:**
- Our Contractor Database (3,500+ companies)
- SAM.gov entity registrations
- USASpending subcontractor data
- User-submitted profiles

**Implementation:**
```
/teaming-network page
- Profile creation wizard
- Search by capability, certification, agency experience
- "Match score" algorithm
- Request introduction
- Track teaming relationships
```

**Monetization:** Free basic search, premium matching in Pro Giant+

---

### 1.4 Enhanced Daily Briefings
*Make briefings the command center*

**New Briefing Sections:**
- Pipeline deadline reminders (from CRM)
- Teaming partner activity (from network)
- Labor rate changes relevant to your contracts
- Competitor win/loss tracking
- Agency budget news (from web intel)

**Delivery Enhancements:**
- Slack integration
- Microsoft Teams webhook
- SMS alerts for urgent items
- Weekly digest PDF export

---

## Phase 2: Capture & Proposal Suite (Q3 2026)
**Theme:** Win more contracts with AI

### 2.1 AI Proposal Writer 🎯 **HIGH PRIORITY**
*GovDash charges $15K+ for this*

**Features:**
- Upload RFP → AI extracts requirements
- Section L/M parsing
- Compliance matrix generation
- Win theme suggestions based on agency pain points
- Past performance narrative generator
- Technical approach outline generator
- Management approach templates
- Export to Word/Google Docs

**Implementation:**
```
/proposal-assistant page
1. Upload RFP (PDF/Word)
2. AI extracts: sections, requirements, evaluation criteria
3. Generate compliance matrix
4. Suggest win themes (using our pain points data)
5. Draft section outlines
6. Export to Word with formatting
```

**AI Stack:**
- Claude/GPT-4 for generation
- Our agency pain points database for context
- Past performance library for examples
- RAG over user's previous proposals

**Monetization:** $497/year standalone or included in Ultimate bundle

---

### 2.2 Compliance Matrix Builder

**Features:**
- Auto-parse Section L/M from RFP
- Map requirements to proposal sections
- Track compliance status (compliant/partial/non-compliant)
- Flag missing requirements
- Export to Excel/Word

**Implementation:**
- PDF parsing with Claude vision
- Structured output to database
- Collaborative editing (team)

---

### 2.3 Past Performance Library

**Features:**
- Store past performance narratives
- Tag by NAICS, agency, contract type, keywords
- Search and reuse across proposals
- CPARS score tracking
- Relevance matching to new opportunities

**Database Schema:**
```sql
past_performance (
  id, user_email, contract_name,
  agency, contract_number,
  period_start, period_end,
  contract_value, naics_codes[],
  narrative_problem, narrative_solution, narrative_results,
  cpars_score, relevance_tags[],
  created_at
)
```

---

### 2.4 Win Theme Generator

**Features:**
- Input opportunity details
- AI generates 3-5 discriminating win themes
- Based on agency pain points + competitor weaknesses
- Ghosting strategies
- Theme-to-section mapping

---

## Phase 3: Contract Lifecycle Management (Q4 2026)
**Theme:** Post-award operations

### 3.1 Contract Tracker Dashboard

**Features:**
- All active contracts in one view
- Period of performance tracking
- Option exercise alerts (60/90/120 days out)
- Funding status (obligated vs. ceiling)
- CLIN/SLIN management
- Key personnel tracking
- Deliverables calendar

**Data Sources:**
- User input + FPDS/USASpending sync
- SAM.gov award data

---

### 3.2 Modification Alerts

**Features:**
- Track contract modifications in real-time
- Alert on funding changes, scope changes, extensions
- Competitor contract mod tracking
- Export mod history

**Implementation:**
- Daily FPDS/USASpending delta checks
- Match against user's tracked contracts
- Include in Daily Briefings

---

### 3.3 Subcontract Management

**Features:**
- Track subcontractor agreements
- Flow-down clause library
- Invoice/payment tracking
- Small business subcontracting plan monitoring
- Subcontractor performance ratings

---

### 3.4 CDRL/Deliverables Tracker

**Features:**
- Upload CDRL list from contract
- Due date calendar
- Submission tracking
- Government acceptance status
- Recurring deliverable automation

---

## Phase 4: Financial & Compliance Layer (2027)
**Theme:** Lightweight ERP features

### 4.1 DCAA-Lite Accounting Integration
*Not replacing QuickBooks, but augmenting it*

**Features:**
- Indirect rate calculator (fringe, overhead, G&A)
- Provisional vs. actual rate tracking
- Contract-level profitability analysis
- Incurred cost submission prep
- Timesheet compliance checking

**Integration Options:**
- QuickBooks Online API
- Export/import CSV
- Manual entry

**Why NOT full ERP:**
- Small businesses already use QuickBooks
- DCAA compliance is about structure, not software
- Focus on GovCon-specific calculations

---

### 4.2 Cost Estimating Tool

**Features:**
- Labor rate build-up worksheets
- Wrap rate calculator
- Material cost tracking
- Travel cost estimator
- Subcontractor cost rollup
- Total price summary

**Templates:**
- T&M pricing
- FFP pricing
- Cost-plus pricing

---

### 4.3 Proposal Pricing Module

**Features:**
- Build pricing from labor rates
- Apply indirect rates
- Fee/profit calculator
- Price-to-win analysis
- What-if scenarios
- Export to Excel

---

### 4.4 Invoice Generator

**Features:**
- Contract-compliant invoice templates
- SF-1034/1035 formats
- Wide Area Workflow (WAWF) guidance
- Invoice tracking
- Payment status

---

## Integration Priorities

### Must-Have Integrations (Phase 1-2)
| System | Purpose | Method |
|--------|---------|--------|
| SAM.gov | Opportunity sync, entity data | API |
| USASpending | Award data, contractor intel | API |
| GSA CALC+ | Labor rates | Scrape + API |
| QuickBooks Online | Financial data | OAuth API |
| Google Workspace | Docs, Sheets export | API |
| Microsoft 365 | Word, Excel export | API |
| Slack | Notifications | Webhook |
| Zapier | Custom automations | API |

### Nice-to-Have Integrations (Phase 3-4)
| System | Purpose | Method |
|--------|---------|--------|
| Salesforce | CRM sync | API |
| HubSpot | CRM sync | API |
| Asana/Monday | Project management | API |
| DocuSign | Contract signing | API |
| SharePoint | Document management | API |

---

## Pricing Strategy

### New Tier Structure

| Tier | Annual Price | Target | Includes |
|------|--------------|--------|----------|
| **Starter** | $497/year | New contractors | Opp Hunter Pro, Recompete Tracker, Contractor DB |
| **Professional** | $997/year | Active BD | Everything in Starter + Market Assassin, Daily Briefings, Pipeline CRM |
| **Enterprise** | $1,997/year | Scaling teams | Everything in Pro + AI Proposal Writer, Labor Analytics, Teaming Network |
| **Agency** | $4,997/year | BD consultants | White-label, unlimited clients, API access |

### Per-Seat vs. Unlimited
**Decision: Unlimited seats per company**
- Differentiator from Deltek/GovWin
- Simplifies sales
- Encourages adoption
- Fair use policy for abuse

---

## Success Metrics

### Year 1 Goals (2026)
- [ ] 500 paying subscribers
- [ ] $250K ARR
- [ ] <5% monthly churn
- [ ] Net Promoter Score >50

### Year 2 Goals (2027)
- [ ] 2,000 paying subscribers
- [ ] $1M ARR
- [ ] Enterprise tier adoption >20%
- [ ] AI Proposal Writer generating 100+ proposals/month

### Year 3 Goals (2028)
- [ ] 5,000 paying subscribers
- [ ] $3M ARR
- [ ] Series A ready
- [ ] Competitive with GovWin for small business segment

---

## Technical Architecture

### Current Stack
- Next.js 16 + React 19 + TypeScript
- Supabase PostgreSQL
- Vercel hosting
- Vercel KV for access control
- Stripe payments
- OpenAI/Anthropic for AI

### Scaling Considerations
- Move to dedicated PostgreSQL at 10K users
- Add Redis for caching
- Consider Cloudflare Workers for edge
- Implement proper job queue (Inngest/Trigger.dev)
- Add monitoring (Sentry, LogRocket)

---

## Competitive Moats

### What We Can Build That GovWin Can't:
1. **AI-Native** - Built with LLMs from day one, not bolted on
2. **Small Business Focus** - Features designed for <$50M contractors
3. **Transparent Pricing** - No sales calls, no enterprise contracts
4. **Community-Driven** - Teaming network creates network effects
5. **Integrated Platform** - One login, one database, one workflow

### What Will Be Hard to Replicate:
1. Agency pain points database (2,765 entries, proprietary)
2. Small business-focused UX
3. Daily briefings personalization
4. Teaming network data
5. Price point ($997 vs $25,000)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GovWin launches cheap tier | Medium | High | Speed to market, feature differentiation |
| AI regulation impacts proposal tools | Low | Medium | Human-in-loop design, compliance focus |
| Data source APIs change | Medium | Medium | Multiple data sources, caching |
| Customer acquisition cost too high | Medium | High | Content marketing, referral program |
| Feature creep delays core product | High | High | Strict phase gates, MVP mentality |

---

## Next Steps

### Immediate (This Week)
1. [ ] Validate labor rate data sources (CALC+, GSA Advantage)
2. [ ] Design Pipeline CRM database schema
3. [ ] Prototype labor rate search UI
4. [ ] Survey existing customers on priorities

### This Month
1. [ ] Build Labor Rate Analytics MVP
2. [ ] Design Pipeline CRM UI
3. [ ] Add Slack integration to Daily Briefings
4. [ ] Create teaming network profile schema

### This Quarter
1. [ ] Launch Labor Rate Analytics
2. [ ] Launch Pipeline CRM
3. [ ] Begin Teaming Network development
4. [ ] Pilot AI Proposal Writer with 10 customers

---

## Sources & Research

- [Deltek GovWin IQ](https://www.deltek.com/en/government-contracting/govwin) - $13K-$119K/year
- [GovWin IQ Pricing via Vendr](https://www.vendr.com/buyer-guides/govwin-iq) - Average $29K/year
- [GovWin Labor Pricing Analytics](https://www.deltek.com/en/blog/labor-pricing-strategy-federal-contracts) - 15M+ labor rates
- [GovDash AI Platform](https://www.govdash.com/) - AI proposal writing
- [Top GovCon Solutions 2025](https://blog.procurementsciences.com/psci_blogs/the-best-govcon-solutions-in-2025)
- [GovWin Alternatives](https://constructionbids.ai/blog/govwin-alternative-federal-contractors-guide)
- [Federal Compass Alternative](https://www.federalcompass.com/blog/alternative-to-govwin)
- [GSA CALC+ Tool](https://calc.gsa.gov/) - Free labor rate data

---

*Created: March 11, 2026*
*Last Updated: March 11, 2026*
