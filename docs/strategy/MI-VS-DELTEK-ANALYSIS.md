# MI vs. Deltek GovWin: Feature-by-Feature Analysis

**Created:** May 3, 2026
**Purpose:** Pre-Laurie call validation — what we have vs. what she needs

---

## Executive Summary

**Deltek GovWin IQ:** $13K-$119K/year (avg $29K)
**GovCon Giants MI:** $149/mo ($1,788/year) = **94% cheaper**

You've already built 80% of what Deltek offers. The gaps are fixable in 2-4 weeks.

---

## Feature Comparison Matrix

### Core Intelligence Features

| Feature | Deltek GovWin | GovCon Giants MI | Status | Gap Priority |
|---------|---------------|------------------|--------|--------------|
| **Opportunity Alerts** | Yes | **YES** - Daily briefings, filtered by NAICS/set-aside/agency | **BUILT** | N/A |
| **Pre-RFP Intel** | 3-5 years out | **YES** - 7,764 forecasts from 13 agencies | **BUILT** | N/A |
| **Contract Recompetes** | Yes | **YES** - Recompete Tracker + USASpending integration | **BUILT** | N/A |
| **Incumbent Identification** | Yes | **YES** - Weekly Deep Dive shows incumbents | **BUILT** | N/A |
| **Win Probability Scoring** | Yes ($29K tier) | **YES** - 6-factor scoring (75-point scale) | **BUILT** | N/A |
| **Agency Spending Analysis** | Yes | **YES** - USASpending integration, budget authority data | **BUILT** | N/A |
| **Agency Pain Points** | No | **YES** - 307 agencies, 3,045 pain points (EXCLUSIVE) | **BUILT** | N/A |
| **Competitor Tracking** | Yes | **PARTIAL** - Via recompete incumbents | ENHANCE | Medium |
| **Teaming Partner Finder** | Yes | **PARTIAL** - Contractor DB has 3,500+ contractors | ENHANCE | Medium |
| **AI Analysis** | "Ask Dela" chat | **YES** - AI briefings, code suggestions | **BUILT** | N/A |
| **Saved Search Alerts** | Yes | **YES** - Daily Alerts, Weekly Alerts | **BUILT** | N/A |
| **CRM/Pipeline Integration** | Salesforce | **YES** - BD Assist Pipeline Tracker (Kanban) | **BUILT** | N/A |
| **Multi-User/Team Access** | Yes | **PLANNED** - Team tier at $499/mo | BUILD | High |
| **Mobile App** | No | No | -- | Low |

### Data Sources

| Data Source | Deltek GovWin | GovCon Giants MI | Status |
|-------------|---------------|------------------|--------|
| SAM.gov Opportunities | Yes | **YES** - 24K+ cached | **BUILT** |
| USASpending Awards | Yes | **YES** - MCP integration | **BUILT** |
| FPDS/Contract Data | Yes | **YES** - Via SAM.gov (FPDS retired) | **BUILT** |
| Agency Forecasts | Yes | **YES** - 7,764 from 13 agencies | **BUILT** |
| Grants.gov | Unknown | **YES** - $700B+ federal grants | **BUILT** |
| SBIR/STTR | Unknown | **YES** - NIH RePORTER + Multisite | **BUILT** |
| Agency Hierarchy | Yes | **YES** - SAM.gov Federal Hierarchy | **BUILT** |
| Entity Registration | Yes | **YES** - SAM.gov Entity API | **BUILT** |
| Web Scraping/News | Yes (150 analysts) | **PARTIAL** - Built but not fully deployed | ENHANCE |
| Protests/GAO | Yes | **YES** - GAO High Risk in agency intel | **BUILT** |

### User Experience

| Feature | Deltek GovWin | GovCon Giants MI | Advantage |
|---------|---------------|------------------|-----------|
| Setup Time | Weeks (training required) | **Minutes** | GCG wins |
| Learning Curve | Steep ("takes time to refamiliarize") | **Simple** (5 inputs) | GCG wins |
| Interface | "Cumbersome" (per reviews) | **Modern** (Next.js/React) | GCG wins |
| Export | "Buggy" (per reviews) | **CSV/PDF clean export** | GCG wins |
| Speed | "Can get slow" (per reviews) | **Fast** (Vercel Edge) | GCG wins |
| Analysts | 150+ human analysts | **AI-powered** (no wait) | Trade-off |

