# PRD: Outcome-Based Intelligence System

## The Insight

People don't care about tools. They care about outcomes:
- "What opportunities should I chase?"
- "Who should I team with?"
- "What contracts are coming up for recompete?"
- "What are my competitors winning?"
- "How do I position against the incumbent?"

**Current model:** User logs in → uses tool → gets result
**New model:** User sets profile once → intelligence comes to them

---

## Core Principle

> **Your purchase determines your intelligence scope.**
> **Your profile determines your intelligence relevance.**

---

## Intelligence Tiers by Product

### Tier 1: Free (Opportunity Hunter Free)
**Scope:** Basic opportunity alerts only
**Delivery:** Weekly email digest (max 5 opps)
**Intelligence:**
- New SAM.gov opportunities matching NAICS
- That's it

### Tier 2: Alerts Pro ($19/mo)
**Scope:** Daily opportunity intelligence
**Delivery:** Daily email (~6 AM local)
**Intelligence:**
- New SAM.gov opportunities (unlimited)
- New Grants.gov opportunities
- Deadline reminders (7 days, 3 days, 1 day)
- Set-aside filtering

### Tier 3: Single Tool Purchases
Each tool unlocks a **specific intelligence stream** delivered automatically.

| Product | Intelligence Stream | Delivery |
|---------|---------------------|----------|
| **Contractor Database ($497)** | Teaming partner alerts: "New contractor registered in your NAICS + state" | Weekly email |
| **Recompete Tracker ($397)** | Expiring contracts: "3 contracts in your NAICS expiring in 90 days" | Weekly email |
| **Content Reaper ($197-$397)** | Content prompts: "Trending topic in your industry this week" | Weekly email |
| **Market Assassin ($297-$497)** | Agency intel: "Your target agency just posted 5 new requirements" | On-demand (still interactive) |

**Add-on available:** Any single tool purchaser can add Daily Briefings for **$49/mo** to get the unified daily intelligence email.

### Tier 4: Bundle (Pro Giant $997 / Ultimate $1,497)
**Scope:** Full intelligence across ALL streams
**Delivery:** Unified daily briefing
**Intelligence:**
- Everything from all tools combined
- Cross-referenced insights ("This recompete matches your capability AND a contractor in your DB is the incumbent")
- Win probability scoring
- Competitive landscape alerts

---

## The Daily Intelligence Email (Bundle Users)

Instead of 4 separate emails, ONE unified briefing:

```
Subject: 🎯 Your GovCon Intel Brief - Apr 1, 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 TODAY'S TOP OPPORTUNITIES (12 new)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. [85% MATCH] IT Support Services - VA
   NAICS 541512 • SDVOSB Set-Aside • Due Apr 15
   → View on SAM.gov

2. [72% MATCH] Cybersecurity Assessment - DOD
   NAICS 541512 • Small Business • Due Apr 22
   → View on SAM.gov

[See all 12 →]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 RECOMPETE WATCH (3 expiring)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• $2.4M IT Support - VA Medical Center
  Incumbent: ABC Corp • Expires: Jun 30, 2026
  ⚡ Sources Sought expected in 45 days

• $890K Help Desk - Army
  Incumbent: XYZ Inc • Expires: Jul 15, 2026

[Track these recompetes →]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤝 TEAMING OPPORTUNITIES (2 new partners)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• TechServe LLC just registered
  NAICS 541512 • 8(a) Certified • Virginia
  💡 You're SDVOSB - could be a strong JV

• CloudOps Federal updated SAM profile
  Added: CMMC Level 2 certified
  💡 They complement your capabilities

[View full contractor database →]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 MARKET SIGNALS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• VA increased IT spending 12% this quarter
• DOD posted 3x more 541512 opps than last month
• Your win rate: 23% (industry avg: 18%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✍️ CONTENT IDEA OF THE WEEK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"Zero Trust Architecture for VA Medical Systems"
→ Generate LinkedIn posts with Content Reaper

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Manage Preferences] • [Unsubscribe]
```

---

## Intelligence Entitlement Matrix

