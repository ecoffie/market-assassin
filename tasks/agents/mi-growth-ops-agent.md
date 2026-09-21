# MI Growth Ops Agent

**Status:** Draft  
**Owner:** GovCon Giants / MI Ops  
**Mission:** Monitor Market Intelligence growth, activation, engagement, and outcome signals so the team knows which levers to pull to help users find and win federal contracts.

## Job To Be Done

The agent answers:

- Who joined or was imported?
- Who activated?
- Who is engaged?
- Who is stuck?
- Who is ready for MI Pro?
- Who may be a white-glove or 10-10 Forever candidate?
- Which product, email, or onboarding lever should the team pull next?

## Operating Cadence

### Daily

Produce a short MI Growth Brief:

- New/imported users
- New account setups
- New profile completions
- Active users
- Time in MI
- Email opens/clicks
- Broken jobs or failed sends
- Top action for today

### Weekly

Produce a deeper Growth Memo:

- Activation trend
- Engagement trend
- Matching quality trend
- Email performance trend
- Outcome behavior trend
- Top cohorts to contact
- Top product fixes
- Top customer success opportunities

### Event-Based

Run after:

- Bootcamp launch
- New product rollout
- Briefing send issue
- Major dashboard/data mismatch
- Big email campaign
- API/security incident

## Source Systems

Initial sources:

- Supabase users/profiles
- Supabase auth users
- Stripe purchases/subscriptions
- Briefing logs
- Alert delivery logs
- Email events
- App activity events
- Admin dashboard APIs
- MI beta usage events

Future sources:

- Slack team summaries
- Google Search Console
- GA4
- CRM/white-glove pipeline
- Win/loss reporting

## User Classification

The agent should classify users into action groups:

| Segment | Meaning | Action |
| --- | --- | --- |
| Imported, no account | Has entitlement but no auth identity | Send account setup invite |
| Account created, no profile | Can log in but MI cannot personalize | Send profile completion nudge |
| Profile complete, no activity | Ready but not using | Send value prompt or walkthrough |
| Opens email, no app use | Email engaged but product friction exists | Send direct deep link |
| Uses app, no saved/tracked opps | Browsing but not acting | Prompt pipeline/tracking workflow |
| High activity | Strong candidate for Pro, case study, or white-glove | Personal outreach |
| Pro inactive | Paid but not receiving value | Customer success rescue |
| Internal | Team/test/admin user | Exclude from customer metrics |

## KPI Tree

### Audience

- Total reachable users
- MI Free
- MI Pro
- MI Internal
- Entitled but not invited
- Invited but not activated

### Activation

- Account created
- First login
- Profile completed
- First alert received
- First briefing opened

### Engagement

- Daily active users
- Weekly active users
- Time in MI
- Email click-through
- Search usage
- Briefing usage
- Research tool usage

### Outcomes

- Opportunities saved
- Pipeline items created
- Recompetes researched
- Contractors researched
- Teaming partners added
- Proposal workflows started
- Bids submitted
- Wins reported

### Revenue

- Free to Pro upgrades
- Pro retained
- Pro at risk
- White-glove candidates
- Bundle users activated

## Decision Levers

| Signal | Interpretation | Lever |
| --- | --- | --- |
| Profile completion down | Users are not reaching personalization | Better setup email, shorter profile flow |
| Opens high, clicks low | Email copy is not creating action | Improve CTA and offer relevance |
| Clicks high, app time low | Landing/product friction | Improve deep link, loading, first screen |
| Matches too high | Noise problem | Tighten NAICS/location filters |
| Matches too low | Empty value problem | Add default recommendations |
| Pro inactive | Retention risk | Customer success outreach |
| High usage, no pipeline | Product lacks next action | Add save/track/team prompts |

## Guardrails

- Do not send customer emails without explicit approval.
- Do not change entitlements without explicit approval.
- Do not expose PII in public or broad Slack channels.
- Always separate internal users from customer metrics.
- Always label inferred conclusions as inferred.
- Always show source systems for key numbers.
- Any API route used by the agent must be classified as public, token protected, admin only, or MI user protected.

## MVP Scope

### Phase 1: Manual Brief Generator

- Pull existing dashboard/user/email data.
- Generate daily and weekly summaries.
- Produce action recommendations.
- No automatic outreach.

### Phase 2: Operational Dashboard Feed

- Add an admin endpoint that returns the KPI tree in one consistent shape.
- Add segment counts and suggested actions.
- Add cache freshness and data quality notes.

### Phase 3: Slack/Email Digest

- Post an approved summary to the right internal Slack channel.
- Include owner/action/date.
- Keep PII out of broad summaries.

### Phase 4: Semi-Autonomous Growth Ops

- Draft outreach lists.
- Draft customer success emails.
- Draft dashboard bug reports.
- Draft product tickets.
- Wait for approval before sending or changing access.

## Definition Of Done

The agent is useful when it can tell the team:

- Who needs help today
- Which users are most valuable
- Which users are at risk
- Which dashboard numbers changed and why
- Which product or customer success action should happen next
- Whether MI is helping users move from finding opportunities to pursuing and winning contracts
