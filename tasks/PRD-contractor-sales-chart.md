# PRD: Contractor Sales History Chart

> Status: Draft for review
> Product: Market Intelligence
> Feature area: Public SEO Contractor Profiles, Federal Contractors, Teaming CRM, Pipeline
> Goal: Attract users through Google search results and help them quickly understand a contractor's federal sales history so they can decide who to team with, compete against, or pursue.

---

## 1. Problem

Small businesses can search contractor names today, but they still cannot quickly answer the questions that matter:

- Is this contractor actively winning federal work?
- Which agencies buy from them?
- Are they growing, shrinking, or concentrated in one customer?
- What NAICS/PSC categories do they actually win in?
- Are they a good teaming partner, competitor, or incumbent to displace?
- What should I do next with this intelligence?

The current MI contractor experience shows useful contractor rows, contacts, contract counts, and total value. It does not yet show the award history pattern behind the number.

This creates a gap against GovTribe/HigherGov-style contractor profiles, where users expect a quick visual read on federal sales history.

There is also an acquisition gap. People search Google for contractor names, award winners, incumbents, UEIs, CAGE codes, NAICS categories, and agency vendors. If our contractor intelligence only exists behind login, we miss high-intent SEO traffic from users who are actively researching the federal market.

---

## 2. Outcome

The feature should help a user answer two strategic questions:

1. Does this help small businesses find federal contracts?
2. Does this help them win federal contracts?

The answer should be yes because the chart should turn raw award history into actions:

- Find agencies already buying similar work.
- Find incumbent contractors attached to upcoming recompetes.
- Validate teaming partners by actual past performance.
- Identify agencies where a competitor is strong or vulnerable.
- Move a contractor or agency into Pipeline or Teaming CRM.

The feature should also help attract new MI users from Google by exposing useful public contractor pages while gating the deeper workflow.

The SEO answer should be:

1. A buyer searches Google for a contractor or incumbent.
2. They land on a public GovCon Giants contractor profile.
3. They see enough award history to trust the page.
4. They hit a clear gate when they want deeper analysis, saved searches, alerts, contacts, recompetes, or workflow actions.
5. They create an account or upgrade to MI.

### Product Decision

This should be positioned in MI as **Federal Award History**, not generic "sales."

Users may say "sales history," but the product should label the metric as federal obligations so we do not imply private-company revenue. The plain-English promise is:

> See who this contractor sells to in the federal market, whether they are growing, and what to do next.

The chart is not the product. The decision and next action are the product.

---

## 3. User Stories

As a small business owner, I want to see a contractor's federal award history so I can decide if they are worth contacting.

As a BD lead, I want to see sales by agency and year so I can spot where a contractor has real relationships.

As a capture strategist, I want to compare contract size, frequency, and timing so I can identify recompete and teaming opportunities.

As an MI Pro user, I want this chart connected to Pipeline and Teaming CRM so the next action is obvious.

As a Google search visitor, I want to see a useful contractor profile without logging in so I can decide whether GovCon Giants has the market intelligence I need.

As a free MI user, I want enough contractor intelligence to understand the value, but I expect deeper analysis and actions to require Pro.

As a founder/operator, I want to research companies that appear to have won one interesting contract and quickly see whether that award was a one-off or part of a year-over-year federal sales pattern.

---

## 4. MVP Scope

### In Scope

- Public SEO contractor profile pages.
- Contractor profile panel inside MI Contractors.
- Sales history chart for a selected contractor.
- 5-year federal obligations by fiscal year.
- Breakdown by top agencies.
- Breakdown by NAICS or PSC where available.
- Recent awards table with award title, agency, value, date, and period of performance.
- Action buttons:
  - Add to Teaming CRM
  - Track as Competitor
  - Add Agency to Target List
  - Create Pipeline Item
- Public-to-free-to-Pro conversion gates.
- Clear data label: "Federal obligations, not company revenue."

### Out of Scope

- Full competitor comparison matrix.
- Salesforce integration.
- Automated relationship scoring.
- Predictive win probability.
- CSV export, unless it is already trivial through existing table utilities.
- Paid third-party enrichment until the internal data model is stable.
- Exposing full contact lists publicly.
- Exposing full award exports publicly.
- Letting public visitors save, track, or create pipeline actions.

---

## 5. Access Model

This feature has two jobs:

1. SEO acquisition: useful public pages that can rank in Google.
2. MI workflow: deeper gated intelligence that helps users act.

### Public SEO Page

