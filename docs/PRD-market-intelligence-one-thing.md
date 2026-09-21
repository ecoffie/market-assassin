# PRD: Market Intelligence — Low Floor, High Ceiling

**Version:** 2.0
**Created:** April 13, 2026
**Revised:** April 21, 2026
**Strategic Model:** Airtable/HubSpot "Low Floor, High Ceiling" + LinkedIn Sales Navigator Access Model

---

## Executive Summary

GovCon Giants will become the "Salesforce of GovCon Intelligence" by serving small business contractors who can't afford Deltek ($29K+/year average) with a product that combines **curated daily intelligence** with **full data access**.

**Core premise:** GovWin gives you a complex dashboard with everything. SAM.gov gives you raw data with nothing. We give you **the best of both**: smart recommendations PLUS the ability to browse everything.

---

## Version 2.0 Changes (April 21, 2026)

### What Changed

The original "ONE Thing" philosophy was based on flawed assumptions:

| v1.0 Assumption | Reality |
|-----------------|---------|
| "Users want ONE answer" | Users want access to ALL opportunities + help prioritizing |
| "No dashboard needed" | Users asked "how do I see all 1,373 opportunities?" |
| "Email IS the product" | Email is the HOOK, dashboard is the POWER |
| "Calendly analogy works" | Calendly = low-stakes scheduling; GovCon = $100K+ decisions |

### Founder Research That Changed Our Thinking

