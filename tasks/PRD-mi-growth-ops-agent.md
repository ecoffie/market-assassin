# PRD: MI Growth Ops Agent V1

**Status:** Draft for implementation  
**Date:** May 10, 2026  
**Owner:** MI Ops / Product  
**Related spec:** `tasks/agents/mi-growth-ops-agent.md`

## 1. Problem

The MI dashboard and launch operations currently show many counts, but the team still has to manually interpret what changed, why it changed, and what action to take next. The core questions are simple:

- Who joined or was imported?
- Who created an account?
- Who completed a useful profile?
- Who is opening or clicking emails?
- Who is spending time inside MI?
- Where are they spending time?
- Who is stuck and needs help?
- Who is ready for MI Pro, white-glove, or founder outreach?

If we do nothing, the team will keep reacting to disconnected dashboard numbers instead of operating from one growth brief with clear owner/action/date next steps.

## 2. Customer Segment

- MI Internal
- Admin/operator
- Coach/team member
- Customer success
- Founder

This is not a customer-facing agent in V1. It is an internal operating layer that helps the team improve customer outcomes.

## 3. Core Outcome

The team should know, each day, which users need help and which lever to pull so more small businesses use MI to find, evaluate, pursue, and eventually win federal contracts.

## 4. Business Goal

- Increase MI activation.
- Increase profile completion.
- Increase email-to-app engagement.
- Increase time in MI.
- Identify MI Pro upgrade candidates.
- Identify white-glove and 10-10 Forever candidates.
- Reduce confusion from dashboard metric mismatches.
- Create one source of truth for growth, usage, and next actions.

## 5. User Stories

> As Eric, I want one daily growth brief, so I can see whether MI is helping people find and pursue contracts without reading five dashboards.

> As Annelle or Sikander, I want prioritized outreach queues, so I know who to call, why they qualify, and what outcome we are trying to create.

> As a coach, I want to see who completed a profile but has not taken action, so I can help them move from setup to pursuing opportunities.

> As a product operator, I want data quality notes beside each metric, so I can tell whether a number dropped because behavior changed or because the query changed.

> As the growth team, I want engagement segments by email and app behavior, so we can improve onboarding, alerts, briefings, and upgrade prompts.

## 6. Public vs Gated Access

| Level | Visible Data | CTA |
| --- | --- | --- |
| Public | None | Not public |
| MI Free | None | Not customer-facing in V1 |
| MI Pro | None | Not customer-facing in V1 |
| MI Internal | Aggregate growth brief, segment counts, recommended actions | Assign owner / create outreach batch |
| Admin | Debug details, source freshness, sample records, route health | Repair data / run campaign / export queue |

## 7. Data Sources

Initial V1 sources:

- `user_notification_settings` for alert audience, profile configuration, alert frequency, and NAICS readiness.
- `user_profiles` and/or `smart_user_profiles` for profile completion and business context.
- Supabase Auth users for account setup status where available.
- Stripe/customer entitlement tables or existing admin access endpoints for MI Free, MI Pro, bundle, and internal classification.
- `briefing_log` for daily, weekly, and pursuit briefing sends.
- `alert_log` for free alert sends and delivery behavior.
- `user_engagement` for app events and feature usage.
- `engagement_daily_stats` for daily active usage rollups.
- `user_engagement_scores` for scored engagement and risk signals.
- Resend/email webhook event tables where available for delivered, opened, clicked, bounced, unsubscribed, helpful, and not helpful signals.
- Existing admin APIs:
  - `/api/admin/mi-onboarding`
  - `/api/admin/mi-account-setup`
  - `/api/admin/engagement-metrics`
  - `/api/admin/feature-usage`
  - `/api/admin/user-breakdown`
  - `/api/admin/alert-status`
  - `/api/admin/briefing-status`
  - `/api/admin/tool-health`

Known freshness limits:

- Email opens can be undercounted because privacy tools block tracking pixels.
- Clicks are more reliable than opens.
- App time depends on event capture quality.
- Entitlement and auth may not match for older imported users until account setup is complete.
- Internal/test users must be excluded from customer growth metrics.

## 8. UX Requirements

### First Screen

Add or feed a private MI Internal Growth Brief view with:

- New/imported users.
- Account setups.
- Profile completions.
- Active users today and last 7 days.
- Time in MI.
- Email sent/delivered/open/click signals.
- Stuck user queues.
- High-value user queues.
- Top recommended action.

### Primary Action

The primary action is to choose the next growth lever:

- Send account setup invite.
- Send profile completion nudge.
- Send deep-link email.
- Assign coach/customer success follow-up.
- Invite to MI Pro.
- Invite to white-glove/founder call.
- Open product/data quality ticket.

### Empty State

If no data is available, show:

- Which source is missing.
- Which query failed.
- Whether the issue is data freshness, access, or no matching users.

### Loading State

Use a visible animated loading state, not a static frozen button or blank card.

### Error State

Show a human-readable error:

- "Could not load email engagement."
- "Could not load app activity."
- "Could not classify entitlements."

Include a debug link or route name for admin users only.

### Mobile Constraints

The internal dashboard should be readable on mobile, but V1 is optimized for desktop operators.

## 9. Metrics

Track the agent itself by:

- Number of daily briefs generated.
- Number of action queues generated.
- Number of outreach lists exported.
- Number of users moved from no account to account setup.
- Number of users moved from no profile to profile complete.
- Number of users moved from email click to app activity.
- Number of MI Pro upgrade candidates identified.
- Number of white-glove/founder-call candidates identified.

Track MI outcomes by:

- Searches run.
- Briefings viewed.
- Alerts clicked.
- Opportunities saved.
- Pipeline items created.
- Recompetes researched.
- Contractors researched.
- Teaming partners added.
- Proposal workflows started.
- Bids submitted.
- Wins reported.

## 10. Decision Levers

| Signal | Likely Meaning | Lever |
| --- | --- | --- |
| Imported users high, account setup low | Users have access but no identity | Account setup invite campaign |
| Account setup high, profile completion low | Setup flow friction | Shorter profile flow or coach nudge |
| Email opens high, clicks low | Copy/CTA problem | Rewrite email CTA |
| Clicks high, app time low | Landing/product friction | Fix deep link, loading, first screen |
| Time in MI high, no saves | Product lacks next action | Add save/track/team prompts |
| Pro user inactive | Retention risk | Customer success rescue |
| High activity + saved opportunities | Strong success candidate | Personal outreach / case study |
| High activity + enterprise fit | Possible white-glove candidate | Founder or Branden follow-up |

## 11. Access And Security

- V1 must be admin/internal only.
- Do not expose PII in public routes or broad Slack channels.
- Any endpoint powering the agent must require admin authorization or a signed internal token.
- Customer-level drilldowns must require admin access.
- Aggregated summaries may be shared internally, but exports with emails require owner approval.
- The agent must not send email, change entitlements, or modify profiles in V1.
- Any future Slack/email digest must be approve-before-send.

## 12. Non-Goals

- No autonomous customer emails in V1.
- No entitlement changes in V1.
- No public dashboard in V1.
- No automated Slack posting in V1.
- No predictive scoring beyond simple rule-based segments.
- No replacement of Stripe, Supabase, or Resend as source systems.

## 13. Proposed V1 Output Shape

```json
{
  "generatedAt": "2026-05-10T12:00:00.000Z",
  "window": "last_7_days",
  "freshness": {
    "users": "2026-05-10T11:59:00.000Z",
    "emailEvents": "2026-05-10T11:55:00.000Z",
    "appEvents": "2026-05-10T11:58:00.000Z"
  },
  "audience": {
    "totalUsers": 0,
    "miFree": 0,
    "miPro": 0,
    "miInternal": 0,
    "importedNoAccount": 0,
    "accountCreatedNoProfile": 0,
    "profileComplete": 0
  },
  "engagement": {
    "activeToday": 0,
    "active7d": 0,
    "timeInMiMinutes": 0,
    "topAreas": []
  },
  "email": {
    "sent": 0,
    "delivered": 0,
    "clicked": 0,
    "helpful": 0,
    "notHelpful": 0,
    "topLinks": []
  },
  "queues": {
    "setupInvite": [],
    "profileNudge": [],
    "activationRescue": [],
    "proUpgrade": [],
    "whiteGloveCandidate": []
  },
  "recommendedActions": []
}
```

## 14. Implementation Plan

### Phase 1: Read-Only Growth Brief Endpoint

- Create an admin-only endpoint or script that returns the V1 output shape.
- Pull from existing tables and admin helpers.
- Exclude internal/test users from customer counts.
- Include source freshness and query warnings.

### Phase 2: Internal Dashboard Card

- Add the growth brief summary to the MI Internal Launch Command Center.
- Show the top three action queues.
- Show metric deltas only when the denominator and time window are clear.

### Phase 3: Outreach Queue Export

- Export CSV for Annelle/Sikander/customer success.
- Include email, segment, reason, recommended message angle, and owner.
- Do not send automatically.

### Phase 4: Weekly Memo Generator

- Generate a weekly markdown memo with:
  - What changed.
  - What is stuck.
  - Which customer segments need help.
  - Which product fixes matter.
  - Which outreach should happen next.

## 15. Acceptance Criteria

- [ ] Admin can generate a read-only MI Growth Brief.
- [ ] Growth Brief separates audience inventory, activation, engagement, email, and outcome metrics.
- [ ] Growth Brief excludes internal/test users from customer metrics.
- [ ] Every metric labels its source and freshness.
- [ ] Action queues include reason codes.
- [ ] No customer emails are sent automatically.
- [ ] No entitlements are changed automatically.
- [ ] Endpoint is admin protected.
- [ ] Output can feed the MI Internal Launch Command Center.
- [ ] Todo and docs are updated after implementation.