Public pages should be indexable and useful. They should expose enough data to answer basic research questions without giving away the full MI workflow.

Suggested route:

`/contractors/[slug]`

Public content:

- Contractor name
- Known aliases if available
- High-level federal obligation total
- 5-year annual obligation chart
- Top 3 agencies
- Top NAICS codes
- 3-5 recent awards
- Public source and last-updated label
- Clear CTA to "Unlock full contractor intelligence"

Gated content:

- Full award history
- Full agency breakdown
- SBLO/contact data
- Recompete analysis
- Similar contractors
- Teaming CRM actions
- Pipeline actions
- CSV/export
- Saved searches and alerts

### MI Free

MI Free should see more than public, but not the full workflow:

- More recent awards than public.
- Basic filters.
- Limited contractor profile views.
- Upgrade gates for full history, contacts, actions, exports, and alerts.

### MI Pro

MI Pro gets the full workflow:

- Full chart.
- Agency and NAICS drilldowns.
- Recent awards.
- Contacts where available.
- Teaming CRM.
- Competitor tracking.
- Pipeline creation.
- Recompete linkage.

### Internal/Admin

Internal users can see data-quality diagnostics:

- Match confidence.
- Cache coverage.
- Source freshness.
- Missing UEI/CAGE/PSC fields.
- Whether public page is indexable.

---

## 6. Product Requirements

### Chart

The default chart should show annual federal obligations for the selected contractor.

Recommended first view:

- X-axis: fiscal year
- Y-axis: obligated dollars
- Bar chart or stacked bar chart
- Stack/group: top 5 awarding agencies
- Secondary summary cards:
  - 5-year total
  - latest fiscal year total
  - top agency
  - award count
  - average award size

### Drilldowns

When a user clicks a year or agency, show:

- Award list for that segment.
- Top NAICS/PSC categories.
- Contracting offices when available.
- Set-aside and competition indicators when available.

### Action Model

Every insight should map to a next step:

| Insight | What It Means | Primary Action |
|---|---|---|
| Contractor has repeated awards with one agency | Strong incumbent or partner candidate | Track as Competitor or Add Agency to Target List |
| Contractor has one large recent award | Possible one-off winner or emerging incumbent | Review year-over-year history and recent awards |
| Contractor wins in user's NAICS | Relevant past performance | Add to Teaming CRM |
| Contractor has upcoming end dates | Recompete angle | Create Pipeline Item |
| Contractor has many awards but no SBLO contact | Research/contact gap | Find contact or assign outreach |
| Contractor has shrinking obligations | Potential vulnerability | Track for displacement strategy |
| Contractor has diverse agencies | Broader teaming potential | Add to Partner Shortlist |

### Empty States

If no award history is found:

- Say "No federal award history found for this contractor."
- Offer next actions:
  - Search by alternate legal name
  - Search by UEI/CAGE
  - Search similar contractors in this NAICS

### Data Accuracy Labels

Every chart must make clear:

- Source: USAspending or cached MI award data.
- Last updated date.
- Amount type: federal obligations.
- Entity match method: UEI/CAGE exact match, recipient name match, or fuzzy match.

### SEO Page Requirements

Public contractor profile pages should have:

- Indexable HTML rendered server-side or statically where practical.
- Clean page titles: `[Contractor Name] Federal Contract Awards and Sales History`.
- Meta description with agency/NAICS/value language when available.
- Canonical URL on `.com`.
- Structured data where appropriate.
- Internal links to:
  - related contractors
  - agency pages
  - NAICS pages
  - Market Intelligence signup/upgrade
- No dead-end pages. If data is thin, show related searches and explain coverage.

---

## 7. Data Requirements

Preferred identifiers:

1. UEI
2. CAGE
3. Recipient name plus state
4. Recipient name only as a fallback

Needed fields:

- recipient name
- recipient UEI or generated recipient ID
- award ID
- award description
- awarding agency
- awarding subagency
- awarding office
- NAICS code and description
- PSC code and description
- award amount / obligation
- award date
- period of performance start and end
- set-aside type
- competition type

The current `src/data/contractors.json` dataset has company, NAICS, agencies, contract count, total contract value, and contact fields. It does not appear to contain normalized award-level history, so the chart needs either a cached award-history table or a live USAspending lookup with caching.

### Existing Assets in This Repo

The first build should reuse what already exists:

| Asset | Current Use | PRD Implication |
|---|---|---|
| `src/components/mi-beta/panels/ContractorsPanel.tsx` | MI contractor search and list view | Add a detail drawer/profile from here |
| `src/app/api/contractors/route.ts` | Contractor search and stats | Keep list/search fast; do not overload it with chart payloads |
| `src/data/contractors.json` | Contractor inventory and contact fields | Use as the selected contractor source |
| `src/app/api/contract-intel/competitor/route.ts` | Competitor intelligence by UEI/company | Reuse/refactor logic, but harden auth before using for paid MI |
| `supabase/migrations/20260414_usaspending_awards.sql` | Cached USAspending awards table | Use this as the MVP award-history source |
| `src/app/api/cron/sync-usaspending-awards/route.ts` | Syncs selected NAICS awards into cache | Extend later for on-demand contractor backfill |

### Current Award Cache

`usaspending_awards` already stores:

- `award_id`
- `recipient_name`
- `award_amount`
- `awarding_agency`
- `awarding_sub_agency`
- `contract_type`
- `naics_code`
- `naics_description`
- `pop_state`
- `start_date`
- `end_date`
- `description`
- `usaspending_id`
- `synced_at`

This is enough for an MVP chart by contractor name, fiscal year, agency, NAICS, and recent awards.

Known gaps:

- No `recipient_uei`
- No `cage_code`
- No `psc_code`
- No `psc_description`
- No `awarding_office`
- No explicit `fiscal_year`
- No set-aside type
- No competition type

These gaps should not block the MVP, but the UI must show match confidence and data coverage.

---

## 8. Technical Approach

### API

Add an authenticated MI endpoint:

`GET /api/mi-beta/contractors/sales-history?contractorId=...`

Accepted query fallbacks:

`GET /api/contractors/sales-history?company=...&uei=...`

The endpoint must require MI authorization. It should not be public.

Recommendation:

- Build under `/api/mi-beta/contractors/sales-history` first because this is an MI feature.
- Reuse the existing `/api/contract-intel/competitor` lookup logic where useful.
- Create a separate public-safe contractor profile payload for SEO pages.
- Do not expose paid contractor intelligence, contacts, workflow actions, or exports through a public route.
- Add `/api/contract-intel/competitor` to the API hardening list if it remains available.

Suggested response:

```json
{
  "success": true,
  "source": "usaspending_cache",
  "lastUpdated": "2026-05-09T00:00:00.000Z",
  "match": {
    "method": "recipient_name",
    "confidence": "medium",
    "name": "PANTEXAS DETERRENCE LLC"
  },
  "summary": {
    "totalObligations": 30100000000,
    "awardCount": 42,
    "topAgency": "Department of Energy",
    "latestFiscalYear": 2026
  },
  "series": [
    {
      "fiscalYear": 2026,
      "totalObligations": 850000000,
      "agencyBreakdown": [
        { "agency": "Department of Energy", "amount": 850000000 }
      ]
    }
  ],
  "awards": []
}
```

### Caching

Do not query USAspending on every page load.

Use this order:

1. Return cached history if fresh.
2. If cached coverage is thin, return a useful "limited coverage" state.
3. If live fetch/backfill is enabled, fetch from USAspending.
4. Store normalized results.
5. Return chart payload.

Suggested TTL:

- 7 days for contractor profile history.
- 24 hours for active/recent contractors if refresh cost is acceptable.

MVP note:

The current `usaspending_awards` cache is populated by selected target NAICS. That means a contractor can exist in `contractors.json` while their award history is incomplete in the cache. The first version should say one of:

- "Showing cached MI award history."
- "Limited cached award history found."
- "No cached award history found."

Do not silently show a zero chart if we do not know whether the cache is complete.

### Public Data Endpoint

Add a public-safe read endpoint only if needed for public contractor pages.

Example:

`GET /api/public/contractors/[slug]`

This endpoint should return only public-safe fields:

- contractor identity
- public summary metrics
- limited 5-year chart
- top 3 agencies
- top NAICS
- limited recent awards
- source labels
- CTA/gating metadata

It must not return:

- private user data
- saved searches
- customer-specific matches
- SBLO/contact enrichment beyond intentionally public fields
- Teaming CRM data
- Pipeline data
- internal diagnostics
- admin/cache metadata beyond public freshness labels

This should be explicitly allowlisted in the API auth audit as an intentional public route.

### Frontend

Add a reusable component:

`src/components/mi-beta/ContractorSalesHistoryChart.tsx`

Integrate into the MI Contractors panel:

- Show chart when user opens a contractor details drawer/profile.
- Keep the contractor search list fast.
- Lazy-load chart only after contractor selection.