---

## What We Have That Deltek Doesn't

### Exclusive GovCon Giants Features

| Feature | Description | Deltek Has? |
|---------|-------------|-------------|
| **Agency Pain Points Database** | 307 agencies, 3,045 pain points, 2,611 priorities | **NO** |
| **SAT Entry Point Analysis** | Find $250K contracts big firms ignore | **NO** |
| **One-Time Payment Option** | $497-$1,497 lifetime access | **NO** (subscription only) |
| **AI-Powered Content Generation** | LinkedIn posts from GovCon intel | **NO** |
| **Action Planner** | 5-phase, 36-task guided workflow | **NO** |
| **"60-Second Reports"** | 5 inputs → full market intel | **NO** (complex UI) |
| **Market Scanner 6 Questions** | Who's buying? How? Who has it? What's available? Events? Who to talk to? | **NO** |

---

## What We Need to Build for Enterprise (Laurie's Team)

### High Priority (Before Laurie Call)

| Feature | Current State | What's Needed | Effort |
|---------|---------------|---------------|--------|
| **Team Access** | Single user | Multi-seat ($499/mo for 5) | 1-2 weeks |
| **Admin Dashboard** | None | Team usage, billing, seats | 1-2 weeks |
| **Custom Briefings** | Profile-based | Company-specific pursuit tracking | 1 week |

### Medium Priority (After Initial Sale)

| Feature | Current State | What's Needed | Effort |
|---------|---------------|---------------|--------|
| **Competitor Alerts** | Via recompetes | Explicit competitor watch list | 2 weeks |
| **Enhanced Teaming** | Contractor DB list | Match scoring, outreach tracking | 2-3 weeks |
| **White-Label Reports** | GCG branding | Customer logo option | 1 week |
| **Monthly Exec Summary** | None | PDF report for leadership | 1 week |

### Low Priority (Future)

| Feature | Current State | What's Needed | Effort |
|---------|---------------|---------------|--------|
| **API Access** | Internal | External API for integrations | 4+ weeks |
| **Slack/Teams Integration** | None | Webhook notifications | 2 weeks |
| **Mobile App** | None | React Native or PWA | 8+ weeks |

---

## Pricing Comparison

| Tier | Deltek GovWin | GovCon Giants MI | Savings |
|------|---------------|------------------|---------|
| **Entry/Individual** | $13,000/year | **$1,788/year** ($149/mo) | **86%** |
| **Average** | $29,000/year | **$1,788/year** | **94%** |
| **Team (3-5 users)** | $40,000+/year | **$5,988/year** ($499/mo) | **85%** |
| **Enterprise** | $60,000-$119,000/year | **Custom (est. $15K-$25K)** | **75-80%** |

**The Pitch to Laurie:**
> "You're paying Deltek $60K/year for a database with a bad UI. We give you AI-powered intelligence for $149/month. Same insights, 97% cheaper. Your whole team can use it for what you pay for one Deltek seat."

---

## User Pain Points (From G2/Capterra Reviews)

### What Deltek Users Hate (Our Opportunity)

| Pain Point | User Quote | Our Solution |
|------------|------------|--------------|
| **Too expensive** | "It is a financial strain on the Small Business I work for" | $149/mo vs $29K/yr |
| **Prohibitive for new entrants** | "Not sure how a new company can afford this service" | Free tier + $49 entry |
| **Cumbersome UX** | "The ability to see notes is cumbersome, users have to click into opportunities" | Clean, simple UI |
| **Relearning required** | "If users haven't used it in a while, it takes time to refamiliarize" | Intuitive, no training |
| **Info overload** | "The sheer volume of information can be overwhelming" | AI-curated priorities |
| **Slow** | "At times the platform can get a little slow" | Fast, modern stack |
| **Buggy exports** | "Bugs with Query Builder, spreadsheets need better formatting" | Clean CSV/PDF |
| **No mobile** | "There is no app so users must use it on a computer" | Mobile-responsive (app later) |