| What You Own | Opportunities | Recompetes | Teaming | Market Intel | Content Ideas |
|--------------|---------------|------------|---------|--------------|---------------|
| Free | 5/week | ❌ | ❌ | ❌ | ❌ |
| Alerts Pro | ✅ Daily | ❌ | ❌ | ❌ | ❌ |
| Contractor DB | ✅ Daily | ❌ | ✅ Weekly | ❌ | ❌ |
| Recompete Tracker | ✅ Daily | ✅ Weekly | ❌ | ❌ | ❌ |
| Content Reaper | ✅ Daily | ❌ | ❌ | ❌ | ✅ Weekly |
| Market Assassin | ✅ Daily | ❌ | ❌ | ✅ On-demand | ❌ |
| **Any Tool + Briefings ($49/mo)** | ✅ Daily | ✅ Weekly | ✅ Weekly | ✅ Weekly | ✅ Weekly |
| Pro Giant Bundle | ✅ Daily | ✅ Weekly | ✅ Weekly | ✅ Weekly | ✅ Weekly |
| Ultimate Bundle | ✅ Daily | ✅ Daily | ✅ Daily | ✅ Daily | ✅ Weekly |

---

## Implementation: Cron Jobs by Intelligence Stream

### Current Crons
- `daily-alerts` - SAM.gov opportunities
- `send-briefings` - Personalized briefings
- `weekly-alerts` - Weekly digest

### New Crons Needed

| Cron | Schedule | Who Gets It | Intelligence |
|------|----------|-------------|--------------|
| `recompete-intel` | Weekly (Sunday) | Recompete Tracker owners | Expiring contracts in user's NAICS |
| `teaming-intel` | Weekly (Monday) | Contractor DB owners | New contractors in user's space |
| `market-signals` | Weekly (Wednesday) | MA Standard+ owners | Spending trends, competition |
| `content-prompts` | Weekly (Friday) | Content Reaper owners | Trending topics in user's industry |
| `unified-briefing` | Daily | Bundle owners | All of the above, combined |

---

## Database Changes

### Add to `govcon_profiles`:

```sql
-- Intelligence entitlements (derived from purchases)
intelligence_scope TEXT[] DEFAULT '{}',  -- ['opportunities', 'recompetes', 'teaming', 'market', 'content']

-- Delivery preferences
unified_briefing BOOLEAN DEFAULT false,  -- true = one email, false = separate streams
briefing_sections TEXT[] DEFAULT '{}',   -- Which sections to include
```

### New table: `intelligence_log`

Track what intelligence was delivered:

```sql
CREATE TABLE intelligence_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  intelligence_type TEXT NOT NULL,  -- 'opportunity', 'recompete', 'teaming', 'market', 'content'
  item_id TEXT,                      -- Reference to the item (noticeId, contractId, etc.)
  item_data JSONB,                   -- Snapshot of the item
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  delivery_method TEXT DEFAULT 'email',  -- 'email', 'sms', 'in-app'
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ
);
```

---

## Access Derivation Logic

```typescript
function getIntelligenceScope(email: string): string[] {
  const purchases = await getUserPurchases(email);
  const scope: Set<string> = new Set();

  // Everyone gets basic opportunities
  scope.add('opportunities_basic');

  // Check each product
  if (purchases.includes('alerts_pro') || purchases.includes('oh_pro')) {
    scope.add('opportunities_full');
    scope.add('grants');
  }

  if (purchases.includes('contractor_db')) {
    scope.add('teaming');
    scope.add('opportunities_full');  // Included
  }

  if (purchases.includes('recompete')) {
    scope.add('recompetes');
    scope.add('opportunities_full');  // Included
  }

  if (purchases.includes('content_standard') || purchases.includes('content_full')) {
    scope.add('content_prompts');
    scope.add('opportunities_full');  // Included
  }

  if (purchases.includes('ma_standard') || purchases.includes('ma_premium')) {
    scope.add('market_intel');
    scope.add('opportunities_full');  // Included
  }

  // Bundles get everything
  if (purchases.includes('pro_giant') || purchases.includes('ultimate')) {
    scope.add('opportunities_full');
    scope.add('grants');
    scope.add('recompetes');
    scope.add('teaming');
    scope.add('market_intel');
    scope.add('content_prompts');
    scope.add('unified_briefing');
  }

  return Array.from(scope);
}
```

---

## Interactive Tools Still Matter

MA and Content Reaper remain interactive because:
- **Market Assassin:** Generates custom reports for specific opportunities
- **Content Reaper:** Creates content on-demand for specific topics

But even these can be **triggered by intelligence:**

> "We found 3 opportunities with >80% match.
> [Generate Market Intel Report →]"

