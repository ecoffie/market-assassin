# MI Operating System Roadmap

**Status:** Draft  
**Date:** May 9, 2026  
**Purpose:** Convert repeated GovCon Giants workflows into reusable skills, tools/plugins, and agents that support the Market Intelligence pivot.

## Strategic Frame

GovCon Giants is moving from a training-led company to a software-and-services company.

Market Intelligence should help small businesses:

1. Find federal contracts they would not have found on their own.
2. Understand which opportunities are worth pursuing.
3. Build relationships, teaming plans, and proposal actions that increase their odds of winning.

The operating system below is designed to reduce founder bottlenecks, improve team alignment, and create repeatable execution around launch, growth, customer success, and product intelligence.

## Top 10 Skills To Build

| Priority | Skill | Purpose | First Use |
| --- | --- | --- | --- |
| 1 | [Dashboard Clarity Skill](skills/dashboard-clarity-skill.md) | Turn confusing dashboard metrics into action-oriented decisions | Admin dashboard alignment |
| 2 | [Launch Memo Skill](skills/launch-memo-skill.md) | Turn messy launch ideas into team-ready memos | May 30 bootcamp and MI launch |
| 3 | [10-10 Forever Customer Strategy Skill](skills/10-10-forever-customer-strategy-skill.md) | Identify committed users worth deep investment | Customer qualification and outreach |
| 4 | [Customer Outreach Campaign Skill](skills/customer-outreach-campaign-skill.md) | Build outreach lists, call scripts, emails, and follow-up sequences | Annelle/Sikander outreach |
| 5 | PRD Builder Skill | Convert product ideas into scoped specs | Contractor sales chart, Deal Flow Board |
| 6 | GovCon Offer Reframing Skill | Reframe offers around outcomes, not training | MI Free, MI Pro, white-glove |
| 7 | Team Alignment Brief Skill | Create internal briefs that reduce confusion and founder hand-holding | Slack/team updates |
| 8 | SEO Page Strategy Skill | Design public/gated pages that rank and convert | Contractor profile pages |
| 9 | Customer Success Insight Skill | Turn usage behavior into rescue, upgrade, or white-glove actions | MI engagement follow-up |
| 10 | Founder Decision Memo Skill | Convert high-stakes founder thinking into decisions and tradeoffs | Pricing, access, roadmap |

## Top 5 Tools / Plugins Needed

| Priority | Tool / Plugin | Why It Matters | Needed For |
| --- | --- | --- | --- |
| 1 | Supabase / Database Insight Tool | Source of truth for users, profiles, entitlements, activity, and product data | Dashboards, access, growth ops |
| 2 | Stripe Customer Intelligence Tool | Identify purchasers, bundles, subscriptions, and upgrade candidates | Outreach, access, revenue |
| 3 | Email Deliverability and Campaign Tool | Track sends, opens, clicks, bounces, and feedback | Onboarding, briefings, engagement |
| 4 | Slack Team Broadcast Tool | Route approved briefs to the right internal team channels | Alignment without founder bottleneck |
| 5 | SEO / Website Health Tool | Track rankings, redirects, broken pages, public content performance | Contractor SEO pages and .org to .com migration |

## Top 5 Agents To Build

| Priority | Agent | Mission | First Version |
| --- | --- | --- | --- |
| 1 | [MI Growth Ops Agent](agents/mi-growth-ops-agent.md) | Monitor activation, engagement, outcomes, and next actions | Manual daily/weekly brief |
| 2 | [Customer Qualification Agent](agents/customer-qualification-agent.md) | Find the most valuable users from Stripe, usage, and engagement | Outreach candidate list |
| 3 | Launch Manager Agent | Keep launch plans, memos, tasks, and team updates aligned | May 30 launch support |
| 4 | SEO Contractor Pages Agent | Identify contractor pages to create, update, and gate | Public contractor profiles |
| 5 | API Security Audit Agent | Classify and harden API routes | 67 candidate route review |

## Missing MD Sections

Every launch plan, memo, PRD, and team brief should include these sections when relevant:

### Strategic Thesis

What are we now believing about the business, market, product, or customer?

### Customer Segment

Who is this for?

- MI Free
- MI Pro
- MI Internal
- Bundle customers
- White-glove candidates
- 10-10 Forever candidates
- Audience only

### Core Outcome

What user result are we trying to create?

Examples:
- Finds a qualified opportunity.
- Saves an opportunity.
- Tracks an opportunity.
- Finds a teaming partner.
- Starts a proposal.
- Submits a bid.
- Wins a contract.

### Activation Metrics

How do we know the user reached first value?

- Account created
- First login
- Profile completed
- Custom NAICS selected
- First alert opened
- First briefing opened

### Engagement Metrics

How do we know the product is becoming a habit?

- DAU / WAU
- Time in MI
- Email opens and clicks
- Searches
- Briefing views
- Forecast/recompete/contractor views

### Outcome Metrics

How do we know MI is moving users toward winning?

- Opportunities saved
- Pipeline items created
- Teaming partners added
- Proposal assist started
- Bid submitted
- Win reported

### Decision Levers

What can the team change based on the data?

- Email copy
- Onboarding flow
- Profile prompts
- Match filters
- Pricing
- Upgrade prompts
- Customer success outreach
- White-glove invitation

### Access Model

Who gets access and why?

- MI Free
- MI Pro
- MI Internal
- Admin
- Public SEO visitor
- Expired/revoked user

### Data Quality Notes

What should the reader know before trusting the numbers?

- Source of truth
- Time window
- Cache freshness
- Internal users excluded or included
- Known gaps
- Inferred vs confirmed data

### Next Action Mapping

Every metric should map to an action.

| Signal | Owner | Action | Due |
| --- | --- | --- | --- |
| Profile completion down | Customer Success | Send setup nudge | This week |
| Pro usage high | Founder/Sales | Invite to 10-10 call | This week |
| API route open | Engineering | Harden route | This sprint |

## Recommended Build Order

### 1. Dashboard Clarity Skill

**Impact:** High  
**Repeat Frequency:** High  
**Ease:** Easy  
**Why first:** The team is already making decisions from confusing dashboard numbers. Better dashboard thinking immediately improves product, customer success, and launch decisions.

### 2. MI Growth Ops Agent

**Impact:** High  
**Repeat Frequency:** High  
**Ease:** Medium  
**Why second:** Once the metrics are clean, the agent can turn them into daily/weekly action briefs.

### 3. Customer Qualification Agent

**Impact:** High  
**Repeat Frequency:** High  
**Ease:** Medium  
**Why third:** Annelle and Sikander need a larger qualified list, and customer qualification directly supports revenue and 10-10 Forever strategy.

### 4. PRD Builder Skill

**Impact:** Medium-high  
**Repeat Frequency:** High  
**Ease:** Easy  
**Why fourth:** New product ideas are coming fast: contractor sales chart, Deal Flow Board, auth, dashboards, SEO pages, access control. PRDs keep scope sane.

### 5. API Security Audit Agent

**Impact:** High  
**Repeat Frequency:** Medium  
**Ease:** Medium  
**Why fifth:** We already identified 67 candidate routes. This protects customer data and paid features as MI grows.

## First Implementation Target

Build the **Dashboard Clarity Skill + MI Growth Ops Agent** together.

The first useful output should be a daily/weekly MI Growth Brief that says:

1. How many users joined?
2. How many activated?
3. How many completed profiles?
4. How many used MI?
5. Where did they spend time?
6. Which emails drove action?
7. Which users are stuck?
8. Which users are high-value?
9. What should the team do next?
10. Are users moving closer to finding and winning contracts?

## Open Decisions

- Should Dashboard Clarity become a real installed Codex skill after the repo spec is reviewed?
- Which Slack channel should receive MI Growth Ops briefs?
- What is the official source-of-truth endpoint for MI growth metrics?
- Which user events need to be added to track time in MI and outcome behavior?
- Which customer segments should Annelle and Sikander prioritize first?