---

## Interview Questions for Existing Customers

### For Ultimate Bundle Buyers (16 people)

**Goal:** Understand what they value most, what's missing, and if $149/mo subscription would work.

1. **"What's the ONE tool you use most frequently?"**
   - Market Assassin? Alerts? Opportunity Hunter? Briefings?
   - This reveals the core value driver

2. **"What made you buy during the bootcamp promo vs. waiting?"**
   - Price? Urgency? Eric's pitch? Complete package?
   - This reveals conversion triggers

3. **"If I gave you daily AI briefings on your target agencies for $149/mo, would that replace anything you're paying for now?"**
   - GovWin? GovTribe? Other tools?
   - This validates the Deltek positioning

4. **"What's missing that would make you recommend this to another contractor?"**
   - Team access? Better alerts? More agencies?
   - This reveals product gaps

5. **"Have you tried GovWin, GovTribe, or HigherGov? What made you leave/not use them?"**
   - Validates competitor weaknesses

### For OH Pro Buyers (18 people)

**Goal:** Understand upgrade potential and what would make MI Pro a no-brainer.

1. **"What do you do after you find an opportunity in Opportunity Hunter?"**
   - Research? Bid? Pass? Track?
   - This reveals workflow gaps

2. **"Would daily briefings that score opportunities by your win probability be worth $149/mo?"**
   - Yes/No + why
   - Validates MI Pro value prop

3. **"What's preventing you from upgrading to Ultimate Bundle?"**
   - Price? Don't need other tools? Didn't know about it?
   - Reveals conversion blockers

4. **"If your whole BD team could access this for $499/mo, would your company pay for it?"**
   - Validates team tier demand

### For Free Tool Users (sample 20)

**Goal:** Understand what would convert them to paid.

1. **"Why haven't you upgraded to paid yet?"**
   - Price? Don't see value? Using other tools?

2. **"What would make $149/mo for daily intelligence a no-brainer?"**
   - More features? Lower price? Free trial?

3. **"What tools are you paying for today for GovCon intelligence?"**
   - Reveals competitive landscape

---

## Validation Checklist (Before Laurie Call)

### Must Confirm with Existing Users

- [ ] Do they value daily briefings? (vs. weekly or on-demand)
- [ ] Is win probability scoring useful? (or ignored)
- [ ] Would they pay $149/mo for this as a subscription?
- [ ] Would they want team access? How many seats?
- [ ] Are they currently paying for GovWin/GovTribe/HigherGov?
- [ ] What's the ONE feature they can't live without?

### Must Have Ready for Laurie Demo

- [ ] Live MI dashboard with her NAICS codes
- [ ] Sample daily briefing email
- [ ] Sample weekly deep dive
- [ ] Team tier pricing ($499/mo for 5 seats)
- [ ] Comparison table vs. Deltek
- [ ] "Start for free" or "$149/mo pilot" offer

### Must Answer for Laurie

1. **"How is this different from Deltek?"**
   - AI-powered vs. database
   - 94% cheaper
   - Modern UI, fast setup
   - Same data sources + exclusives (pain points)

2. **"Can my whole team use it?"**
   - Yes, $499/mo for 5 seats
   - Or custom enterprise pricing

3. **"What if we need custom features?"**
   - Enterprise tier includes custom briefings
   - API access planned

4. **"How quickly can we start?"**
   - Today. 5-minute setup.
   - First briefing tomorrow morning.

---

## The Bottom Line

**What you've built:**
- 80% of Deltek's features
- 94% cheaper
- Better UX (per competitor reviews)
- Exclusive features (pain points, SAT analysis)

**What you need for enterprise:**
- Team access (1-2 weeks)
- Custom briefings (1 week)
- Admin dashboard (1-2 weeks)

**Interview strategy:**
1. Call 5-10 Ultimate Bundle buyers this week
2. Validate $149/mo subscription model
3. Confirm team tier demand
4. Then call Laurie with confidence

---

*"You don't need to build more. You need to validate what you have."*