Recommended profile layout:

1. Overview
2. Federal Award History
3. Top Agencies
4. Recent Awards
5. Actions

Action buttons:

- Add to Teaming CRM
- Track as Competitor
- Add Agency to Target List
- Create Pipeline Item

Public vs MI Free vs MI Pro:

- Public SEO: limited chart and summary, indexable, strong CTA.
- MI Free: more than public but still gated; full history and workflow actions require Pro.
- MI Pro: full chart, agency breakdown, recent awards, and actions.

### Initial Screen Behavior

From the MI Contractors list:

1. User searches or filters contractors.
2. User clicks a contractor row/card.
3. A right-side drawer opens without leaving the list.
4. The drawer immediately shows contractor summary/contact fields from `contractors.json`.
5. Award history lazy-loads below the summary.
6. If cached award data exists, chart and actions render.
7. If data is limited, show a coverage notice and suggested search/backfill action.

The list must remain usable even if the award-history API is slow or fails.

---

## 9. Success Metrics

| Metric | Target | Why It Matters |
|---|---:|---|
| Organic landing visits to contractor pages | Increase month over month | Shows SEO acquisition is working |
| Public-to-signup conversion | Baseline, then improve | Measures whether public data creates trust |
| Public-to-Pro conversion | Baseline, then improve | Measures monetization of high-intent research traffic |
| Contractor profile opens | Increase week over week | Indicates users are researching partners/competitors |
| Add to Teaming CRM clicks | 10%+ of profile opens | Shows sales history creates action |
| Add to Pipeline clicks | 5%+ of profile opens | Connects research to pursuits |
| Time on contractor profile | 60+ seconds average | Shows users are analyzing, not bouncing |
| Support questions about "what does this contractor do?" | Down | Chart should answer the question visually |

### Result Metrics

These are the longer-term measures that connect the feature to the mission:

| Metric | Why It Matters |
|---|---|
| Contractors added to Teaming CRM | Users are identifying potential partners |
| Agencies added to target list | Users are finding buyers for their work |
| Pipeline items created from contractor profile | Research is turning into pursuits |
| Recompete opportunities created from award history | Users are finding contracts before recompete |
| Outreach notes/contacts added | Users are moving from passive research to action |

---

## 10. Acceptance Criteria

- Public contractor page is indexable and useful without login.
- Public page gates full access at the correct points.
- User can open a contractor and see a sales history chart.
- Chart renders from cached data in under 2 seconds.
- Live fetch fallback completes or fails gracefully.
- User can see top agencies and recent awards.
- User can take one of the next actions from the profile.
- Paid/internal APIs require authorization.
- UI clearly labels obligations vs revenue.
- No chart is shown from low-confidence fuzzy matches without a visible warning.
- Empty state differentiates between "no awards found" and "cache coverage is incomplete."
- Existing contractor search remains fast and does not block on award-history loading.
- The feature can be deployed behind MI Pro entitlement first.
- Public endpoint returns only public-safe fields.
- Paid/internal endpoints require authorization.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Wrong company match | Prefer UEI/CAGE. Show match confidence. |
| Large contractors skew chart | Use agency breakdown and recent award list to explain spikes. |
| USAspending latency | Cache and lazy-load. |
| "Sales" sounds like private revenue | Label as "Federal obligations." |
| Another disconnected MI feature | Add Pipeline and Teaming CRM actions in MVP. |
| Giving away too much public data | Limit public view and gate workflow depth. |
| Thin public pages hurt SEO | Use related contractors, agency links, and clear coverage labels. |
| Duplicate `.org` and `.com` URLs split SEO | Canonicalize to `.com` and redirect `.org` paths. |

---

## 12. Build Sequence

1. Confirm available identifiers in contractor dataset.
2. Confirm current `usaspending_awards` cache coverage for sample contractors.
3. Define public-safe payload vs MI Pro payload.
4. Add public contractor profile route and canonical SEO metadata.
5. Add authenticated MI sales-history API using cached awards first.
6. Add limited-coverage response state so zeros are not misleading.
7. Build contractor detail drawer in MI Contractors.
8. Add chart component with empty/loading/error/limited-coverage states.
9. Add top agencies and recent awards sections.
10. Add action buttons to Teaming CRM and Pipeline.
11. Track SEO and workflow engagement events.
12. Deploy public pages and MI Pro workflow behind correct access rules.
13. Add optional USAspending backfill after cached MVP works.

---

## 13. Implementation Notes

