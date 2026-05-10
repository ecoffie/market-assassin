# MI Launch Master Plan

**Date:** May 4, 2026
**Purpose:** Complete buildout plan, rollout strategy, pricing, and bootcamp redesign

**Strategic context:** See `GOVCON-GIANTS-STRATEGIC-TRANSITION-MEMO.md`

---

## Current Production Baseline - May 9, 2026

MI beta is now deployed as the working bridge from the old training/tools model into the unified SaaS product.

### What Is Live

- Email + password login for MI beta with optional 2FA.
- Forgot/reset password flow.
- Account setup support for entitled users who still need to create a password identity.
- Dashboard labels that separate customer inventory from recent movement, so the team can see what is growing, what is slipping, and what needs intervention.
- Admin metrics reframed around useful levers: profile setup, active alert audience, email clicks, helpful/not helpful feedback, and time spent in MI.

### What This Means for Launch

The launch message should keep pointing to one outcome:

> Market Intelligence helps small businesses find federal contracts they would have missed and move the right ones toward a win.

The dashboard should support that same operating rhythm:

- Who joined or was imported?
- Who finished enough profile data for MI to work?
- Who opened, clicked, saved, searched, or came back?
- Which opportunities moved into pipeline, teaming, proposal, submitted, won, or lost?
- Which users need profile help, better matches, fewer alerts, or a higher-touch service path?

### Immediate Launch Priorities

1. Fix and rebrand account setup/password reset email templates.
2. Send setup links to MI Free and MI Pro users who have entitlement but no login identity.
3. Finish beta screen/database alignment for forecasts, grants, recompetes, contractors, pipeline, and teaming.
4. Redirect old `.org` website paths to the new `.com` site so public links stop timing out.
5. Keep 10-10 Forever outreach focused on users who show behavior: profile completion, email engagement, product usage, pipeline movement, and buying history.
6. Build the internal MI Launch Command Center so Annelle, Sikander, Ryan, Zach, Randie, Eric, and product/engineering work from one private source of truth instead of CSVs, Slack fragments, and manual email updates.

## Table of Contents

