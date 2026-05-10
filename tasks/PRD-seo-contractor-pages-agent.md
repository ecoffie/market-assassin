# PRD: SEO Contractor Pages Agent

> Status: Draft for implementation
> Product area: Public SEO Contractor Profiles, Market Intelligence, Federal Contractors
> Related specs: `tasks/agents/seo-contractor-pages-agent.md`, `tasks/PRD-contractor-sales-chart.md`
> Goal: Turn contractor award-history data into indexable public pages that attract high-intent Google traffic and convert qualified visitors into MI Free, MI Pro, teaming, pipeline, and white-glove workflows.

---

## 1. Problem

Small businesses often discover a contractor after seeing one award, one incumbent mention, one teaming opportunity, or one competitor name. The next question is simple:

> What has this company actually won year over year?

Today, that answer is hard to get quickly. Competitors like HigherGov and GovTribe train users to expect public contractor intelligence pages with useful summary data, then gate the full workflow.

GovCon Giants needs the same acquisition motion:

1. A buyer searches Google for a contractor, award winner, incumbent, UEI, CAGE, agency vendor, or NAICS vendor.
2. They land on a useful `govcongiants.com` contractor page.
3. They see enough public award-history data to trust the page.
4. They are gated when they want full history, contacts, recompetes, forecasts, exports, pipeline actions, or teaming workflows.
5. They create an MI account, upgrade to MI Pro, or request help.

This also solves an internal workflow problem. Eric and the team need to quickly research companies that appear to have won one contract and understand whether that win is a one-off or part of a real federal sales pattern.

---

## 2. Strategic Outcome

The agent should support the core MI questions:

1. Does this help small businesses find federal contracts?
2. Does this help them win federal contracts?

The answer is yes when public contractor pages lead users toward action:

- Find agencies already buying similar work.
- Identify incumbents and potential teaming partners.
- Understand which NAICS and agencies a contractor actually wins in.
- Spot year-over-year federal award trends.
- Move from passive research into MI Pro workflows.

The page is not just SEO content. It is a front door into Market Intelligence.

---

## 3. Domain Contract

Use the new domain model consistently:

| Surface | Domain | Role |
|---|---|---|
| Public contractor SEO pages | `govcongiants.com` | Indexable acquisition and trust-building |
| Authenticated MI app workflows | `mi.govcongiants.com` | Paid/free user product experience |
| `.org`, `tools`, `shop` | transition only | Redirect surfaces after matching destinations exist |

Public canonical pattern:

`https://govcongiants.com/contractors/[slug]`

Authenticated MI deep-link pattern:

`https://mi.govcongiants.com/contractors/[slug]`

Do not create new customer-facing links to `.org`, `tools.govcongiants.org`, or old shop routes.

---

## 4. Users

### Public Search Visitor

Wants a fast answer about a contractor found through Google.

### MI Free User

Wants more detail than public search, but does not yet need the full workflow.

### MI Pro User

Wants full contractor research connected to pipeline, teaming, recompetes, forecasts, exports, and alerts.

### Internal Team

Needs candidate-page lists, refresh priorities, quality flags, and conversion signals.

---

## 5. Agent Responsibilities

The SEO Contractor Pages Agent should produce a weekly internal brief that answers:

- Which contractor pages should be created next?
- Which existing pages should be refreshed?
- Which pages have enough data coverage to be public?
- Which data should be public versus gated?
- Which pages are thin, stale, broken, or wrongly canonicalized?
- Which pages are ranking, getting clicks, and converting?
- Which pages should link into MI workflows?

---

## 6. Source Inputs

The first implementation should be read-only and use existing data where possible:

| Source | Use |
|---|---|
| `src/data/contractors.json` | contractor inventory, names, agencies, NAICS, contact availability |
| `usaspending_awards` cache | award-history summary, annual obligations, recent awards |
| contractor sales-history API/spec | public and MI Pro payload definitions |
| MI contractor usage events | which contractors users already research |
| Search Console or SEO export | impressions, clicks, CTR, indexed status |
| sitemap / route crawl | broken, stale, or missing pages |
| recompete and forecast data | gated MI Pro connections |

Known MVP limitation: the current award cache may be incomplete by contractor. The agent must distinguish "no awards found" from "cache coverage is limited."