> "Trending topic in your industry: CMMC 2.0 compliance
> [Generate LinkedIn posts →]"

---

## Email Consolidation

### Before (4+ emails/week for bundle user):
- Daily Alerts (7/week)
- Weekly Briefing (1/week)
- Recompete digest (if we had it)
- Teaming alerts (if we had it)

### After (1 unified email/day):
- Daily Intelligence Brief
- Contains ALL relevant intel for their entitlements
- Sections based on what they own

---

## Migration Path

### Phase 1: Build Intelligence Streams (Week 1-2)
1. Create `recompete-intel` cron job
2. Create `teaming-intel` cron job
3. Create `content-prompts` cron job
4. Each sends separate email to entitled users

### Phase 2: Access Derivation (Week 3)
1. Build `getIntelligenceScope()` function
2. Update all crons to check entitlements
3. Backfill `intelligence_scope` in `govcon_profiles`

### Phase 3: Unified Briefing (Week 4)
1. Create `unified-briefing` cron job
2. Combines all streams into one email
3. Option in preferences: "Unified" vs "Separate"

### Phase 4: Smart Triggers (Week 5+)
1. "Generate report" CTAs in intelligence emails
2. One-click MA report from opportunity
3. One-click Content Reaper from topic suggestion

---

## Evaluation Criteria

### User Engagement

| Metric | Current | Target |
|--------|---------|--------|
| Email open rate | ~25% | 45% |
| Click-through rate | ~5% | 15% |
| Logins/month (non-MA) | 2-3 | 0-1 (intelligence comes to them) |
| Time-to-value | Days | Immediate |

### Business Metrics

| Metric | How to Measure |
|--------|----------------|
| Intelligence delivered | `intelligence_log` count by type |
| Cross-sell opportunities | Users who click "upgrade" for locked sections |
| Retention | Do users with intelligence stay longer? |
| Perceived value | Survey: "How valuable is your daily brief?" |

---

## Open Questions

1. **SMS alerts?**
   - "🔥 High-match opportunity just posted. Due in 7 days."
   - Premium feature?

2. **Slack/Teams integration?**
   - Post intelligence to their workspace
   - Enterprise feature?

3. **What about new users?**
   - Profile incomplete = generic intel
   - Prompt: "Complete your profile to get personalized intel"

4. **Frequency controls?**
   - Some users want realtime, others weekly
   - Per-stream frequency settings?

---

## Summary

**Old mental model:** "Here are 6 tools, go use them"

**New mental model:** "Tell us who you are, we'll tell you what you need to know"

The tools become **intelligence engines** that run automatically. Users only log in when they need to take action (generate a report, create content, research a specific opportunity).

---

## UVP: Why Not Just Use ChatGPT/Claude?

### The Inevitable Question

> "Can't I just ask ChatGPT to find government contracts for me?"

**Yes, but here's what they can't do:**

### 1. ChatGPT/Claude Don't Have Live Federal Data

| Capability | ChatGPT/Claude | GovCon Giants |
|------------|----------------|---------------|
| Live SAM.gov opportunities | ❌ No API access | ✅ Real-time via SAM API |
| Grants.gov funding | ❌ No access | ✅ Live integration |
| FPDS contract awards | ❌ No access | ✅ USASpending API |
| Contractor registrations | ❌ No access | ✅ SAM Entity API |
| Recompete timelines | ❌ Can't calculate | ✅ Tracks expiration dates |

**They can tell you *about* federal contracting. We tell you *what's happening right now.***

### 2. They Don't Know *You*

| Capability | ChatGPT/Claude | GovCon Giants |
|------------|----------------|---------------|
| Remembers your NAICS | ❌ Session only | ✅ Persistent profile |
| Knows your certifications | ❌ Must re-explain | ✅ Stored & applied |
| Tracks your search history | ❌ No | ✅ Learns preferences |
| Filters by your set-aside | ❌ Must specify | ✅ Automatic |
| Knows your past bids | ❌ No context | ✅ Engagement tracking |

**They're a blank slate every time. We know your business.**

### 3. They Don't Do the Work While You Sleep

| Capability | ChatGPT/Claude | GovCon Giants |
|------------|----------------|---------------|
| Monitors SAM.gov 24/7 | ❌ You must ask | ✅ Cron jobs |
| Alerts when matches appear | ❌ No | ✅ Daily emails |
| Tracks contract expirations | ❌ No | ✅ Recompete intel |
| Watches for new competitors | ❌ No | ✅ Teaming intel |
| Sends without prompting | ❌ No | ✅ Automated delivery |