1. [The New Pitch](#1-the-new-pitch)
2. [APEX Alignment](#2-apex-alignment)
3. [Buildout Plan](#3-buildout-plan)
4. [Pricing Strategy](#4-pricing-strategy)
5. [Rollout Strategy](#5-rollout-strategy)
6. [5/30 Bootcamp Redesign](#6-530-bootcamp-redesign)
7. [Document Updates Needed](#7-document-updates-needed)

---

## 1. The New Pitch

### The Problem (What They Know)

> "To win government contracts, you used to need 11 disconnected platforms:
>
> 1. **SAM.gov** for opportunities
> 2. **USASpending.gov** for award history
> 3. **FPDS** for contract data (now retired)
> 4. **GSA Calc** for pricing benchmarks
> 5. **Grants.gov** for grants
> 6. **Acquisition.gov** for forecasts
> 7. **Agency OSDBU sites** for contacts
> 8. **Google Sheets** to track everything
> 9. **Google Docs** for proposals
> 10. **Your inbox** for deadlines
> 11. **Prayer** that you don't miss something
>
> That's 11 tabs, 11 logins, and zero integration.
>
> **We taught you how to use all 11. Now we've integrated them into one.**"

### The Solution

> "**Market Intelligence** brings it all together:
>
> - **Daily Briefings** tell you what to pursue today
> - **Market Research** shows you who's buying and why
> - **Pipeline** tracks your pursuits in one place
> - **AI** writes your proposals and responses
>
> One platform. One login. Everything a BD team needs."

### Product Consolidation

| Old Name | New Name | Role |
|----------|----------|------|
| Opportunity Hunter | **MI Free** | Lead capture (limited search) |
| Market Assassin | **MI Pro** | Paid (full intel + briefings) |
| All other tools | **MI Features** | Included in MI Pro |
| OpenGovIQ | **MI Execution** | CRM + Proposals + AI |

---

## 2. Growth Channels

### Channel 1: Direct (Email + Bootcamps)
- 25,000 email list
- 9,000 warm leads
- Monthly bootcamps
- Livestreams (3x/week)
- Coach-led customer-success and validation loops from Ryan, Zach, and Randie

### Channel 2: APEX Accelerators (Future)
**See:** `APEX-GROWTH-STRATEGY.md` (separate document)

APEX Accelerators counsel 30,000+ small businesses annually across 90+ locations. They're a potential distribution channel for MI — their clients ARE our target customer.

*Research needed before pursuing.*

### Channel 3: Strategic Partnerships
- Encore Funding model ($5,767/mo)
- White Glove clients ($6K/mo)
- Replicate with similar organizations
- Coaches help surface partner leads, enterprise referrals, and white-glove candidates through their calls, livestreams, and organization relationships.

### Internal Operating Channel: MI Launch Command Center

**See:** `MI-INTERNAL-COMMAND-CENTER-PRD.md`

The launch should not depend on manual file passing. The command center becomes the one private link for:

- Annelle/Sikander outreach queue
- Ryan/Zach/Randie coach activity
- Customer notes and outcome tags
- 10-10 Forever candidates
- White-glove candidates
- Latest team memo
- Launch metrics and open decisions

---

## 3. Buildout Plan

### Phase 1: Foundation (Weeks 1-4)

| Task | Owner | Effort | Priority |
|------|-------|--------|----------|
| Export Base44 OpenGovIQ schemas | Eric | 2 days | P0 |
| Document all Base44 automations | Eric | 1 day | P0 |
| Count records per entity | Eric | 1 day | P0 |
| Design unified `/mi` navigation wireframe | Eric | 2 days | P0 |
| Create Supabase migration tables | Dev | 1 week | P0 |
| Build unified navigation shell | Dev | 2 weeks | P0 |
| Add feedback buttons to briefings | Dev | 3 days | P1 |

**Deliverable:** Unified nav with all existing MI tools under one roof.

### Phase 2: OpenGovIQ Migration (Weeks 5-8)

| Task | Owner | Effort | Priority |
|------|-------|--------|----------|
| Rebuild Contact/CRM UI | Dev | 1 week | P0 |
| Rebuild Pipeline UI | Dev | 1 week | P0 |
| Rebuild Proposal Manager | Dev | 1 week | P1 |
| Rebuild AI Workbench | Dev | 1 week | P1 |
| Migrate automations to Vercel crons | Dev | 3 days | P1 |
| Migrate live data from Base44 | Dev | 2 days | P0 |

**Deliverable:** Full OpenGovIQ functionality in Next.js/Supabase.

### Phase 3: Team Features (Weeks 9-10)

| Task | Owner | Effort | Priority |
|------|-------|--------|----------|
| Build team seat management | Dev | 1 week | P0 |
| Build admin dashboard | Dev | 1 week | P0 |
| Build per-user alert preferences | Dev | 3 days | P1 |
| Build team activity feed | Dev | 2 days | P2 |

**Deliverable:** MI Team tier ready for Laurie Sayles pitch.

### Phase 4: Polish & Launch (Weeks 11-12)

| Task | Owner | Effort | Priority |
|------|-------|--------|----------|
| Unified login/auth | Dev | 3 days | P0 |
| Billing/subscription integration | Dev | 3 days | P0 |
| Onboarding flow | Dev | 2 days | P1 |
| Documentation/help | Content | 3 days | P1 |
| Beta test with existing customers | Team | 1 week | P0 |
| Public launch | Team | 1 day | P0 |

**Deliverable:** Unified MI platform live.

### Timeline Summary

| Phase | Weeks | Goal |
|-------|-------|------|
| **1. Foundation** | 1-4 | Unified nav + Base44 export |
| **2. Migration** | 5-8 | OpenGovIQ in Next.js |
| **3. Team Features** | 9-10 | Team tier ready |
| **4. Launch** | 11-12 | Public launch |
| **TOTAL** | **12 weeks** | **Full unified platform** |

---

## 4. Pricing Strategy

### The Pricing Ladder

| Tier | Monthly | Annual | What's Included |
|------|---------|--------|-----------------|
| **MI Free** | $0 | $0 | OH + Daily Alerts, lead capture |
| **MI Beta** | $49 | $588 | Full access, expires [DATE] |
| **MI Pro** | $149 | $1,788 | Full intelligence + Pipeline + CRM (1 seat) |
| **MI Team** | $499 | $5,988 | 5 seats, shared pipeline, admin |
| **MI Enterprise** | Contact Sales | Contact Sales | 15+ seats, API, white-label |
| **White Glove** | $5,000+ | $60,000+ | Done-for-you BD + coaching |

### Beta → Core Transition

**Current Beta:** $49/mo
**Core Price:** $149/mo
**Transition Date:** July 31, 2026 (90 days from launch)

#### Beta Messaging

> **"Founding Member Pricing: $49/mo"**
>
> You're getting MI at 67% off because you're helping us build it.
>
> - Your feedback shapes the product
> - You lock in $49/mo for 12 months
> - After July 31, new members pay $149/mo
>
> **[Lock In $49/mo →]**

#### Transition Email (July 15)

> **Subject: Your $49/mo rate expires July 31**
>
> You've been with us since the beta. Thank you.
>
> On August 1, MI goes to $149/mo for new members.
>
> **Your options:**
> 1. **Stay at $49/mo** — Lock in annual ($588/year) before July 31
> 2. **Move to $149/mo** — Monthly billing continues
> 3. **Upgrade to MI Team** — $499/mo for your whole team
>
> **[Lock In $49/mo Annual →]**

### Comparison Pricing

| Competitor | Entry | Team (5 seats) | Enterprise |
|------------|-------|----------------|------------|
| **Deltek GovWin** | $13K/year | $60K/year | $119K/year |
| **Unanet GovIntel** | $2.5K/year | $30K/year | $50K+/year |
| **MI (Us)** | **$1,788/year** | **$5,988/year** | **Contact Sales** |
| **Savings vs Deltek** | 86% | 90% | — |

---

## 5. Rollout Strategy

### The Lists

| List | Size | Quality | Use |
|------|------|---------|-----|
| **9,000 leads** | 9,000 | Warm (clicked/opened) | Beta → Pro conversion |
| **25,000 emails** | 25,000 | Mixed (cold + warm) | Awareness → Free |

### NOT All at Once

**From Wealth GENIUS framework:** The 9,000 are your unfair advantage, but the beta should be curated.

### Wave Strategy

| Wave | Who | Size | When | Goal |
|------|-----|------|------|------|
| **1** | Paid customers (FHC, bundles, Ultimate) | 100-250 | Week 1-2 | Beta validation |
| **2** | Alert users ($19/mo) + MI buyers ($49/mo) | 200-300 | Week 3-4 | Power user feedback |
| **3** | Warm leads (opened/clicked last 30 days) | 500-1,000 | Week 5-6 | Early adopter conversion |
| **4** | All 9,000 leads | 9,000 | Week 7-8 | Full lead activation |
| **5** | Cold list reactivation | 15,000 | Week 9-10 | List cleaning |
| **6** | Public launch | Everyone | Week 11+ | New acquisition |

### Wave 1: Paid Customers (100-250)

**Email Subject:** "You're first: New Market Intelligence platform"

**Message:**
> You've invested in GovCon Giants before. Now we're building something bigger.
>
> **Market Intelligence** — One platform for everything:
> - SAM.gov opportunities
> - USASpending awards
> - Forecasts from Acquisition.gov
> - Grants.gov grants
> - Daily AI briefings
> - Proposal AI
>
> **You used to need 11 platforms. Now you need one.**
>
> As a past customer, you get:
> - **First access** to the beta
> - **$49/mo** founding member pricing (vs $149/mo at launch)
> - **Direct line** to Eric for feedback
>
> **[Join the Beta →]**

### Wave 2: Alert Users (200-300)

**Email Subject:** "Your alerts are about to get smarter"

**Message:**
> You're already getting opportunity alerts at $19/mo.
>
> **What if you got more?**
>
> - Daily AI briefings (not just alerts)
> - Full market research tools
> - Recompete tracking
> - Agency spending analysis
> - Forecast intelligence
>
> **Upgrade to MI Pro: $49/mo** (founding member price)
>
> Same alerts. 10x the intelligence.
>
> **[Upgrade Now →]**

### Wave 3: Warm Leads (500-1,000)

**Email Subject:** "Stop using 11 platforms to win contracts"

**Message:**
> You know the pain:
> - SAM.gov for opportunities
> - USASpending for history
> - Google Sheets to track everything
> - Prayer that you don't miss a deadline
>
> **We built one platform to replace all 11.**
>
> Market Intelligence gives you:
> - Daily briefings on your target agencies
> - Full opportunity search + filtering
> - AI-powered proposals
> - One login. One dashboard.
>
> **Try it free →** then $49/mo (for founding members)
>
> **[Start Free →]**

### Wave 4: All 9,000 Leads

**Email Subject:** "The tool Deltek doesn't want you to know about"

**Message:**
> Deltek GovWin costs $60,000/year.
>
> **We built the same thing for $1,788/year.**
>
> - Same opportunity tracking
> - Same agency intelligence
> - Same forecast data
> - **Plus** daily AI briefings (they don't have)
> - **Plus** proposal AI (they charge extra)
>
> 97% cheaper. Built for small business.
>
> **[See the Demo →]**

### Wave 5: Cold List Reactivation

**Email Subject:** "We haven't talked in a while"

**Message:**
> Last time we connected, we were teaching government contracting.
>
> **Now we're building tools.**
>
> Market Intelligence is a single platform that replaces:
> ✓ SAM.gov searching
> ✓ USASpending research
> ✓ Google Sheets tracking
> ✓ Manual deadline management
>
> Daily AI briefings tell you what to pursue.
> No more guessing.
>
> **[Try It Free →]**

### Success Metrics by Wave

| Wave | Target Conversions | Revenue Goal |
|------|-------------------|--------------|
| **1** | 25 (10% of 250) | $1,225 MRR |
| **2** | 30 (10% of 300) | $1,470 MRR |
| **3** | 50 (5% of 1,000) | $2,450 MRR |
| **4** | 200 (2% of 9,000) | $9,800 MRR |
| **5** | 50 (0.3% of 15,000) | $2,450 MRR |
| **TOTAL** | **355 subscribers** | **$17,395 MRR** |

---

## 6. 5/30 Bootcamp Redesign

### Current Bootcamp Focus
Generic GovCon training — "How to Win Government Contracts"

### New Bootcamp Focus
**Platform Demo + Pathway to Execution** — "Win contracts you would not have found on your own"

This bootcamp is not another training event. It is the public transition from training-first GovCon Giants to a platform-and-services company.

**Bootcamp goals:**
- Show the Market Intelligence platform producing real federal-contract intelligence.
- Help attendees configure enough profile data for the platform to work.
- Surface serious operators for MI subscription, Ultimate Bundle, team accounts, and white-glove.
- Use proof stories and customer behavior instead of more generic instruction.

### Proposed Agenda

| Time | Session | Content |
|------|---------|---------|
| **9:00 AM** | **The New GovCon Giants** | From training company to platform-and-services company |
| **9:30 AM** | **The Problem** | Why 11 disconnected platforms make small businesses miss winnable contracts |
| **10:00 AM** | **Live Demo: Daily Briefings** | Real opportunities, why they match, and what to do next |
| **10:30 AM** | **Break** | |
| **10:45 AM** | **Live Demo: Market Research** | From NAICS to agency, incumbent, spend, and recompete path |
| **11:15 AM** | **Customer Proof** | Stories from users/operators who found or won work through better intelligence |
| **11:45 AM** | **Activation Block** | Set NAICS, agencies, certifications, alerts, and briefing preferences |
| **12:30 PM** | **Lunch** | |
| **1:30 PM** | **Deal Flow / Pipeline Demo** | Turn matched opportunities into a pursuit board |
| **2:30 PM** | **Teaming + White-Glove Path** | When to self-serve, when to team, when to ask for done-for-you help |
| **3:30 PM** | **Break** | |
| **3:45 PM** | **Team Features** | Admin access, team seats, shared pipeline, and future Deal Flow Board |
| **4:30 PM** | **Choose Your Path** | MI self-serve, Ultimate Bundle, team account, or white-glove application |
| **5:00 PM** | **Close** | |

### Bootcamp Offer

**During bootcamp:**
> "Market Intelligence is now your primary access path to GovCon Giants. If you want to self-serve, join MI. If you want us closer to the execution, apply for team or white-glove support.
>
> Today we are giving you a path based on your level of commitment: MI self-serve, Ultimate Bundle, MI Team, or white-glove."

### Bootcamp Positioning

**Old:** "Learn how to win government contracts"
**New:** "See the platform and service path that helps you find and win contracts you would not have found on your own"

**Why this works:**
- They leave with a working account (not just knowledge)
- They see the value before buying
- The offer maps to commitment level instead of forcing everyone into the same training product
- Team and white-glove conversations become natural for serious operators

---

## 7. Document Updates Needed

### Documents to Update

| Document | Update Needed |
|----------|---------------|
| **FULL-BUSINESS-INTELLIGENCE-BRIEF.md** | Add unified platform pitch, OH+MA consolidation |
| **MONDAY-TEAM-CALL-MEMO.md** | Add unified platform section, bootcamp redesign |
| **MI-SAAS-PRICING-STRATEGY.md** | Update with $49 beta → $149 core transition |
| **UNIFIED-PLATFORM-ARCHITECTURE.md** | Already updated ✅ |
| **MI-UNIFIED-PRODUCT-ARCHITECTURE.md** | Already updated ✅ |

### New Documents Created

| Document | Purpose |
|----------|---------|
| **MI-LAUNCH-MASTER-PLAN.md** | This document - comprehensive launch plan |

### Update Summary for Brief + Memo

**Add to FULL-BUSINESS-INTELLIGENCE-BRIEF.md:**

1. **New Pitch Section:**
   - "11 platforms → 1 platform" messaging
   - OH + MA consolidation (both become MI)

2. **Unified Platform Section:**
   - Link to UNIFIED-PLATFORM-ARCHITECTURE.md
   - Base44 migration plan

3. **APEX Alignment:**
   - Show how MI Enterprise matches APEX quote
   - Pricing comparison

**Add to MONDAY-TEAM-CALL-MEMO.md:**

1. **Product Consolidation:**
   - OH becomes MI Free
   - MA becomes MI Pro
   - All tools under one MI umbrella

2. **5/30 Bootcamp:**
   - New agenda focused on MI launch
   - Workshop format vs lecture format

3. **Rollout Waves:**
   - 6-wave strategy overview
   - Coach role in each wave

---

## Summary: What Happens Next

### This Week (May 4-9)
1. ✅ Complete validation (Two Questions)
2. Update Brief + Memo with unified platform pitch
3. Begin Base44 export

### Next Week (May 10-16)
1. Aggregate validation data
2. Call Laurie Sayles with unified platform pitch
3. Finalize buildout timeline
4. Start Wave 1 emails to paid customers

### May 30 Bootcamp
1. Redesign agenda for MI launch
2. Workshop format (not lecture)
3. Founding member pricing offer

### June-August
1. Execute 6-wave rollout
2. Build unified platform (12 weeks)
3. Migrate OpenGovIQ from Base44
4. Launch MI Team tier

### By September
1. Unified MI platform live
2. 355+ MI subscribers
3. $17K+ MRR
4. Laurie Sayles on MI Team

---

*"We used to teach you 11 platforms. Now we've built one."*
