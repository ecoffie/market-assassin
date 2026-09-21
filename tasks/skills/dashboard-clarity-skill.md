# Dashboard Clarity Skill

**Status:** Draft  
**Owner:** GovCon Giants / MI Ops  
**Purpose:** Turn confusing dashboards into action dashboards that help the team understand customer usage, improve experience, and help users find and win federal contracts.

## When To Use This

Use this skill whenever a dashboard, metric card, admin panel, or customer analytics view feels confusing, misaligned, or hard to act on.

Trigger examples:
- "These dashboards are confusing."
- "Why did this number go down?"
- "Does this help us know if customers are finding contracts?"
- "Does this help us know if customers are winning contracts?"
- "What levers can we pull from this?"
- "Are these metrics using the same source of truth?"

## Core Questions

Every dashboard should answer:

1. Who is this for?
2. What changed?
3. Why did it change?
4. Is that good or bad?
5. What action should we take next?
6. Does this help small businesses find federal contracts?
7. Does this help small businesses win federal contracts?

If a metric does not help answer one of those questions, it should be renamed, moved, explained, or removed.

## MI Metric Taxonomy

### 1. Audience Inventory

These are stock metrics. They describe the current population and should not be mixed with period activity.

- Total users
- MI Free users
- MI Pro users
- MI Internal users
- Active alert audience
- Briefings eligible
- Internal/comp/excluded users
- Expired or revoked users

### 2. Activation

These show whether users are becoming ready to receive value.

- New users imported
- Account created
- First login
- Profile started
- Profile completed
- Custom NAICS selected
- Business type selected
- First briefing generated
- First alert received
- First briefing opened

### 3. Engagement

These show whether users are spending meaningful time in the product.

- Daily active users
- Weekly active users
- Time in MI
- Sessions per user
- Pages used
- Searches run
- Briefings opened
- Alerts clicked
- Opportunities viewed
- Opportunities saved

### 4. Outcome Behavior

These show whether MI is moving users closer to contract wins.

- Opportunity tracked
- Pipeline item created
- Teaming partner added
- Contractor researched
- Forecast viewed
- Recompete viewed
- Proposal assist started
- Bid/no-bid decision logged
- Proposal submitted
- Win reported

### 5. Email Performance

These show whether email is driving users back into MI.

- Emails sent
- Delivered
- Opened
- Clicked
- Click-through rate
- Helpful feedback
- Not helpful feedback
- Unsubscribes
- Bounces

### 6. Matching Quality

These show whether users are receiving relevant opportunities.

- Users with zero matches
- Users with excessive matches
- Helpful rate
- Not helpful rate
- Matches by source
- Matches by NAICS
- Matches by geography
- Matches by due date
- Low-confidence matches

### 7. System Health

These show whether the machine is working.

- Cron last run
- Cron next run
- Queue remaining
- Cache freshness
- API failures
- Email provider failures
- Failed sends
- Skipped sends
- Auth errors

## Dashboard Rules

1. Do not compare lifetime counts to 7-day counts without labeling both.
2. A delta must compare the same population over the same time window.
3. "Profiles completed" must say whether it is lifetime, last 7 days, or selected period.
4. Sent counts should not decrease unless the date window changed.
5. Split inventory, activity, quality, and system health into separate sections.
6. Every trend should show whether higher or lower is good.
7. Every confusing count needs a source note.
8. If the metric cannot drive a decision, it should move to diagnostics.

## Review Output

When reviewing a dashboard, produce this:

| Current Metric | Problem | Better Label | Source Of Truth | Action It Enables |
| --- | --- | --- | --- | --- |
| Example | Mixed time windows | Profiles Completed - Last 7 Days | `profiles.updated_at` | Send setup nudges |

Then summarize:

- Top 3 confusing metrics
- Top 3 missing metrics
- Recommended dashboard sections
- Data source mismatches
- Actions the team can take this week

## MI Dashboard Target Layout

1. Growth and Activation
2. Engagement and Time in MI
3. Email Performance
4. Matching Quality
5. Outcomes and Pipeline Movement
6. Revenue and Access
7. System Health
8. Action Queue

## Definition Of Done

A dashboard is clear when a team member can look at it and answer:

- Are more qualified users joining?
- Are more users completing setup?
- Are users spending more time in MI?
- Are emails bringing users back?
- Are matches getting better?
- Are users saving, tracking, teaming, bidding, or winning?
- What should we do next?