| Company | Key Lesson |
|---------|------------|
| **[Shopify](https://www.founderoo.co/playbooks/tobi-lutke-shopify)** | "Made commerce accessible" — gave merchants CONTROL, not curation |
| **[HubSpot](https://www.saastr.com/hubspots-journey-to-the-first-2-billion-in-arr-how-co-founders-dharmesh-shah-and-brian-halligan-scaled-an-smb-saas-giant/)** | "Low floor, high ceiling" — simple to start, powerful when needed |
| **[Airtable](https://www.madrona.com/airtable-howie-liu-no-code-apps-product-led-growth-ai-enabled-workflows/)** | "Progressive disclosure" — hide complexity at first, reveal as needed |
| **[Notion](https://www.lennysnewsletter.com/p/inside-notion-ivan-zhao)** | "Most people don't want to build apps" but ALSO want flexibility |
| **[LinkedIn Sales Navigator](https://www.tribalimpact.com/blog/linkedin-basic-vs-sales-navigator-worth-the-money/)** | Users pay for ACCESS to full database + advanced filters |
| **[Zillow/Redfin](https://www.redfin.com/news/buyers-should-see-all-the-listings-sellers-should-control-how-their-listing-appears-online/)** | "Buyers should see ALL the listings" — transparency in high-stakes decisions |
| **[Spotify](https://newsroom.spotify.com/2019-05-02/five-ways-to-make-your-discover-weekly-playlists-even-more-personalized/)** | Curated playlists (Discover Weekly) PLUS full library access |

**None of these successful companies said "We'll tell you the ONE thing."**

They all said: **"We'll make everything accessible, then guide you."**

---

## The Real Opportunity

### Why "ONE Thing" Fails in GovCon

| Calendly (Original Model) | GovCon Opportunities |
|---------------------------|---------------------|
| Scheduling ONE meeting | Winning contracts worth $50K-$5M |
| Low stakes, reversible | High stakes, months of pursuit |
| 30 minutes of your time | 6-18 months of BD effort |
| Pick wrong? Reschedule | Miss opportunity? It's gone forever |
| Infinite supply of times | Limited supply of matching contracts |

**Nobody wants to gamble their business on ONE email recommendation when hundreds of thousands of dollars are on the line.**

### What Users Actually Want

Based on user feedback showing "1,373 opportunities match your profile":

| Need | What They Asked |
|------|-----------------|
| "Don't overwhelm me" | ✅ Curated daily email with TOP priorities |
| "But I want to see everything" | ❌ v1.0 said "no dashboard" |
| "Help me filter" | ❌ v1.0 said "we filter FOR them" |
| "Tell me what's hot" | ✅ Highlight urgent deadlines, Sources Sought |

### The GovWin Pricing Reality

[GovWin IQ pricing](https://www.vendr.com/buyer-guides/govwin-iq) for context:

| Plan | Cost |
|------|------|
| Minimum | $13,000/year |
| Average | $29,000/year |
| Maximum | $119,000/year |
| Per-user (small team) | $2,400-$6,000/year |

We're competing at **$588/year** ($49/mo) — that's **98% cheaper** than GovWin's minimum.

---

## Product Definition (v2.0)

### The "Low Floor, High Ceiling" Model

Inspired by [Airtable's design philosophy](https://fortune.com/2022/03/29/airtable-design-open-ended-use-case-database-platform-cloud-collaboration/):

> "The gravitational pull of the business is to make it more complex and add more features. We have to make sure we aren't doing that at the cost of product simplicity: the low floor and the high ceiling."

**Low Floor (Easy Start):**
- Daily email: Top 3-5 opportunities with scores
- Works without logging in
- Value delivered in 60 seconds of reading

**High Ceiling (Power When Needed):**
- Full searchable dashboard with ALL matching opportunities
- Advanced filters: deadline, agency, set-aside, NAICS, type
- Export to CSV/PDF for pipeline tracking

### Layer Architecture

| Layer | Purpose | Interface | Who Uses It |
|-------|---------|-----------|-------------|
| **Email (Hook)** | Surface top priorities daily | Inbox | Everyone (100%) |
| **Dashboard (Power)** | Browse all opportunities | Web app | Power users (40%) |
| **Intelligence (Premium)** | Win probability, competitor intel | Dashboard + Email | Paid users (20%) |

### The Email

**Subject line:** `🎯 [Maria] 5 opportunities matched today (3 urgent)`

**Body structure:**
```
Good morning, Maria.

━━━━━━━━━━━━━━━━━━━━━━━━
YOUR TOP PRIORITIES TODAY
━━━━━━━━━━━━━━━━━━━━━━━━

🔥 #1 — HUD Program Management Support
   💰 $2.5M - $5M | ⏰ 5 days left | 🎯 Score: 87
   ✅ 8(a) set-aside • 541611 exact match • No incumbent
   → Download RFP, call HUD OSDBU: (202) 708-1428

⚡ #2 — VA IT Modernization
   💰 $1M - $2M | ⏰ 12 days left | 🎯 Score: 82
   ✅ SDVOSB eligible • 541512 match • Recompete (Booz Allen incumbent)
   → Review SOW Section C, research incumbent pricing

📋 #3 — GSA Schedule Refresh
   💰 $500K - $1M | ⏰ 21 days left | 🎯 Score: 74
   ✅ Small business • 541330 match • Multiple award
   → Check vehicle requirements, verify GSA schedule active

━━━━━━━━━━━━━━━━━━━━━━━━
📊 1,370 MORE OPPORTUNITIES MATCH YOUR PROFILE
[Browse All Opportunities →]
━━━━━━━━━━━━━━━━━━━━━━━━

[Manage Preferences] | [Unsubscribe]

GovCon Giants AI • shop.govcongiants.org
```

**Key design changes from v1.0:**

| v1.0 | v2.0 | Why |
|------|------|-----|
| ONE priority | 3-5 priorities | Reduces risk of bad recommendation |
| No dashboard link | "Browse All" CTA | Users wanted access |
| "Also on radar" (2-3) | Full count + link | Transparency builds trust |
| "THE answer" | "Top priorities + full access" | Honest positioning |

### The Dashboard

**URL:** `/briefings/dashboard`

**Features:**
- Full searchable list of ALL matching opportunities
- Filters: Deadline (urgent/this week/this month), Type (RFP/RFQ/SS/Pre-Sol), Agency, Set-Aside
- Sort: Score, Deadline, Value
- Export: CSV, PDF
- Save: Add to pipeline tracker

**Progressive Disclosure:**
- New users see simplified view (top 10 + "load more")
- Power users can toggle "show all" + advanced filters
- Settings accessible via gear icon, not prominent

### What We DON'T Do (Scope Guard)

To prevent feature creep while supporting access:

| Feature | Include? | Reason |
|---------|----------|--------|
| Full opportunity browsing | ✅ Yes | Users demanded it |
| Pipeline tracker | ✅ Yes (BD Assist) | Separate product, integrated |
| Advanced filters | ✅ Yes | Power users need them |
| CSV/PDF export | ✅ Yes | Standard expectation |
| Teaming CRM | ❌ No | BD Assist scope |
| Proposal templates | ❌ No | Different product |
| Complex rule builders | ❌ No | Keeps onboarding simple |
| Multiple saved searches | ❌ No (v3?) | Adds complexity |

---

## User Personas (Unchanged)

### Primary: "The Owner-Operator"

**Name:** Maria Rodriguez
**Company:** Rodriguez Consulting LLC (8(a) certified)
**Size:** Just her + 2 part-time employees
**Revenue:** $800K/year (goal: $2M)
**NAICS:** 541611 (Management Consulting)

**v1.0 assumed she wanted:**
> "Just tell me the ONE thing I should do today."

**What she actually wants:**
> "Show me the best opportunities, but let me browse everything so I don't miss anything."

**Pain points (updated):**
- "I don't know who I should be calling" → **Top priorities email**
- "There are too many opportunities" → **Scored rankings**
- "I found out about that contract after it closed" → **Deadline alerts**
- "What if I'm missing something?" → **Full dashboard access**

### Secondary: "The One-Person BD Team"

**Name:** James Chen
**Company:** TechServe Federal (SDVOSB)
**Size:** 25 employees, 1 BD person (him)

**What he actually wants:**
> "Give me a system that surfaces the best opportunities but doesn't hide the rest."

He's accountable to his boss. He can't say "the AI only showed me one opportunity."

---

## Onboarding Flow

### Current: Simple (Keep It)

The 3-question flow works. Don't complicate it.

**Screen 1:** What's your email?
**Screen 2:** What do you do? (pick ONE industry)
**Screen 3:** What's your certification? (pick ONE)

### Post-Onboarding: Progressive Disclosure

**Day 1-7:** Email only, no dashboard prompts
**Day 8+:** "See all opportunities →" link in email footer
**Power users:** Self-discover dashboard, add filters

---

## Pricing (Unchanged)

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | Daily email (top 3), GCG branding, no dashboard |
| **Pro** | $49/mo | Daily email (top 5), full dashboard, advanced filters, export |
| **Team** | $149/mo | Up to 5 users, shared pipeline, team alerts |

### Why $49/month Still Works

- GovWin average: $29,000/year
- We're $588/year = **98% cheaper**
- Low enough for owner-operators
- High enough to filter serious users

---

## Success Metrics (Updated)

### North Star Metric

**"Opportunity Engagement Rate"** — % of users who view opportunity details (click) or save to pipeline within 24 hours

Target: 40%+ (was 30% "Priority Action Rate")

### Supporting Metrics

| Metric | Target | Why |
|--------|--------|-----|
| Email open rate | 60%+ | Shows relevance |
| Email → Dashboard CTR | 15%+ | **NEW:** Shows desire for more |
| Dashboard return visits | 3+/week | **NEW:** Shows stickiness |
| Opportunities viewed/user | 10+/week | **NEW:** Shows exploration |
| Free → Paid conversion | 10%+ | Shows value |
| Monthly churn | <5% | Shows stickiness |

---

## Competitive Positioning (Updated)

### vs. Deltek GovWin IQ

| | GovWin IQ | GovCon Market Intel |
|--|-----------|---------------------|
| Price | $29K/year average | $588/year |
| Interface | Complex dashboard | Email + simple dashboard |
| Learning curve | Weeks | 60 seconds |
| Data access | Full | Full |
| Curation | Manual filters | AI-scored priorities |
| Value | "All the data, figure it out" | "Priorities + access to all" |

**Positioning:** "GovWin gives you everything and expects you to figure it out. We give you priorities AND everything else."

### vs. SAM.gov

| | SAM.gov | GovCon Market Intel |
|--|---------|---------------------|
| Price | Free | $49/month |
| Interface | Search-based | Pushed + searchable |
| Analysis | None | Win scoring |
| Personalization | Manual filters | AI-curated |
| Access | Full | Full |
| Value | "Find it yourself" | "We find it + you verify" |

**Positioning:** "SAM.gov gives you access but no intelligence. We give you both."

---

## Implementation Changes

### Email Template

```typescript
// src/lib/briefings/templates/market-intel-v2.ts

interface MarketIntelEmail {
  user: {
    name: string;
    email: string;
    naics: string[];
    setAside: string;
  };
  priorities: { // Changed from single "priority"
    title: string;
    agency: string;
    value: string;
    daysLeft: number;
    winScore: number;
    whyReasons: string[];
    actionToday: string;
    samLink: string;
  }[]; // 3-5 items
  totalMatching: number; // "1,373 more opportunities"
  dashboardLink: string;
}
```

### Dashboard (Unhide It)

Current state: Dashboard exists at `/briefings/dashboard` but not linked.

Action: Add "Browse All Opportunities →" link to:
1. Daily email footer
2. `/briefings` main page
3. Alert preferences page

### Scoring Algorithm (Simplified, Keep It)

The current 3-factor scoring works:

```typescript
function calculatePriorityScore(opp: Opportunity, user: User): number {
  // Factor 1: NAICS Match (0-40 points)
  const naicsScore = user.naics.includes(opp.naics) ? 40 :
                     user.naics.some(n => opp.naics.startsWith(n.slice(0,4))) ? 20 : 0;

  // Factor 2: Set-Aside Match (0-40 points)
  const setAsideScore = opp.setAside === user.setAside ? 40 :
                        opp.setAside === 'SBA' && user.setAside ? 20 : 0;

  // Factor 3: Timing (0-20 points)
  const daysLeft = daysBetween(new Date(), opp.closeDate);
  const timingScore = daysLeft >= 7 && daysLeft <= 21 ? 20 :
                      daysLeft > 21 && daysLeft <= 45 ? 10 : 5;

  return naicsScore + setAsideScore + timingScore;
}
```

---

## Phase 1 Implementation (Updated)

### Week 1-2: Email + Dashboard Link

- [ ] Update email template: show 3-5 priorities (not 1)
- [ ] Add "Browse All X Opportunities →" link to email
- [ ] Link `/briefings/dashboard` from main `/briefings` page
- [ ] Add total matching count to email

### Week 3-4: Dashboard Polish

- [ ] Add basic filters: deadline, type, agency
- [ ] Add sort options: score, deadline, value
- [ ] Add CSV export
- [ ] Optimize for mobile

### Week 5-6: Metrics + Iterate

- [ ] Instrument dashboard engagement tracking
- [ ] A/B test: email with/without dashboard link
- [ ] Interview 10 users: "Do you browse the dashboard?"
- [ ] Adjust based on data

---

## Risks & Mitigations (Updated)

| Risk | Mitigation |
|------|------------|
| Dashboard reduces email engagement | Track both; email is hook, dashboard is power |
| Users overwhelmed by full list | Progressive disclosure; default to top 10 |
| Dashboard becomes Deltek-complex | Strict scope guard; resist feature creep |
| Free users abuse dashboard | Rate limit API; require login for full access |

---

## Appendix: Why We Changed

### The Honest Realization

The original PRD said:
> "No dashboard link — the email IS the product"

Users said:
> "This shows 1,373 opportunities but how do I see them all?"

We were wrong. Users looking to win government contracts worth hundreds of thousands of dollars don't want to be locked out of data. They want:

1. **Help prioritizing** (email does this)
2. **Full access to verify** (dashboard does this)
3. **Tools to filter** (dashboard filters do this)

### The Spotify Model

Spotify doesn't say "Here's ONE song for today, trust us."

Spotify says:
- Here's Discover Weekly (30 curated songs) → **Our daily email**
- PLUS your full library with smart filters → **Our dashboard**
- PLUS search across 100M+ tracks → **SAM.gov integration**

We should follow this pattern: **Curation + Access**.

---

## Sources

- [Shopify Founder Story](https://www.founderoo.co/playbooks/tobi-lutke-shopify)
- [HubSpot's SMB Strategy](https://www.saastr.com/hubspots-journey-to-the-first-2-billion-in-arr-how-co-founders-dharmesh-shah-and-brian-halligan-scaled-an-smb-saas-giant/)
- [Airtable Design Philosophy](https://www.madrona.com/airtable-howie-liu-no-code-apps-product-led-growth-ai-enabled-workflows/)
- [Notion Product Evolution](https://www.lennysnewsletter.com/p/inside-notion-ivan-zhao)
- [LinkedIn Sales Navigator Value](https://www.tribalimpact.com/blog/linkedin-basic-vs-sales-navigator-worth-the-money/)
- [Redfin on Listing Access](https://www.redfin.com/news/buyers-should-see-all-the-listings-sellers-should-control-how-their-listing-appears-online/)
- [Spotify Discover Weekly](https://newsroom.spotify.com/2019-05-02/five-ways-to-make-your-discover-weekly-playlists-even-more-personalized/)
- [GovWin IQ Pricing](https://www.vendr.com/buyer-guides/govwin-iq)

---

*Last Updated: April 21, 2026 — v2.0 "Low Floor, High Ceiling" rewrite*
