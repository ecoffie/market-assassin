# PRD: Deal Flow Board

## Why This Matters

The Deal Flow Board is the collaborative layer between Market Intelligence and contract wins. Top buyer feedback said the most valuable future item is a shared board where owners, BD leads, capture managers, proposal writers, and teaming partners can work the same opportunities together.

This turns MI from "alerts and intelligence" into "team execution."

## Core Customer Question

Does this help small businesses find and win federal contracts?

The Deal Flow Board should prove that by tracking whether users:
- Find relevant opportunities
- Save or qualify them
- Assign owners and next actions
- Add teaming partners
- Move through capture/proposal stages
- Submit bids
- Record wins/losses and lessons

## Primary Users

| User | Job |
|------|-----|
| Founder / CEO | See the highest-value pursuits and know what needs attention |
| BD Lead | Qualify opportunities, assign owners, manage next actions |
| Capture Manager | Build pursuit strategy, teaming, pricing, and win themes |
| Proposal Lead | Track proposal deadlines, documents, and submission status |
| Team Member | Work assigned tasks and update status |

## MVP

### Board Views

- Account-level shared board for all team seats
- Columns: Inbox, Qualify, Capture, Proposal, Submitted, Won, Lost, No-Bid
- Filters: owner, agency, NAICS, due date, stage, value, set-aside, source
- Saved views: "Due this week", "Needs owner", "High value", "Teaming needed"

### Opportunity Cards

Each card should show:
- Opportunity title, agency, due date, estimated value
- Source: Alert, Briefing, SAM search, Forecast, Recompete, Manual
- Owner and collaborators
- Next action and due date
- Stage and win probability
- Teaming status
- Notes, files, and activity history

### Collaboration

- Assign owner and team members
- Comments and activity log
- Teaming partner list per opportunity
- Go/No-Go status
- Next action reminders
- Optional external collaborator invite for teaming partners

### MI Integrations

- Save from alert email -> Deal Flow Inbox
- Save from MI app -> Deal Flow Inbox
- Add to pursuit from SAM/opportunity card
- Create pursuit brief from a board card
- Recommend teaming partners from contractor database
- Daily/weekly email can summarize board changes and stuck pursuits

## Metrics To Track

### Finding Contracts

- Opportunity clicks -> saves conversion rate
- Saves -> board cards conversion rate
- Cards created by source
- Time from alert open to board save
- Top agencies/NAICS saved by teams

### Winning Contracts

- Cards by stage
- Stage conversion rate
- Submitted bids
- Wins/losses/no-bids
- Total pipeline value
- Average days in stage
- Stuck cards with no next action
- Team activity per pursuit

### Engagement

- Weekly active teams
- Team members active per account
- Comments/tasks per pursuit
- Time in board
- Email clicks back to board

## Success Definition

The feature is working when customers can answer:

- What are we pursuing?
- Who owns each pursuit?
- What is the next action?
- Which opportunities need teaming?
- What are we bidding this month?
- What did we win, lose, or no-bid?

For GovCon Giants, the feature is working when the admin dashboard can answer:

- Are users turning MI alerts into real pursuits?
- Are teams progressing opportunities through capture stages?
- Which accounts are most engaged and likely to renew?
- Which accounts need coaching because their board is stuck?

## Build Sequence

1. Add account/team model and shared board permissions.
2. Upgrade existing `user_pipeline` into account-aware deal flow.
3. Add board UI in MI beta beside Pipeline.
4. Add "Save to Deal Flow" from alerts, briefings, and opportunity cards.
5. Add owner, collaborators, next action, comments, and activity history.
6. Add admin metrics for saves -> board -> submitted -> won.
7. Add team digest email for overdue/stuck pursuits.

## Pricing Tie-In

Deal Flow Board belongs in MI Team and Enterprise:

- MI Pro: individual pipeline
- MI Team: shared Deal Flow Board with 5 seats
- MI Enterprise: board analytics, role-based access, SSO, external collaborators

