# PRD: Market Intelligence — ONE Thing

**Version:** 1.0
**Created:** April 13, 2026
**Strategic Model:** Option D + A (Salesforce Disruption + Calendly Simplicity)

---

## Executive Summary

GovCon Giants will become the "Salesforce of GovCon Intelligence" by serving small business contractors who can't afford Deltek ($10K+/year) with a brutally simple product: **one daily email that tells them their #1 priority.**

**Core premise:** Deltek serves enterprises with complex dashboards. We serve SMBs with one answer: "Here's who to target today."

---

## The Opportunity

### Market Gap Analysis

| Segment | Deltek | GovCon Giants |
|---------|--------|---------------|
| Target | Enterprise (1,000+ employees) | SMB (1-50 employees) |
| Price | $10K-$100K+/year | $49/month |
| Complexity | Dashboards, reports, integrations | One email |
| Onboarding | Weeks/months | 3 questions, 60 seconds |
| Value Prop | "Complete GovCon ERP" | "Your #1 priority today" |

### The Salesforce Playbook

**Siebel (2000):**
- 45% market share
- Average 1,000 seats/customer
- Complex, expensive, required IT

**Salesforce (2000):**
- Targeted SMBs with 24 seats average
- "No Software" — just log in
- $50/user/month vs $1000s for Siebel

**Result:** Salesforce didn't out-feature Siebel. They served who Siebel couldn't serve.

### Our Version

**Deltek (2026):**
- 30,000+ organizations
- Enterprise focus
- Complex dashboards, steep learning curve

**GovCon Giants (2026):**
- Target SMBs who ARE the BD team
- One email, one action
- $49/month vs $10K+/year

---

## User Persona

### Primary: "The Owner-Operator"

**Name:** Maria Rodriguez
**Company:** Rodriguez Consulting LLC (8(a) certified)
**Size:** Just her + 2 part-time employees
**Revenue:** $800K/year (goal: $2M)
**NAICS:** 541611 (Management Consulting)

**Current Reality:**
- She IS the BD team, sales, delivery, HR, and accounting
- Checks SAM.gov manually 2-3x/week
- Misses opportunities because she's too busy delivering work
- Can't afford GovWin IQ ($500/month+)
- Attended a GovCon Giants bootcamp, wants help but overwhelmed

**Pain Points:**
- "I don't know who I should be calling"
- "There are too many opportunities, I can't evaluate them all"
- "I found out about that contract after it closed"
- "I waste time on opportunities I can't win"

**What She Needs:**
> "Just tell me the ONE thing I should do today."

### Secondary: "The One-Person BD Team"

**Name:** James Chen
**Company:** TechServe Federal (SDVOSB)
**Size:** 25 employees, 1 BD person (him)
**Revenue:** $4M/year
**NAICS:** 541512 (IT Services)

**Current Reality:**
- Has Deltek Costpoint for accounting but not GovWin
- Manually tracks opportunities in spreadsheets
- Spends 15+ hours/week on market research
- Boss wants more pipeline but no budget for tools

**Pain Points:**
- "I'm drowning in data but starving for insight"
- "My spreadsheet has 200 opportunities but which ones matter?"
- "I need to prioritize but don't have a system"

**What He Needs:**
> "Cut through the noise. Tell me my top priority."

---

## Product Definition

### The ONE Thing

**Product name:** GovCon Daily Intel (or just "The Daily")

**Core value prop:**
> "Every morning, we tell you the ONE federal contract you should focus on today."

**Why ONE, not five or ten:**
- Calendly doesn't give you 10 scheduling options
- Slack doesn't show 10 channels — it shows the one with activity
- Paradox of choice: more options = less action
- "The ONE Thing" by Gary Keller: "What's the ONE thing I can do such that by doing it everything else will be easier or unnecessary?"

### The Email

**Subject line:** `🎯 [Maria] Your priority today: HUD needs 8(a) consulting`

**Body structure:**
```
Good morning, Maria.

YOUR #1 PRIORITY TODAY
━━━━━━━━━━━━━━━━━━━━━━━━

📋 HUD Program Management Support
   Department of Housing & Urban Development

💰 $2.5M - $5M (estimated)
⏰ Closes in 12 days (April 25)
🎯 Win Score: 82/100 — EXCELLENT

WHY THIS ONE:
✅ 8(a) set-aside (you qualify)
✅ 541611 exact NAICS match
✅ HUD has pain point: "modernize grant management"
✅ No incumbent — new requirement
✅ Your past performance aligns

YOUR ACTION TODAY:
→ Download the RFP and read Section C (15 min)
→ Call HUD OSDBU: (202) 708-1428

[View Full Details →]

━━━━━━━━━━━━━━━━━━━━━━━━

📊 Also on your radar (but not today):
• VA IT Support — closes Apr 28 — Score: 74
• GSA Schedule refresh — closes May 5 — Score: 68

[Manage Preferences] | [Unsubscribe]

GovCon Giants AI • shop.govcongiants.org
```

