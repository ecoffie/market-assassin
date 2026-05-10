# PRD: MI Internal Launch Command Center

**Date:** May 9, 2026  
**Status:** Draft  
**Owner:** Eric / Product  
**Primary Users:** Eric, Annelle, Sikander, Ryan, Zach, Randie, internal team  
**Goal:** Replace scattered files, email threads, Slack messages, and manual updates with one private internal dashboard for MI launch, customer outreach, coach execution, and 10x scaling.

## 1. Problem

The MI launch and 10x strategy are currently spread across:

- Markdown files
- CSV outreach lists
- Slack messages
- Email threads
- Manual uploads
- Screenshots
- Founder memory

That makes it hard for Annelle, Sikander, coaches, and the rest of the team to know:

- Who should be contacted next
- What each person should say
- What customer segment each contact belongs to
- Which customers are MI Free, MI Pro, bundle, high-ticket, or 10-10 candidates
- Which customer feedback should change product, launch, or offer strategy
- Which coach is responsible for which validation, customer success, or partnership action
- What has already happened

## 2. Customer / Internal Segment

This is an internal product for:

| User | Job |
| --- | --- |
| Eric | See launch state, top customers, coach activity, and next decisions |
| Annelle | Manage outreach queue, replies, scheduling, and follow-ups |
| Sikander | Run customer validation calls and log structured feedback |
| Ryan | Capture coach/live/customer-success signals and partner opportunities |
| Zach | Capture coach/live/customer-success signals and partner opportunities |
| Randie | Capture coach/live/customer-success signals and partner opportunities |
| Product/Engineering | See customer issues, dashboard gaps, and product priorities |

## 3. Core Outcome

The team should be able to open one private link and know:

1. Who matters most this week.
2. What they should do next.
3. What has already happened.
4. Which customer signals matter.
5. Which coach/team member owns each action.
6. Whether MI is helping users find and move toward winning federal contracts.

## 4. Business Goal

The command center supports:

- MI launch execution
- 10-10 Forever customer selection
- Customer-first validation
- Coach-led scaling
- White-glove qualification
- Team accountability
- Reduced founder bottleneck
- Cleaner product decisions

## 5. Strategic Context

GovCon Giants is moving from training-first to Market Intelligence as the core product.

The team’s operating model should be:

> Customers and users first. Advisory second. Coaches help identify, activate, retain, and scale committed users.

Ryan, Zach, and Randie should not be limited to old weekly training roles. They should be included in the 10x strategy as:

- Customer success signal collectors
- MI activation helpers
- Livestream validation leads
- Partner / APEX / SBDC / chamber BD owners
- Team/enterprise opportunity spotters
- Proof-story and white-glove referral sources

## 6. First Version Scope

### 6.1 Home / Launch Snapshot

Show:

- This week’s launch objective
- Current MI launch status
- Top metrics
- Top risks
- Latest team memo
- Next decision needed from Eric

### 6.2 Outreach Queue

The Annelle/Sikander queue should include:

- Rank
- Email
- Name/company when available
- Segment
- Score
- Owner
- Status
- Recommended ask
- Next action
- Last contact date
- Call booked date
- Outcome tags
- Notes

Statuses:

- `not_contacted`
- `contacted`
- `replied`
- `call_booked`
- `call_completed`
- `follow_up_needed`
- `no_response`
- `not_fit`
- `escalate_to_eric`

### 6.3 Coach Queue

Ryan, Zach, and Randie should have a separate but connected queue.

Coach work types:

- `livestream_validation`
- `customer_success_checkin`
- `partner_bd`
- `enterprise_referral`
- `proof_story`
- `white_glove_referral`

Fields:

- Coach owner
- Target person/org
- Channel
- Segment
- Objective
- Status
- Notes
- Customer signals captured
- Follow-up needed

### 6.4 Customer Detail View

For any customer/contact, show:

- Identity: email, name, company
- Segment: MI Free, MI Pro, bundle, internal, white-glove candidate
- Stripe purchase/subscription history
- MI access level
- Auth/account setup state
- Profile completion
- Custom NAICS / location / keywords
- Briefing/alert opens and clicks
- MI app activity
- Pipeline/team/proposal activity
- Outreach history
- Coach notes
- Call notes
- Outcome tags
- Recommended next action

### 6.5 Team Briefing Hub

One place to see:

- Latest MI team alignment brief
- Latest May 30 launch memo
- Current Annelle/Sikander script
- Coach scripts
- Current offer language
- Current access model
- Dashboard definitions
- Open decisions

### 6.6 Metrics That Matter

Show only metrics tied to decisions:

- New/imported users
- Profiles completed
- MI active users
- Time in MI
- Briefing opens/clicks
- Helpful / not helpful
- Outreach contacts
- Replies
- Calls booked
- Calls completed
- Upgrade candidates
- White-glove candidates
- Coach partner leads
- Partner meetings booked
- Pipeline adds
- Teaming adds
- Proposal starts
- Reported wins

### 6.7 Notes and Outcome Capture

Every call or customer interaction should capture:

- What they value
- What confuses them
- What they wish MI added
- What would make them use MI weekly
- What contract outcome they want
- What their next action is
- What GovCon Giants should do next

Outcome tags:

- `setup_needed`
- `profile_completed`
- `mi_value_confirmed`
- `match_quality_issue`
- `wants_team_workflow`
- `wants_white_glove`
- `pricing_objection`
- `case_study_candidate`
- `upgrade_candidate`
- `partner_lead`
- `enterprise_lead`
- `not_now`
- `wrong_fit`

## 7. Data Sources

Phase 1 can start semi-manual but must write to one source of truth.

| Data | Source |
| --- | --- |
| Outreach list | Current CSV import |
| Customer purchases | Stripe export / existing scripts |
| MI access | Supabase entitlement/access tables |
| Profile status | Supabase user/profile tables |
| Email engagement | Briefing/alert logs |
| App usage | MI activity events |
| Call notes | New internal table |
| Coach activity | New internal table |
| Team memos | Repo docs linked or synced |

## 8. Proposed Tables

### `internal_outreach_contacts`

- `id`
- `email`
- `name`
- `company`
- `segment`
- `score`
- `source`
- `owner`
- `status`
- `recommended_ask`
- `next_action`
- `last_contacted_at`
- `call_booked_at`
- `created_at`
- `updated_at`

### `internal_outreach_notes`

- `id`
- `contact_id`
- `owner`
- `note_type`
- `summary`
- `what_they_value`
- `what_confused_them`
- `what_they_want_added`
- `next_action`
- `created_at`

### `internal_outreach_tags`

- `id`
- `contact_id`
- `tag`
- `created_by`
- `created_at`

### `internal_coach_activity`

- `id`
- `coach`
- `activity_type`
- `target_name`
- `target_org`
- `target_email`
- `status`
- `segment`
- `objective`
- `notes`
- `next_action`
- `created_at`
- `updated_at`

## 9. Access and Security

This must be private.

Access:

- Admin/internal only
- Email/password auth required
- Optional 2FA for general team
- Stronger access for admin/security views

No customer PII, Stripe data, or internal notes should be public.

## 10. UX Requirements

First screen:

- Launch snapshot
- My assigned actions
- Top customer actions
- Top coach actions
- Latest team memo

Key interaction:

- Team member updates status and notes without touching a CSV.

Empty state:

- "No assigned actions yet."

Loading state:

- Show visible progress indicator so it never feels frozen.

Error state:

- Explain what failed: customer data, outreach data, coach data, or memo data.

## 11. Non-Goals For V1

Do not build:

- Full CRM replacement
- Automated email sending
- Full Slack bot
- Advanced permissions by field
- AI call summaries
- Complex analytics warehouse

V1 should centralize the work and capture clean data.

## 12. Acceptance Criteria

- [ ] Annelle can see her outreach queue.
- [ ] Sikander can see calls booked and log call notes.
- [ ] Ryan, Zach, and Randie can see their coach/partner/customer-success actions.
- [ ] Eric can see top 10-10 candidates, white-glove candidates, and launch risks.
- [ ] Team can update status without editing CSV files.
- [ ] Customer notes and outcome tags are stored in one source of truth.
- [ ] Latest team memo is visible from the dashboard.
- [ ] The dashboard separates customer outreach from coach/partner activity.
- [ ] The dashboard is private and requires internal auth.

## 13. Recommended Build Order

1. Create the private dashboard shell.
2. Import Annelle/Sikander outreach CSV into a table.
3. Add owner/status/notes updates.
4. Add coach activity queue.
5. Link latest strategy/memo docs.
6. Pull in Stripe/Supabase customer context.
7. Add weekly rollup metrics.
8. Add Slack/email digest after the data model is stable.