**They respond when asked. We work for you proactively.**

### 4. They Don't Have Curated GovCon Intelligence

| Capability | ChatGPT/Claude | GovCon Giants |
|------------|----------------|---------------|
| Agency pain points database | ❌ Generic guesses | ✅ 250 agencies, 2,765 pain points |
| SBLO contact list | ❌ No | ✅ 3,500+ contacts |
| Win probability scoring | ❌ Can't calculate | ✅ Multi-factor algorithm |
| Competitor incumbent data | ❌ No access | ✅ USASpending lookups |
| Set-aside match logic | ❌ Guesses | ✅ Exact SAM.gov mappings |

**They have general knowledge. We have specialized GovCon intelligence.**

### 5. They Can't Take Action

| Capability | ChatGPT/Claude | GovCon Giants |
|------------|----------------|---------------|
| Generate proposal-ready reports | ❌ Generic output | ✅ 8 formatted reports |
| Export to Word/PDF | ❌ Copy-paste | ✅ One-click export |
| Create LinkedIn content | ❌ Generic | ✅ GovCon-specific templates |
| Track your pipeline | ❌ No persistence | ✅ Action planner |

**They give you text. We give you deliverables.**

---

## Positioning Statement

> **ChatGPT can talk about government contracting.**
> **GovCon Giants does government contracting intelligence for you.**

### The AI + Data Moat

Our UVP is the combination of:
1. **Live federal data APIs** (SAM, USASpending, Grants.gov)
2. **Persistent user profiles** (your business, your preferences)
3. **Proactive delivery** (we come to you, not you to us)
4. **GovCon-specific intelligence** (curated, not generated)
5. **Actionable outputs** (reports, exports, templates)

### Messaging for Marketing

**Headline options:**
- "AI that actually knows federal contracting"
- "Your 24/7 GovCon intelligence analyst"
- "Stop searching. Start winning."
- "ChatGPT can't see SAM.gov. We can."

**Comparison hook:**
> "ChatGPT is a librarian. GovCon Giants is a business development team that works while you sleep."

---

## Competitive Response Playbook

### When prospects say: "I'll just use ChatGPT"

**Response:**
> "Great idea for learning about GovCon. But ChatGPT can't see today's SAM.gov postings, doesn't know your NAICS codes, and won't email you at 6 AM when a perfect opportunity drops. We do all three. Want to see your first personalized intel brief?"

### When prospects say: "I built a custom GPT for this"

**Response:**
> "Smart move. But does it have API access to SAM.gov? Does it track contract expirations? Does it know which contractors in your space have complementary certifications? We've built the data layer you can't replicate in ChatGPT."

### When prospects say: "Claude Code can build me an agent"

**Response:**
> "Absolutely. But that's a DIY project. We've already built the agent, connected the APIs, cleaned the data, and served 10,000+ contractors. You can spend weeks building, or start getting intel tomorrow."

---

## Feature Parity Check

What would someone need to replicate us with AI agents?

| Component | DIY Effort | Our Advantage |
|-----------|------------|---------------|
| SAM.gov API integration | 2-4 weeks | Built & rate-limited |
| Grants.gov integration | 1-2 weeks | Built |
| USASpending integration | 2-3 weeks | Built |
| User profile persistence | 1 week | Built + 10K users |
| Email delivery infrastructure | 1 week | Built + templates |
| Win probability algorithm | 2 weeks | Tuned over months |
| Agency pain points DB | Months of research | 2,765 entries |
| SBLO contact list | Impossible to scrape | 3,500+ contacts |
| NAICS/PSC crosswalk | 1 week | Built |
| Recompete tracking logic | 2 weeks | Built |
| Contractor database | Months to build | 3,500+ records |

**Total DIY time: 3-6 months of engineering**
**Our time-to-value: Set up profile, get intel tomorrow**

---

## Next Steps

1. [ ] Review and approve this PRD
2. [ ] Build recompete-intel cron
3. [ ] Build teaming-intel cron
4. [ ] Build content-prompts cron
5. [ ] Build intelligence scope derivation
6. [ ] Build unified briefing email
7. [ ] A/B test unified vs separate emails