---

## 7. Candidate Scoring

Each contractor should receive a page priority score.

Suggested factors:

| Signal | Why It Matters |
|---|---|
| High total federal obligations | Strong search and research value |
| Recent awards | Timely search demand |
| Clear year-over-year trend | Useful public chart story |
| Relevant NAICS demand | Easier SEO clustering |
| Agency concentration | Helps users identify buyers |
| Upcoming recompete exposure | Converts into MI Pro workflow |
| Contact or SBLO availability | Supports teaming and outreach |
| MI user research activity | Shows product demand |
| Thin competitor SERP | Easier ranking opportunity |
| Existing page traffic but low conversion | Refresh/CTA opportunity |

Output priority:

- `build_now`
- `refresh_now`
- `monitor`
- `defer`
- `do_not_publish_yet`

---

## 8. Public Versus Gated Data

### Public SEO Page

Public pages should be useful enough to earn trust and index well.

Allowed public content:

- Contractor name
- Known public aliases
- High-level federal obligation total
- 5-year annual federal obligations chart
- Top 3 agencies
- Top NAICS codes
- 3-5 recent awards
- Public source labels
- Last updated date
- Limited related contractors
- CTA into MI Free or MI Pro

### MI Free

MI Free should show more than public but still gate workflow depth:

- More recent awards than public
- Basic filters
- Limited contractor profile views
- Profile setup prompts
- Upgrade gates for full award history, contacts, exports, alerts, pipeline, and teaming

### MI Pro

MI Pro gets the complete workflow:

- Full award history
- Full agency and NAICS drilldowns
- Contacts where available
- Recompete connections
- Forecast connections
- Similar contractors
- CSV/export
- Add to Teaming CRM
- Track as competitor
- Create pipeline item
- Saved searches and alerts

### Internal/Admin

Internal users can see diagnostics:

- Match confidence
- Cache coverage
- Source freshness
- Missing UEI/CAGE/PSC fields
- Indexability status
- Conversion performance
- Data quality warnings

---

## 9. Output Contract

The agent should produce a JSON-ready report and a human-readable summary.

```json
{
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "summary": {
    "buildNow": 25,
    "refreshNow": 12,
    "monitor": 80,
    "doNotPublishYet": 14
  },
  "domainPolicy": {
    "publicCanonicalDomain": "govcongiants.com",
    "miAppDomain": "mi.govcongiants.com"
  },
  "candidates": [
    {
      "contractorName": "PANTEXAS DETERRENCE LLC",
      "slug": "pantexas-deterrence-llc",
      "priority": "build_now",
      "score": 94,
      "publicUrl": "https://govcongiants.com/contractors/pantexas-deterrence-llc",
      "miUrl": "https://mi.govcongiants.com/contractors/pantexas-deterrence-llc",
      "dataCoverage": "strong",
      "match": {
        "method": "recipient_name",
        "confidence": "medium"
      },
      "seo": {
        "targetKeywords": [
          "PANTEXAS DETERRENCE LLC federal contracts",
          "PANTEXAS DETERRENCE LLC government contracts"
        ],
        "canonicalOk": false,
        "recommendedTitle": "PANTEXAS DETERRENCE LLC Federal Contract Awards"
      },
      "publicPreview": {
        "fiveYearObligationsAvailable": true,
        "topAgenciesAvailable": true,
        "recentAwardsAvailable": true
      },
      "gates": [
        "full_award_history",
        "contacts",
        "recompetes",
        "pipeline_actions",
        "teaming_actions"
      ],
      "recommendedActions": [
        "Create or refresh public contractor page",
        "Fix canonical to govcongiants.com",
        "Deep-link MI Pro CTA to mi.govcongiants.com"
      ]
    }
  ]
}
```

---

## 10. Human-Readable Brief

The weekly summary should include:

- Top 10 contractor pages to create
- Top 10 contractor pages to refresh
- Pages with broken canonical domain
- Pages with thin data coverage
- Pages getting traffic but not converting
- Pages that should link to MI Pro contractor, forecast, recompete, pipeline, or teaming workflows
- Data gaps that product/engineering should fix

This should be internal first. Do not auto-publish pages or send Slack/email messages until reviewed.