**Key design decisions:**
1. **ONE priority** — not a list, THE priority
2. **WHY this one** — reasoning builds trust
3. **YOUR ACTION TODAY** — specific, time-boxed
4. **"Also on radar"** — acknowledges others exist, but de-prioritized
5. **No dashboard link** — the email IS the product

### What We DON'T Do

To maintain brutal simplicity:

| Feature | Include? | Reason |
|---------|----------|--------|
| Pipeline tracker | ❌ No | Adds complexity, different product |
| Teaming CRM | ❌ No | Adds complexity, different product |
| Proposal templates | ❌ No | Different problem |
| Complex filters | ❌ No | We filter FOR them |
| Dashboard | ❌ No | Email IS the interface |
| Multiple briefing types | ❌ No | ONE type, ONE format |
| "Add to pipeline" buttons | ❌ No | Action should be external (call, download) |

### The Viral Loop

**Calendly's loop:** Share link → recipient sees Calendly → signs up → shares their link

**Our loop:**
1. Maria gets email
2. Email includes: "Know someone who needs this? [Forward to a friend]"
3. Friend sees email, clicks link to sign up
4. Friend gets their own personalized email
5. Friend forwards to their network

**Referral program:**
- Free users: 1 referral = 1 extra week of trial
- Paid users: 3 referrals = 1 month free
- Make sharing as easy as Calendly link sharing

---

## Technical Implementation

### What Changes

**Current state:** 7 email templates, 6 briefing types, complex formatting

**Future state:** 1 email template, 1 briefing type, simple format

### Email Template (Single)

```typescript
// src/lib/briefings/templates/the-one-thing.ts

interface OnePriorityEmail {
  user: {
    name: string;
    email: string;
    naics: string[];
    setAside: string;
    state: string;
  };
  priority: {
    title: string;
    agency: string;
    value: string;
    daysLeft: number;
    winScore: number;
    whyReasons: string[];
    actionToday: string[];
    samLink: string;
  };
  alsoOnRadar: {
    title: string;
    daysLeft: number;
    score: number;
  }[]; // max 2-3
}
```

### Scoring Algorithm (Simplified)

Current: 6 factors, complex weighting
Future: 3 factors that actually matter

```typescript
function calculatePriorityScore(opp: Opportunity, user: User): number {
  // Factor 1: NAICS Match (0-40 points)
  const naicsScore = user.naics.includes(opp.naics) ? 40 :
                     user.naics.some(n => opp.naics.startsWith(n.slice(0,4))) ? 20 : 0;

  // Factor 2: Set-Aside Match (0-40 points)
  const setAsideScore = opp.setAside === user.setAside ? 40 :
                        opp.setAside === 'SBA' && user.setAside ? 20 : 0;

  // Factor 3: Timing (0-20 points)
  // Prioritize 7-21 day window (not too urgent, not too far)
  const daysLeft = daysBetween(new Date(), opp.closeDate);
  const timingScore = daysLeft >= 7 && daysLeft <= 21 ? 20 :
                      daysLeft > 21 && daysLeft <= 45 ? 10 : 5;

  return naicsScore + setAsideScore + timingScore;
}
```

### Daily Cron Job

```
1. 2:00 AM ET: Fetch opportunities from SAM.gov, Grants.gov, Forecasts
2. 2:30 AM ET: Score all opportunities for all users
3. 3:00 AM ET: For each user, select THE ONE highest-scoring opportunity
4. 6:00 AM ET: Send emails (one email per user, ONE priority)
```

### Database Simplification

**Drop:** `briefing_templates` multi-type complexity
**Keep:** Simple user preferences + daily email log

```sql
-- Simplified user preferences
CREATE TABLE user_intel_profile (
  email TEXT PRIMARY KEY,
  name TEXT,
  naics_codes TEXT[], -- max 3
  set_aside TEXT, -- one primary
  state TEXT,
  created_at TIMESTAMP,
  last_email_at TIMESTAMP
);

-- Simple email log
CREATE TABLE daily_intel_log (
  id UUID PRIMARY KEY,
  user_email TEXT,
  sent_at TIMESTAMP,
  priority_opp_id TEXT,
  priority_score INTEGER,
  opened BOOLEAN DEFAULT FALSE,
  clicked BOOLEAN DEFAULT FALSE
);
```

---

## Onboarding Flow

### Current: Complex

- Multiple NAICS codes
- Multiple agencies
- Keywords
- Delivery preferences
- Timezone
- Frequency options

### Future: 3 Questions, 60 Seconds

**Screen 1:**
```
What's your email?
[email input]
```

