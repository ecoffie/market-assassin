# PRD: Launch Manager Agent

**Date:** May 10, 2026  
**Status:** Implementation PRD  
**Owner:** GovCon Giants / Launch Ops  
**Primary users:** Eric, Annelle, Sikander, Tavin, Branden, Kash, Usama, Muneeba, Product/Engineering  
**Related docs:** `tasks/agents/launch-manager-agent.md`, `docs/strategy/MI-INTERNAL-COMMAND-CENTER-PRD.md`, `docs/strategy/MI-TEAM-ALIGNMENT-SLACK-BRIEF.md`

## 1. Purpose

The Launch Manager Agent keeps MI launch plans, team tasks, customer outreach, product readiness, content execution, and team updates aligned from one source of truth.

The goal is to stop running launch coordination through scattered markdown files, CSVs, screenshots, private notes, Slack threads, and founder memory.

## 2. Core Question

The agent should answer, every day during a launch window:

> What changed, who needs to act, what is blocked, and what should the team say or do next?

## 3. Strategic Context

GovCon Giants is moving from a training-first business into a Market Intelligence SaaS and execution company.

The operating model is:

- `govcongiants.com` = public website, SEO, sales pages, launch content, pricing, and public education.
- `mi.govcongiants.com` = Market Intelligence platform, customer login, app workflows, internal/admin workflows.
- `.org`, `tools.govcongiants.org`, and shop URLs = transition or redirect surfaces only.

The Launch Manager must preserve this domain distinction in all recommendations, link checks, team briefs, and launch status summaries.

## 4. Launches In Scope

V1 should track these launch programs:

| Launch | Outcome |
| --- | --- |
| MI Free rollout | Activate audience, complete profiles, identify engaged users |
| MI Pro launch | Convert serious users into paid intelligence workflows |
| May 30 bootcamp | Demonstrate MI and qualify serious buyers |
| White-glove offer | Move committed customers into execution support |
| Contractor SEO pages | Attract Google users with public/gated contractor data |
| Deal Flow Board | Support group/team collaboration around opportunities |
| Internal Launch Command Center | Give the team one private operating link |

## 5. Users And Roles

| Person / Group | Launch Role |
| --- | --- |
| Eric | Founder narrative, final decisions, 10-10 calls, strategic escalations |
| Annelle | User outreach, customer conversations, reply and call follow-up |
| Sikander | User outreach, qualification support, call notes, objection capture |
| Tavin | Coaching/customer success, activation signals, proof stories |
| Branden | Package presentations, enterprise selling, team plans, white-glove escalation |
| Kash | YouTube distribution, clips, descriptions, links, YouTube lead signals |
| Usama | Instagram distribution, reels/stories/posts, DMs, Instagram lead signals |
| Muneeba | LinkedIn distribution, posts/comments/outreach, LinkedIn lead signals |
| Product/Engineering | Product readiness, dashboards, access, data quality, blockers |

## 6. Source Inputs

The agent should read or be fed:

- `tasks/todo.md`
- MI Operating System roadmap
- Launch plans and memos
- Team alignment briefs
- Internal Command Center data
- Outreach CSVs/imports
- Customer qualification outputs
- Stripe/customer exports
- Supabase user/profile/access summaries
- Email templates and engagement summaries
- Website/funnel links
- Product readiness notes
- Social/content status updates
- Manual team notes

## 7. V1 Product Shape

### 7.1 Launch Status Brief

Generate a short internal launch status brief with:

- Launch objective
- Current status
- What changed since the last update
- Top blockers
- Customer signals
- Product readiness
- Content readiness
- Outreach readiness
- Enterprise/package readiness
- Owner/action/date table

### 7.2 Team Broadcast Draft

Generate a Slack-ready draft, but do not send automatically.

The draft should include:

- Decision
- What changed
- Who owns what
- What to say externally
- What not to say
- Links to source docs or dashboards

### 7.3 Owner Action Board

Generate action rows that can feed the Internal Launch Command Center:

| Field | Description |
| --- | --- |
| owner | Person responsible |
| area | outreach, product, content, sales, coach, founder, security |
| action | Specific next step |
| why | Reason tied to launch/customer outcome |
| due_date | Target date |
| status | not_started, in_progress, blocked, done |
| source | File, dashboard, customer, or memo that created the action |

### 7.4 Decision Register

Track open decisions:

- Decision needed
- Why it matters
- Owner
- Due date
- Options
- Recommendation
- Blocked launches
- Final decision once made

## 8. Data Contract

Proposed output shape:

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "launches": [
    {
      "name": "MI Pro Launch",
      "status": "active",
      "objective": "Convert serious users into weekly MI usage",
      "health": "yellow",
      "changes": [],
      "blockers": [],
      "customerSignals": [],
      "productReadiness": [],
      "contentReadiness": [],
      "outreachReadiness": [],
      "actions": []
    }
  ],
  "teamBroadcastDraft": {
    "headline": "",
    "whatChanged": [],
    "owners": [],
    "externalLanguage": [],
    "doNotSay": []
  },
  "decisions": [],
  "freshness": {
    "todo": "fresh",
    "outreach": "unknown",
    "stripe": "unknown",
    "supabase": "unknown",
    "content": "manual"
  }
}
```

## 9. Guardrails

- Do not send Slack, email, or customer messages without explicit approval.
- Do not change launch dates without an Eric/founder decision.
- Do not expose customer PII in broad team summaries.
- Do not recommend `.org`, `tools`, or shop links for new customer-facing material unless the action is specifically a redirect/compatibility task.
- Always distinguish MI Free, MI Pro, MI Internal, and white-glove.
- Every metric in a launch brief must connect to an action, owner, or decision.

## 10. V1 Non-Goals

Do not build in V1:

- Full Slack bot
- Automated task assignment inside Slack
- Automated customer outreach
- AI-generated customer promises
- Launch date auto-changes
- Full BI warehouse
- Complex role-based field permissions

V1 is a coordination layer and decision brief, not an autonomous operator.

## 11. Acceptance Criteria

- [ ] The agent can generate a Launch Status Brief from current launch docs and `tasks/todo.md`.
- [ ] The agent can produce a Slack-ready Team Broadcast Draft without sending it.
- [ ] The agent outputs owner/action/date rows for Eric, Annelle, Sikander, Tavin, Branden, Kash, Usama, Muneeba, and Product/Engineering.
- [ ] The agent calls out missing data sources and stale inputs.
- [ ] The agent separates public `.com` work from `mi.govcongiants.com` platform work.
- [ ] The agent identifies blockers by area: product, access, dashboard, email, outreach, content, sales, security.
- [ ] The agent includes open decisions with owner and due date.
- [ ] The agent avoids customer PII in team-wide summaries.
- [ ] The generated brief can be shown in the Internal Launch Command Center.

## 12. Recommended Build Order

1. Create a read-only generator script that loads launch docs and `tasks/todo.md`.
2. Output the JSON data contract to a local file or admin-only endpoint.
3. Add the Launch Status Brief panel to `/admin/launch-command-center`.
4. Add the Owner Action Board panel.
5. Add the Decision Register panel.
6. Add freshness warnings for missing or stale source data.
7. Add manual copy button for Slack broadcast draft.
8. Later, wire live owner updates from Supabase/internal tables.

## 13. First Implementation Slice

Build this first:

- `scripts/generate-launch-manager-brief.js`
- Source files:
  - `tasks/todo.md`
  - `docs/strategy/MI-TEAM-ALIGNMENT-SLACK-BRIEF.md`
  - `docs/strategy/MI-INTERNAL-COMMAND-CENTER-PRD.md`
  - `tasks/MI-OPERATING-SYSTEM-ROADMAP.md`
- Output:
  - launch summary
  - blockers
  - team actions
  - open decisions
  - freshness notes

Then expose it in the admin command center after the output is stable.