---

## 11. SEO Page Requirements

Each public contractor page should include:

- H1: `[Contractor Name] Federal Contract Awards`
- Title: `[Contractor Name] Federal Contract Awards and Sales History`
- Description: mention federal obligations, agencies, NAICS, recent awards where available
- Canonical URL on `govcongiants.com`
- Structured data where appropriate
- Source and last-updated labels
- Internal links to related contractors, agencies, NAICS pages, and MI signup/upgrade
- Clear CTA: "Unlock full contractor intelligence"

Every page should avoid misleading zero states.

Use:

- "No cached award history found"
- "Limited cached award history"
- "Showing cached MI award history"

Do not silently present incomplete cache data as complete federal history.

---

## 12. Conversion Model

Public pages should have clear action gates:

| User Need | Public Response | Gate |
|---|---|---|
| See basic federal award trend | Show limited chart | none |
| See full award history | Tease count/detail | MI Free or Pro |
| Export data | Show locked export CTA | MI Pro |
| See contacts | Show contact availability only | MI Pro |
| Track competitor | Show action CTA | MI Pro |
| Add to Teaming CRM | Show action CTA | MI Pro |
| Create pipeline item | Show action CTA | MI Pro |
| Find recompetes | Show teaser if available | MI Pro |

Primary CTA:

`Create free MI account`

Secondary CTA:

`Unlock MI Pro contractor intelligence`

White-glove CTA should only appear on high-intent pages or after deeper engagement.

---

## 13. Guardrails

- Do not expose private customer data.
- Do not expose full contact lists publicly.
- Do not expose full award exports publicly.
- Do not show internal diagnostics publicly.
- Do not promise that users will win contracts.
- Do not generate thin public pages just to inflate page count.
- Do not use `.org`, `tools`, or shop links for new customer journeys.
- Public pages must cite source/freshness and explain federal obligations versus private revenue.
- Paid/internal APIs require authorization.
- Public endpoints must be intentionally allowlisted and limited.

---

## 14. Build Sequence

1. Add this PRD to the MI Operating System TODO list.
2. Build a read-only candidate scorer script:
   - `scripts/generate-seo-contractor-page-brief.js`
3. Use existing contractor and award cache data first.
4. Output JSON and Markdown summaries to `/tmp` or `tasks/generated/`.
5. Flag pages whose canonical is not `govcongiants.com`.
6. Flag public pages with weak data coverage.
7. Generate top build/refresh candidates.
8. Add Search Console inputs later.
9. Add admin dashboard panel after the generated brief is useful.
10. Connect candidate output to contractor page creation/refresh workflow.

---

## 15. Acceptance Criteria

- Agent can rank contractor page candidates from existing data.
- Agent distinguishes build, refresh, monitor, defer, and do-not-publish candidates.
- Agent outputs public URL and MI deep-link URL using the correct domains.
- Agent flags `.org`, `tools`, `shop`, or incorrect `mi` canonicals for public SEO pages.
- Agent recommends public versus gated data for each candidate.
- Agent includes source freshness and cache coverage warnings.
- Agent does not include private customer data.
- Agent does not auto-publish or auto-send messages.
- Output can be reviewed by Eric, product, SEO, and engineering.

---

## 16. Open Decisions

| Decision | Recommendation |
|---|---|
| Should every contractor get a public page? | No. Start with strong data coverage and search demand. |
| Should pages live on `govcongiants.com` or `mi.govcongiants.com`? | Public SEO pages on `govcongiants.com`; authenticated workflow on `mi.govcongiants.com`. |
| Should public users see charts? | Yes, limited 5-year obligations chart. |
| Should MI Free see more than public? | Yes, enough to understand value; gate full workflow. |
| Should this auto-publish pages? | No, generate reviewed candidate lists first. |
| Should "sales" be used in UI? | Use "Federal Award History" and explain obligations. |

---

## First Implementation Slice

Build the read-only candidate scorer before adding more UI:

`scripts/generate-seo-contractor-page-brief.js`

The script should produce:

- candidate page list
- public/gated data recommendation
- canonical/domain warnings
- data coverage status
- next implementation actions

That gives the team one source of truth for which public contractor pages should be built first and how they connect to MI.