**Screen 2:**
```
What do you do? (pick ONE)
○ IT Services
○ Management Consulting
○ Engineering
○ Construction
○ Professional Services
○ Other: [input]
```

**Screen 3:**
```
What's your certification? (pick ONE)
○ 8(a)
○ WOSB/EDWOSB
○ SDVOSB
○ HUBZone
○ Small Business (no certification)
○ Large Business
```

**Done.**

We infer NAICS from their selection. We can always ask for refinement later.

---

## Pricing

### The Calendly Model

**Calendly:**
- Free: Basic scheduling, Calendly branding
- Pro: $12/month — removes branding, integrations
- Team: $20/month — team features

**GovCon Daily Intel:**

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | Daily email, top 1 priority, GCG branding |
| **Pro** | $49/mo | Daily email, top 1 + "on radar" 3, no branding, priority support |
| **Team** | $149/mo | Up to 5 users, shared view, team Slack notifications |

### Why $49/month

- Deltek GovWin IQ: $500+/month
- We're 10x cheaper
- Low enough for owner-operators to pay personally
- High enough to filter serious users

### Revenue Math

Current: 9,000 leads
- 5% convert to free trial = 450
- 10% of free convert to paid = 45 paying users
- 45 × $49 = $2,205/month

**Growth target:**
- 12 months: 500 paid users = $24,500/month
- 24 months: 2,000 paid users = $98,000/month
- 36 months: 10,000 paid users = $490,000/month

At 10,000 paid users, we're a $6M ARR business with one product.

---

## Success Metrics

### North Star Metric

**"Priority Action Rate"** — % of users who take action on their #1 priority within 24 hours

Target: 30%+ (measured via link clicks + feedback)

### Supporting Metrics

| Metric | Target | Why |
|--------|--------|-----|
| Email open rate | 60%+ | Shows relevance |
| Click rate | 20%+ | Shows action |
| Free → Paid conversion | 10%+ | Shows value |
| Monthly churn | <5% | Shows stickiness |
| Referrals per user | 0.5+ | Shows viral potential |
| Time to first value | <60 seconds | Shows simplicity |

---

## Competitive Positioning

### vs. Deltek GovWin IQ

| | GovWin IQ | GovCon Daily Intel |
|--|-----------|-------------------|
| Price | $500+/month | $49/month |
| Interface | Complex dashboard | One email |
| Learning curve | Weeks | 60 seconds |
| Data | Comprehensive | Curated for you |
| Value | "All the data" | "THE one thing" |

**Positioning:** "GovWin gives you everything. We give you THE answer."

### vs. SAM.gov

| | SAM.gov | GovCon Daily Intel |
|--|---------|-------------------|
| Price | Free | $49/month |
| Interface | Search-based | Pushed to you |
| Analysis | None | Win scoring |
| Personalization | Manual filters | AI-curated |
| Value | "Find opportunities" | "We find YOUR opportunity" |

**Positioning:** "SAM.gov makes you hunt. We bring the prey to you."

---

## Phase 1 Implementation (MVP)

### Week 1-2: Simplify

- [ ] Consolidate 7 email templates → 1
- [ ] Remove dashboard/tracking features from emails
- [ ] Implement "ONE priority" scoring algorithm
- [ ] Create 3-question onboarding flow

### Week 3-4: Launch

- [ ] Migrate existing users to new format
- [ ] A/B test: old format vs new "ONE thing" format
- [ ] Implement referral tracking ("Forward to friend")
- [ ] Set up metrics dashboard (opens, clicks, actions)

### Week 5-6: Iterate

- [ ] Analyze Priority Action Rate
- [ ] Interview 10 users: "Did you take action? Why/why not?"
- [ ] Adjust scoring algorithm based on feedback
- [ ] Implement feedback loop in email ("Was this helpful?")

### Week 7-8: Monetize

- [ ] Launch Pro tier ($49/month)
- [ ] Implement Stripe subscription
- [ ] Create upgrade prompts in free tier emails
- [ ] Track conversion metrics

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Users want more data, not less | Test with segment; some will upgrade to Deltek and that's ok |
| ONE priority is wrong/irrelevant | Strong feedback loop, rapid algorithm iteration |
| Low viral coefficient | Add explicit referral incentives, make sharing frictionless |
| Deltek copies us | They won't — it cannibalizes their enterprise model |
| Revenue too low at $49/mo | Volume play; also opens door for upsells (BD Dept product) |

---

## Appendix: The "No Software" Parallel

**Salesforce's genius insight (1999):**
> "Companies don't need their own CRM installed on-premise."

They weren't anti-software. They were anti-complexity.

**Our insight (2026):**
> "Contractors don't need dashboards. They need answers."

We're not anti-tool. We're anti-overwhelm.

The email IS the product. No login required. No dashboard to check. No learning curve.

Open email → See priority → Take action → Done.

---

*Last Updated: April 13, 2026*
