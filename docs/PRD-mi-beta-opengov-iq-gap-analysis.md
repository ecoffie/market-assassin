# PRD: MI Beta + OpenGov IQ Intelligence Layer

Date: 2026-05-12
**Status:** ✅ Phase 4B Complete - Production-Ready (May 12, 2026)
Related TODO: `docs/TODO-mi-beta-opengov-iq-database-buildout.md`

## Implementation Status

### Completed (May 12, 2026)

**Phase 1-3: Core Features**
- ✅ Relationships panel with 4 tabs (Find Buyers, OSBP Contacts, Partners, My Network)
- ✅ Save to My Network action
- ✅ Attach contact/partner to pursuit
- ✅ Market Research as answer-first market map (no setup form)
- ✅ Pursuit detail drawer with notes, next action, attached contacts
- ✅ Market Focus saved filter sets
- ✅ Request this forecast workflow + admin queue
- ✅ Review Fit with Track in Pipeline action

**Phase 4B: Production-Ready**
- ✅ Removed all customer-facing beta language (BETA badges, "Testing Environment")
- ✅ Finalized navigation labels (Today's Intel, Source Feed, Settings, etc.)
- ✅ Free/Pro/Teams feature gates confirmed
- ✅ Auth flows (setup-account, forgot-password, reset-password) route to MI experience
- ✅ Rollback strategy documented (/briefings remains as fallback)

### Pending (End-of-May Launch)
- [ ] Choose final route name (`/mi-beta` → `/mi` or `/dashboard`)
- [ ] Update email links to point to new MI experience
- [ ] Redirect paid users from `/briefings` to new MI by default
- [ ] Teams workspace features (Phase 5+)

## Summary

Market Intelligence beta should be built as the final customer-facing product, not as a temporary prototype.

The goal is to complete MI beta as a release candidate and then switch it into the actual live Market Intelligence tool by the end of May 2026. The beta URL and implementation should therefore carry the full production feature set, production data model, and production UX decisions.

Market Intelligence should use the existing OpenGov IQ database and codebase as an enrichment reference, not as the product foundation.

The old OpenGov IQ product had useful foundations:

- federal buyer/contact database
- saved contacts and CRM behavior
- team workspaces and access roles
- shared pipeline, tasks, comments, calendar, and activity
- saved searches and forecast request workflows

MI beta should reuse the data model and product lessons, but not copy the old interface. The new product should stay simple: saved profile first, one clear next action, advanced controls only when users choose to explore.

## Product Decision

MI beta is the production candidate.

Every feature added to beta should be designed as something customers can use in the live Market Intelligence product.

Use MI's existing SAM cache, user profile, and pipeline data as the product foundation.

Use OpenGov IQ only where it adds enrichment MI does not already own: federal contacts, entity/vendor details, IDIQ vehicle details, and historical spend references.

Build MI-specific product tables and UI flows on top of it.

Do not force users to re-enter company/profile inputs on every tab. MI should default to the saved profile and make exploration optional.

The beta-to-live transition should require configuration, routing, and naming changes, not a rewrite.

## Goals

- Complete the MI beta as the final customer-facing product experience.
- Make the beta safe to promote to the live Market Intelligence tool by the end of May 2026.
- Make MI Pro feel like a relationship intelligence system for one user.
- Make MI for Teams feel like a shared execution system for a company.
- Turn useful OpenGov IQ enrichment data and workflows into a simpler MI experience without depending on the old system.
- Add government buyers, OSBP contacts, primes, subs, and saved contacts into one clear `Relationships` area.
- Connect relationships to pursuits so users can move from intelligence to action.
- Preserve the ability to search broader datasets with `View all`, `Clear filters`, and `Change filters`.

## End-Of-May Launch Scope

The end-of-May launch should focus on the minimum feature set needed for customers to use MI as the live product without feeling like they are in a test environment.

### Must Ship

- production-ready MI shell and navigation
- saved profile defaults across Today’s Intel, Market Research, Upcoming Buys, Expiring Contracts, Contractors, and My Pursuits
- clear Free, Pro, and Teams feature gates
- Today’s Intel with expandable cards and Track action
- Market Research rebuilt around a simple market map, not a setup form
- Upcoming Buys with profile defaults, View All/Clear Filters, and Track action
- Expiring Contracts with profile defaults, full database count, View All/Clear Filters, and Track action
- Contractors database with profile-aware defaults and broad search
- Relationships for Pro:
  - Find Buyers
  - OSBP Contacts
  - Partners
  - My Network
- Save to My Network
- Attach contact or partner to pursuit
- My Pursuits board/list with enough detail to understand saved opportunities
- password reset, setup-account, and login flows returning users to the new MI experience
- production route promotion plan

### Should Ship If Time Allows

- Market Focus saved filter sets
- Request this forecast
- pursuit detail drawer with activity log
- contact interaction log
- basic admin/internal queue for forecast requests

### Can Ship After Launch

- full Teams workspace object
- shared contacts
- shared pipeline ownership
- comments on pursuits
- task assignment
- teammate avatars
- full calendar integration
- full email client
- full automation builder

## Non-Goals

- Do not rebuild the full OpenGov IQ app inside MI.
- Do not add a full email client in the first pass.
- Do not add a full automation builder in the first pass.
- Do not make Market Research a long setup form.
- Do not make team workspaces part of Pro; that belongs in MI for Teams.
- Do not build disposable beta-only interfaces that must be replaced before launch.

## Launch Strategy

MI beta should become the live product through a controlled promotion.

Current state:

- `mi.govcongiants.com/mi-beta` is the active release-candidate workspace.
- Existing production pages such as `/briefings` remain available while beta is completed.

Target state by end of May 2026:

- the beta implementation becomes the primary Market Intelligence product
- customers land in the new MI experience by default
- legacy production pages either redirect into the new product or remain available only as fallback/admin references
- feature gates distinguish Free, Pro, and Teams

Promotion requirement:

The final switch should be possible with routing/config changes:

- promote `/mi-beta` experience to the primary Market Intelligence route
- update nav links and email links to point to the final route
- preserve auth, reset-password, saved profile, and pipeline data
- keep old routes available during transition if needed

Do not wait until after beta to design production behavior. Build production behavior now.

## Target Packages

### Market Intelligence Pro

Pro is for the individual operator who wants better targeting, better intelligence, and better relationship discovery.

Pro includes:

- saved profile across all tabs
- Today’s Intel
- Source Feed
- Market Research
- Upcoming Buys
- Expiring Contracts
- Contractors
- Relationships
- My Pursuits as a personal pipeline
- Market Focus saved filter sets
- Request-this-forecast workflow

Pro answers:

> Who should I know, what should I pursue, and what should I do next?

### Market Intelligence for Teams

Teams is for companies that need shared execution across people.

Teams includes everything in Pro, plus:

- first-class team workspace
- seats and roles
- shared pipeline
- shared contacts
- shared saved market profile
- shared activity feed
- assigned next actions
- comments on pursuits
- team-level settings and admin controls

Teams answers:

> How does our company work this market together?

### Packaging Rule

Pro can store and organize relationships for one user.

Teams can share, assign, govern, and collaborate on those relationships across multiple users.

## Core User Stories

### Pro User

As a Pro user, I want MI to use my saved profile so I do not need to enter NAICS, PSC, agencies, location, and company information repeatedly.

As a Pro user, I want to find government buyers and OSBP contacts tied to my market so I know who to contact.

As a Pro user, I want to save contacts into My Network so I can return to them later.

As a Pro user, I want to attach a buyer or teaming partner to a pursuit so I can connect relationships to opportunities.

As a Pro user, I want to save a different market view as a Market Focus so I can explore without losing my default profile.

As a Pro user, I want to request missing forecast data so MI can help me when the database does not have the answer yet.

### Teams User

As a Teams user, I want my company to share contacts and pursuits so we are not working in separate silos.

As a team owner, I want to invite teammates and assign roles so I can control access.

As a team member, I want to see who owns each pursuit and what action is due next.

As a team member, I want comments and activity history on pursuits so everyone knows what happened.

## Existing OpenGov IQ Assets To Reuse

### Confirmed BigQuery Sources

OpenGov IQ uses BigQuery for enrichment data we can reference or selectively import:

- Project ID: `fresh-ward-455220-j0`
- Dataset ID: `samgovcons`
- Federal contacts: `AllSamContacts`
- Entity information: `SAMEntities`
- IDIQ vehicles: `IDIQ_details`
- Research data: `Spenddata_optimized`

OpenGov IQ also has a `SAMOpps` table, but MI already owns active opportunity ingestion through the existing SAM cache. `SAMOpps` is not a launch dependency and should not replace the MI opportunity pipeline.

The MI Relationships API uses the OpenGov IQ contacts in this order:

1. Imported Supabase copy: `opengov_iq_contacts`, loaded from the Base44 `AllSamContacts` CSV export.
2. Live BigQuery: `fresh-ward-455220-j0.samgovcons.AllSamContacts`, when service-account credentials are available in production.
3. Existing MI SAM cache fallback, when neither OpenGov IQ source returns contacts.

The Base44 `AllSamContacts` export has been confirmed working at 50,000 rows. The import script is `scripts/import-opengov-iq-contacts.js`.

Entity and IDIQ enrichment exports are staged separately:

- `SAMEntities` imports into `opengov_iq_entities`.
- `IDIQ_details` imports into `opengov_iq_idiq_vehicles`.
- Import script: `scripts/import-opengov-iq-enrichment.js`.
- Runtime lookup endpoint: `/api/mi-beta/enrichment`.

### Existing Recompete vs. OpenGov IDIQ

MI already has an expiring-contract/recompete dataset in `public/contracts-data.js` and the `recompete_opportunities` table.

That dataset includes 9,450 expiring awards with fields such as award ID, agency, office, recipient, NAICS, total value, start date, expiration date, and state.

The OpenGov IQ `IDIQ_details` export is different. It includes 50,000 IDV/vehicle-oriented records with description, award ID, NAICS, agency, recipient UEI/name, AI-generated text, and cleaned vehicle.

Initial local comparison found no exact `Award ID` overlap between `public/contracts-data.js` and `IDIQ_details_export.csv`. Therefore:

- do not merge OpenGov `IDIQ_details` into recompete as if it is the same dataset
- use the existing MI recompete dataset for expiring contracts
- use OpenGov `IDIQ_details` as vehicle/holder enrichment for Market Research, Contractors, and Relationships
- later, link records opportunistically by recipient name, UEI, agency, and NAICS rather than by exact award ID

Follow-up audit script:

- `scripts/audit-opengov-idiq-quality.js`

Latest local audit of `IDIQ_details_export.csv`:

- 50,000 rows
- 30,400 unique award IDs
- 9,919 award IDs appear more than once
- 49,990 rows use the `CONT_IDV_*` identifier shape, which appears to match USAspending `generated_unique_award_id`
- 0 exact award-ID overlap with the current MI recompete file
- `AwardID`, agency, recipient UEI, recipient name, and description are effectively complete
- `CleanedVehicle` is 0% populated
- 25.3% of `ai_generated_text` is questionable or low-confidence, including some obvious prompt contamination such as "Okay, I understand..."

Decision: do not import or rely on OpenGov IQ IDIQ data as trusted product data yet. It can be used only as provisional enrichment after spot checks against USAspending. If USAspending validation shows material mismatch, stale data, or weak vehicle labels, rebuild the IDV/IDIQ enrichment layer directly from USAspending instead of importing the OpenGov file.

USAspending validation script:

- `scripts/validate-opengov-idiq-against-usaspending.js`

Latest sample validation:

- 25 sampled OpenGov IDIQ rows checked against `https://api.usaspending.gov/api/v2/awards/{award_id}/`
- 25/25 award IDs found
- 25/25 matched recipient name
- 25/25 matched recipient UEI
- 25/25 matched agency
- 25/25 matched NAICS

Conclusion: OpenGov IQ IDIQ award IDs and core award facts appear usable as enrichment keys. The enrichment still should not become the MI foundation. The weak field remains vehicle naming/interpretation because `CleanedVehicle` is blank and a meaningful share of `ai_generated_text` is low-confidence or prompt-contaminated. For production, prefer either:

1. import only the verified factual fields from OpenGov IQ and generate our own vehicle labels, or
2. rebuild the IDV/IDIQ enrichment directly from USAspending using the same `CONT_IDV_*` identifiers.

### Federal Contacts

Relevant files:

- `opn-g-iq-a31ed6b6/src/pages/Contacts.jsx`
- `opn-g-iq-a31ed6b6/src/components/contacts/FederalContactsList.jsx`
- `opn-g-iq-a31ed6b6/src/components/contacts/FederalContactCard.jsx`
- `opn-g-iq-a31ed6b6/src/components/contacts/FederalContactDetailModal.jsx`
- `opn-g-iq-a31ed6b6/base44/functions/getFederalContacts/entry.ts`
- `opn-g-iq-a31ed6b6/base44/functions/getFederalContactsFilterValues/entry.ts`

Use for:

- government buyer search
- OSBP contact search
- agency/office/sub-tier filters
- save-to-network behavior
- contact detail modal

### Workspace And Team Access

Relevant files:

- `opn-g-iq-a31ed6b6/src/components/workspace/WorkspaceContext.jsx`
- `opn-g-iq-a31ed6b6/src/components/workspace/UnifiedUserManagement.jsx`
- `opn-g-iq-a31ed6b6/base44/functions/manageWorkspaceUser/entry.ts`

Use for:

- Teams workspace model
- role logic
- invite behavior
- shared workspace selection

### Pipeline Execution

Relevant files:

- `opn-g-iq-a31ed6b6/src/pages/Pipeline.jsx`
- `opn-g-iq-a31ed6b6/src/components/opportunities/OpportunityColumn.jsx`
- `opn-g-iq-a31ed6b6/src/components/opportunities/TaskAssignmentModal.jsx`
- `opn-g-iq-a31ed6b6/src/components/opportunities/OpportunityCommentsModal.jsx`

Use for:

- pursuit detail drawer
- task assignment for Teams
- comments for Teams
- owner/assignee display
- stage movement patterns

### Saved Searches

Relevant files:

- `opn-g-iq-a31ed6b6/src/pages/Opportunities.jsx`
- `opn-g-iq-a31ed6b6/src/components/opportunities/SavedSearchesList.jsx`
- `opn-g-iq-a31ed6b6/src/components/opportunities/SaveSearchDialog.jsx`

Use for:

- `Market Focus`
- saved exploration filters
- editable filter sets

### Forecast Requests

Relevant file:

- `opn-g-iq-a31ed6b6/src/pages/ProjectForecasts.jsx`

Use for:

- `Request this forecast`
- internal fulfillment queue
- user notification when forecast is ready

## MI Beta Navigation

### Pro Navigation

1. `Today’s Intel`
   - best profile-matched briefing cards
   - expandable summaries
   - track to My Pursuits

2. `Source Feed`
   - raw SAM alerts and source records
   - useful for users who want the underlying feed

3. `Market Research`
   - answer-first market map
   - buyers, budgets, competition, upcoming buys, partners
   - no setup form unless profile is missing

4. `Upcoming Buys`
   - future procurement signals
   - defaults to saved profile
   - `View all` and `Change filters`
   - track to My Pursuits

5. `Expiring Contracts`
   - recompete opportunities
   - defaults to saved profile
   - shows profile matches and full database totals
   - track to My Pursuits

6. `Contractors`
   - prime/sub/competitor database
   - contact and sales history

7. `Relationships`
   - Find Buyers
   - OSBP Contacts
   - Partners
   - My Network

8. `My Pursuits`
   - personal pipeline
   - stage movement
   - next action
   - attached contacts and partners

9. `Settings`
   - company profile
   - saved market profile
   - notification preferences
   - security

### Teams Additions

- `Team`
- workspace switcher
- shared activity
- assigned work
- team settings

## Feature Requirements

### Saved Profile Defaults

Every MI module should start from the user's saved company/market profile.

Required behavior:

- read profile from the canonical MI settings/profile source
- fallback to alert/briefing preferences when MI settings are incomplete
- show `Using saved profile` when filters are profile-driven
- show which profile values are being used, such as NAICS, PSC, agencies, states, and business type
- allow `Change filters` without overwriting the saved profile
- allow `Use saved profile` to reset an exploratory view
- avoid setup forms unless the saved profile has no useful market inputs

Acceptance criteria:

- a user with saved settings can open every major tab without entering inputs
- a user can clear filters and see broader results
- a user can return to saved-profile results in one click
- profile-match counts and full-database totals are not confused

### Today’s Intel

Today’s Intel should be the paid user’s default intelligence home.

Required behavior:

- show current profile-matched briefings
- cards are expandable
- each opportunity card has summary/overview text
- each trackable item has a clear Track/Add to My Pursuits action
- dashboard-style stats are secondary to actionable intelligence

Acceptance criteria:

- user can understand why an item matters without opening SAM.gov
- user can track an item into My Pursuits
- user can search/filter within the briefing feed

### Market Research

Market Research should be a simple market map, not the old Market Assassin setup workflow.

Required behavior:

- start from saved profile
- show the best target agencies/offices first
- show buyers/contacts where available
- show spending/budget/contractor context
- show upcoming buys and expiring contracts as related signals
- hide advanced filters until user chooses to explore
- provide one clear primary action: `Build My Market Map` when data has not yet loaded

Acceptance criteria:

- no required setup form appears for users with saved profile data
- user sees results first
- user can identify target agencies, buyers, and next opportunities from one page

### Relationships

Relationships should be a Pro feature.

Tabs:

- `Find Buyers`
- `OSBP Contacts`
- `Partners`
- `My Network`

Required behavior:

- default search to saved profile
- allow search by name, agency, office, title, email
- support filters for agency, office, sub-tier, state where available
- show contact cards with name, title, agency/office, email/phone if available, related opportunity/source
- save contact to My Network
- mark already-saved contacts
- attach contact to a pursuit

### My Network

Required behavior:

- show saved buyers, OSBP contacts, primes, subs, partners, and internal contacts
- search saved contacts
- filter by contact type
- open detail drawer
- add notes
- log interaction
- attach to pursuit

### My Pursuits

Required behavior for Pro:

- board and list view
- `Track` from Today’s Intel, Upcoming Buys, Expiring Contracts, Grants, SBIR, and Source Feed
- stage movement via drag/drop and `Move to...`
- detail drawer
- next action
- notes
- attached contacts and partners
- profile/source metadata preserved

Required behavior for Teams:

- owner assignment
- comments
- task assignment
- team activity
- teammate avatars

Acceptance criteria:

- user can add a pursuit from any major intelligence source
- user can move a pursuit between stages
- user can see why the pursuit was saved
- user can attach a buyer or partner
- user can set a next action
- list view and board view show the same underlying data

### Market Focus

Market Focus replaces the old “Saved Search” language.

Required behavior:

- user can save current filters as a named market focus
- user can switch focus without changing default profile
- examples: `VA construction`, `DHS cyber`, `Northeast facilities`
- focus stores NAICS, PSC, agencies, states, keywords, set-asides, and source type where applicable

Acceptance criteria:

- user can save a changed filter set without overwriting their default profile
- saved focus can be reopened later
- focus names are plain English
- user can delete or update a focus

### Request This Forecast

Required behavior:

- if forecast/office data is missing, show `Request this forecast`
- collect agency/office and optional note
- record request in admin/internal queue
- notify user when fulfilled

Acceptance criteria:

- missing forecast data creates a request path
- request captures enough information for internal fulfillment
- user receives confirmation
- admin/internal team can see pending requests

### Teams Workspace

Teams feature only.

Required behavior:

- workspace object exists independently from email domain
- owner/admin/member/viewer roles
- invite teammate by email
- single-workspace users do not see unnecessary workspace switching
- multi-workspace users can switch accounts
- workspace owns shared contacts, pipeline, settings, and activity

Acceptance criteria:

- single-user Pro experience is not complicated by Teams concepts
- Teams user can invite a teammate
- invited user lands in the right workspace
- shared pipeline and shared contacts are visible to workspace members
- owner/admin permissions prevent unmanaged access changes

## Data Architecture

### Source Intelligence Layer

MI's existing SAM cache is the active opportunity foundation.

OpenGov IQ is an enrichment reference and temporary seed source only.

OpenGov IQ datasets worth reusing or rebuilding:

- federal contacts
- agencies/offices/sub-tiers
- contractors/vendors
- forecasts/upcoming buys
- IDIQ/vehicle details
- historical spend references
- old saved searches
- old workspace/users
- old contacts/CRM
- old conversations/interactions
- old tasks/calendar events

Active opportunities should continue to come from MI's existing SAM ingestion, not OpenGov IQ `SAMOpps`.

Warehouse data should stay source-aligned and retain original fields. App-facing data should be curated into smaller Supabase tables.

### MI Product Layer

Add MI-specific tables on top of the raw data.

#### `mi_beta_contacts`

Saved contacts and relationship records.

Fields:

- `id`
- `workspace_id`
- `user_email`
- `contact_type`
- `full_name`
- `title`
- `email`
- `phone`
- `organization`
- `agency`
- `office`
- `sub_tier`
- `source`
- `source_record_id`
- `notes`
- `owner_email`
- `created_by`
- `created_at`
- `updated_at`

#### `mi_beta_market_focuses`

Saved exploration filters.

Fields:

- `id`
- `workspace_id`
- `user_email`
- `name`
- `description`
- `filters`
- `is_default`
- `created_at`
- `updated_at`

#### `mi_beta_contact_opportunity_links`

Links contacts to pursuits/opportunities.

Fields:

- `id`
- `workspace_id`
- `contact_id`
- `pipeline_id`
- `relationship_role`
- `notes`
- `created_by`
- `created_at`

#### `mi_beta_pursuit_activity`

Notes, interactions, movement history, and next-action history.

Fields:

- `id`
- `workspace_id`
- `pipeline_id`
- `actor_email`
- `activity_type`
- `summary`
- `metadata`
- `created_at`

#### `mi_beta_workspaces`

Teams feature.

Fields:

- `id`
- `name`
- `owner_email`
- `billing_email`
- `plan_tier`
- `max_seats`
- `default_profile_id`
- `created_at`
- `updated_at`

## UX Principles

- Saved profile first.
- One clear primary action per card.
- Advanced filters hidden behind `Change filters`.
- Use `View all` or `Clear filters` for broader exploration.
- Counts must distinguish profile matches from full database totals.
- No setup forms when profile data already exists.
- Pro equals individual relationship intelligence.
- Teams equals shared company execution.
- Missing data should create a useful request workflow, not a dead end.

## Production Readiness Criteria

MI beta is ready to become the live product when all of the following are true:

### Access And Authentication

- existing paid users can log in
- password reset links return to the new MI experience
- setup-account links return to the new MI experience
- free, Pro, Team, and Enterprise tiers see the correct navigation
- internal/admin users retain access

### Data And Profile

- saved profile loads consistently
- alert/briefing preferences are used as fallback profile data
- profile defaults work across all major tabs
- profile-match counts and full-database totals are clearly labeled
- old OpenGov IQ database source is audited and mapped

### Core Product

- Today’s Intel is usable as the default paid home
- Market Research is answer-first and not form-first
- Upcoming Buys and Expiring Contracts support broader exploration
- Relationships exists for Pro
- My Pursuits can accept tracked items from all major sources
- users can attach relationships to pursuits

### Launch Operations

- final route is chosen
- route promotion plan is documented
- legacy routes are redirected or preserved as fallback
- email links point to the new MI experience
- rollback path exists for launch week

## Success Metrics

Activation:

- user has saved profile
- user views Today’s Intel or Market Research
- user tracks at least one pursuit

Pro value:

- user saves at least one contact
- user attaches a contact to a pursuit
- user creates at least one Market Focus
- user uses `View all` or `Change filters` without getting lost

Teams value:

- owner invites teammate
- team has shared contacts
- team has shared pursuits
- pursuit has owner or assigned next action

## Risks And Mitigations

### Risk: Beta UI Keeps Changing And Feels Inconsistent

Mitigation:

- freeze final navigation labels before launch
- treat the PRD as the product source of truth
- avoid adding new tabs unless they support the core workflow

### Risk: Old OpenGov IQ Data Is Messy

Mitigation:

- keep old data as raw intelligence
- normalize into MI product tables
- preserve source metadata
- show confidence/source date where helpful

### Risk: Pro And Teams Value Blur Together

Mitigation:

- Pro gets personal relationship intelligence
- Teams gets shared company execution
- do not expose shared workspace complexity to Pro users

### Risk: Users Do Not Understand Counts

Mitigation:

- label profile matches separately from full database totals
- provide `View all` and `Use saved profile`
- avoid showing a filtered count without context

### Risk: Launch Breaks Existing Links

Mitigation:

- update email redirects before launch
- preserve old routes as fallback
- test reset/login/setup flows before switching default route

## Rollout Plan

### Phase 1: Database Audit And Production Data Foundation

- locate canonical OpenGov IQ database
- confirm provider: Supabase, BigQuery, CSV, or other
- export schema/table list
- count records per table
- identify freshness and source dates
- map old fields to MI product model
- decide which existing tables power launch
- create missing MI product tables

### Phase 2: Pro Relationships MVP

- add MI contacts/product tables
- build federal contacts API
- build Relationships panel
- add Save to My Network
- add Attach to Pursuit
- show relationship context in Market Research

### Phase 3: Production Navigation And Profile Defaults

- finalize live nav labels
- remove beta-only language from customer-facing UI where appropriate
- keep internal release badges only if needed
- ensure every module defaults to saved profile
- add profile-match and full-database count language everywhere it matters
- ensure Free, Pro, and Teams feature gates are explicit

### Phase 4: Market Focus + Forecast Requests

- add Market Focus table and UI
- allow saving filter sets
- add Request this forecast workflow
- create internal/admin request list

### Phase 5: Pursuit Detail Drawer

- add detail drawer to My Pursuits
- show notes, next action, stage, source metadata
- show attached contacts and partners
- add activity log

### Phase 6: Teams Workspace

- add `mi_beta_workspaces`
- upgrade team member model
- shared contacts
- shared pipeline
- owner/admin/member/viewer roles
- assigned next actions
- comments

### Phase 7: Beta-To-Live Promotion

- choose final primary route for Market Intelligence
- update marketing/store/admin links
- update password reset and setup email redirects
- update app nav links
- verify paid and free access gates
- verify existing users can log in
- verify saved profile, relationships, pursuits, and pipeline records survive route change
- keep rollback route available during first launch week

## End-Of-May Release Checklist

- [x] Relationships exists for Pro.
- [x] Market Research no longer uses the old setup-form-first flow.
- [x] Upcoming Buys and Expiring Contracts default to saved profile and support View All/Clear Filters.
- [x] Every trackable item has a clear Track/Add to My Pursuits action.
- [x] My Pursuits has enough detail for customers to understand what they saved and what to do next.
- [x] Free, Pro, and Teams navigation differences are clear.
- [x] Password reset and setup emails return users to the new MI experience.
- [x] Existing OpenGov IQ database has been audited and mapped.
- [ ] Production route promotion plan is ready (decision: final route name).
- [x] Rollback path is documented.

## Open Questions

- [x] What is the current canonical OpenGov IQ database source?
  - BigQuery project `fresh-ward-455220-j0`, dataset `samgovcons`
- [x] Do federal contacts currently live in BigQuery?
  - Yes, `AllSamContacts` table; also imported to Supabase `opengov_iq_contacts`
- [ ] Do we have a refresh process for federal contacts?
- [x] Do forecasts live in a database, uploaded files, or both?
  - Database: `agency_forecasts` table with 7,764 records from 11 agencies
- [x] Should `Relationships` replace `Teaming CRM` in the nav or absorb it as a tab?
  - Replaced. Pro nav shows "My Network" for relationships; Teams workspace/CRM is a later feature.
- [ ] Should saved contacts be personal in Pro and workspace-owned in Teams, or always workspace-owned with personal workspace defaults?
- [ ] What final route should replace `/mi-beta`: `/market-intelligence`, `/briefings`, or keep `/mi-beta` behind a renamed app shell until launch?
  - Decision pending. Current: `/mi-beta` works, `/briefings` is legacy fallback.