### Endpoint Behavior

The endpoint should resolve the selected contractor in this order:

1. Exact UEI match, once UEI is available.
2. Exact CAGE match, once CAGE is available.
3. Exact normalized recipient name.
4. Recipient name plus state.
5. Fuzzy name match with visible warning.

For the current MVP, normalized recipient name is likely the practical first path.

### Fiscal Year

If `fiscal_year` is not stored, derive it from `start_date` or award action date if available:

- Federal fiscal year starts October 1.
- Dates in October, November, and December belong to the next fiscal year.

### Suggested Phase 2 Migration

Add nullable fields to `usaspending_awards`:

- `recipient_uei`
- `cage_code`
- `psc_code`
- `psc_description`
- `awarding_office`
- `fiscal_year`
- `set_aside_type`
- `competition_type`
- `award_action_date`

These should be additive so the current cache keeps working.

### Security

This feature should follow the API hardening work:

- Public contractor page endpoint must be intentionally public and limited.
- New route requires MI auth.
- Admin/debug routes require admin auth.
- Cron/backfill routes require `CRON_SECRET` or admin auth.
- No contractor intelligence endpoint should leak paid MI data publicly.

### Event Tracking

Track events so the dashboard can show whether this feature is useful:

- `public_contractor_page_viewed`
- `public_contractor_signup_clicked`
- `public_contractor_upgrade_clicked`
- `contractor_profile_opened`
- `contractor_sales_history_loaded`
- `contractor_sales_history_empty`
- `contractor_sales_history_limited_coverage`
- `contractor_added_to_teaming_crm`
- `contractor_tracked_as_competitor`
- `agency_added_to_target_list`
- `pipeline_item_created_from_contractor`

These events should include:

- user id
- plan/tier
- contractor id/name
- match method
- source/cache status
- public/free/pro surface
- timestamp

### Copy Guidelines

Use customer-facing language that pushes action:

- Good: "This contractor has won $12.4M with Department of Energy since FY2022."
- Good: "Most awards are concentrated with one agency. Consider tracking them as an incumbent."
- Good: "Cached coverage is limited. Results may not include all federal awards."
- Avoid: "Sales revenue"
- Avoid: "No results" when the issue may be incomplete cache coverage.

### SEO Copy Guidelines

Public pages should target searches users actually make:

- `[Company Name] federal contracts`
- `[Company Name] government contracts`
- `[Company Name] contract awards`
- `[Company Name] USAspending`
- `[Company Name] CAGE code`
- `[Company Name] NAICS`
- `[Agency] contractors [NAICS]`

Public H1 pattern:

`[Contractor Name] Federal Contract Awards`

Helpful subhead:

`Federal obligations, agencies, NAICS codes, and recent contract activity for [Contractor Name].`

---

## 14. Test Plan

- Public contractor page loads without login.
- Public contractor page has canonical `.com` URL.
- Public contractor page does not expose gated fields.
- `.org` contractor URLs redirect to `.com` when applicable.
- Unauthorized request to sales-history API returns `401`.
- MI Free request either returns a teaser payload or `403`, depending on final entitlement decision.
- MI Pro request returns chart payload for a cached contractor.
- Known no-data contractor returns a clear empty state, not a broken chart.
- Known low-confidence name match returns warning metadata.
- Contractor list search still loads independently of chart API.
- Build passes.
- Manual QA verifies drawer, chart, agency breakdown, recent awards, and action buttons.

---

## 15. Open Decisions

| Decision | Recommendation |
|---|---|
| Should public users see this? | Yes, limited SEO profile with gated depth |
| Should MI Free see this? | Show more than public; full chart depth and actions are MI Pro |
| Should the UI call it sales history? | Use "Federal Award History" with "obligated dollars" helper text |
| Should live USAspending fetch be in MVP? | No, use cache first; add backfill after UX is proven |
| Should we harden `/api/contract-intel/competitor` now? | Yes, before reusing it for paid MI workflows |
| Should charts appear in search results directly? | No, use drawer lazy-load so search stays fast |
| Should contractor pages be generated for every contractor? | Start with strongest data coverage pages, then expand |

---

## Review Notes

This feature is worth building, but only if it is positioned as a decision tool, not a decorative chart.

The winning version is:

> "Show me who this contractor sells to, whether they are growing, and what I should do next."

The wrong version is:

> "Show a pretty revenue chart."

For MI, the chart should sit inside the contractor workflow and connect directly to teaming, competitor tracking, and pipeline actions.
