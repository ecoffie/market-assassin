# PRD Builder Skill

**Purpose:** Convert fast-moving product ideas into clear, buildable specs that keep MI focused on customer outcomes, SEO growth, and paid product value.

Use this skill before engineering starts on any new MI feature, dashboard, public SEO page, workflow, or automation.

## When To Use

Use this skill for:

- Contractor sales history charts
- Deal Flow Board
- Dashboard alignment
- Login/auth changes
- Public SEO contractor pages
- Forecast, recompete, grants, contractor, or pipeline integrations
- Email/briefing/reporting changes
- API hardening and access model changes

## Core Question

Does this help small businesses find federal contracts, win federal contracts, or decide what not to waste time on?

If the answer is unclear, the PRD is not ready.

## Required PRD Sections

### 1. Problem

What problem are we solving?

Include:
- Who feels the pain?
- What are they trying to do?
- What is confusing, slow, expensive, or missing today?
- What happens if we do nothing?

### 2. Customer Segment

Who is this for?

Choose one or more:
- Public SEO visitor
- MI Free
- MI Pro
- MI Internal
- Bundle customer
- Team account
- White-glove candidate
- Admin/operator

### 3. Core Outcome

What user result should this create?

Examples:
- Find a qualified opportunity.
- Understand a contractor's sales trend.
- Identify a likely teaming partner.
- Save an opportunity to pipeline.
- Decide whether to pursue.
- Start a proposal.
- Upgrade from public/free to MI Pro.

### 4. Business Goal

Why does GovCon Giants need this?

Examples:
- SEO acquisition
- MI activation
- MI Pro retention
- Upgrade conversion
- White-glove qualification
- Customer support reduction
- Product proof
- Security / trust

### 5. User Story

Format:

> As a {{segment}}, I want to {{action}}, so I can {{outcome}}.

Add 3-5 primary user stories.

### 6. Public vs Gated Access

Define what is visible at each level.

| Level | Visible Data | CTA |
| --- | --- | --- |
| Public | Teaser / limited data | Create free account |
| MI Free | Basic result + saved profile | Upgrade to Pro |
| MI Pro | Full data and workflows | Use / save / export |
| Internal/Admin | Debug and operations | Manage |

### 7. Data Sources

List:
- Tables
- APIs
- Cron jobs
- Cached materialized views
- External services
- Known freshness limits
- Required authorization

### 8. UX Requirements

Describe:
- First screen
- Primary action
- Empty state
- Loading state
- Error state
- Mobile constraints
- Export/share/print needs

Avoid building a page that only explains the feature. The user should be able to do the job immediately.

### 9. Metrics

Track success by:

- Page views / SEO impressions
- Signup or login from page
- Searches run
- Results viewed
- Saves / exports / pipeline adds
- Upgrade clicks
- Time on page
- Return usage
- Outcome reported

### 10. Decision Levers

What can the team change based on the data?

Examples:
- Gate more or less data
- Change copy
- Add filters
- Improve matching
- Add onboarding prompts
- Trigger outreach
- Create SEO pages for similar entities

### 11. Access and Security

Specify:
- Public safe route or protected route
- Required auth session
- Required entitlement
- Admin-only behavior
- Rate limits
- Data that must never be public

### 12. Non-Goals

What are we intentionally not building in this version?

This keeps the first version shippable.

### 13. Acceptance Criteria

Use checkboxes:

- [ ] User can complete the primary job.
- [ ] Empty/loading/error states work.
- [ ] Public/gated access behaves correctly.
- [ ] Metrics are trackable.
- [ ] Sensitive API routes are protected.
- [ ] Feature works on desktop and mobile.
- [ ] Docs/todo are updated.

## Contractor SEO Page Add-On

For public contractor pages, include:

### SEO Intent

What will people search?

Examples:
- "{{company}} federal contracts"
- "{{company}} government contract awards"
- "{{company}} NAICS"
- "{{company}} SAM.gov"
- "{{company}} contract history"

### Public Data Teaser

Show enough to rank and create trust:
- Company name
- UEI / CAGE when safe
- Top agencies
- Top NAICS
- Year-over-year sales chart
- Recent awards count
- Limited contract examples

Gate deeper value:
- Full award history
- Export
- Competitor comparison
- Contact intelligence
- Similar contractors
- Teaming recommendations

### SEO Conversion CTA

Tie CTA to the user's intent:

- "Track companies like this in MI"
- "Find expiring contracts from this contractor"
- "Get alerts for this NAICS"
- "See full award history"

## Done Criteria

A PRD is ready for engineering when:

- It names the customer segment.
- It names the user outcome.
- It separates public, free, pro, and internal access.
- It identifies source-of-truth data.
- It defines what to measure after launch.
- It has clear non-goals.
- It can be built in one coherent phase.

