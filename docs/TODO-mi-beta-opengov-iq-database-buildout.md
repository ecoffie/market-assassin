# TODO: MI Beta Database-First Buildout

Date: 2026-05-12

Reference PRD:

- `docs/PRD-mi-beta-opengov-iq-gap-analysis.md`

## Decision

Use MI's existing SAM cache, profile, and pipeline data as the product foundation.

Use the existing OpenGov IQ database as an enrichment reference and temporary seed source only. Do not make the old system a launch dependency.

> **⚠️ Superseded (2026-06-04):** OpenGov IQ BigQuery access (`fresh-ward-455220-j0.samgovcons`) is LOST — Base44 CSV only, treated as dead. Entity registry is being re-sourced from the **SAM.gov bulk Entity Extract** (official, free, daily) into a `sam_entities` table. See `tasks/TODO-contractor-database-expansion.md` for the re-source plan + the government-buyer "vs. SBS" differentiation. Note: DSBS was retired 2025-07-09 and replaced by **SBS** (`search.certifications.sba.gov`); SBS runs on the same SAM data, so our moat is the award-history/incumbency/cap-statement join, not the registry itself.

MI beta is the release candidate for the live Market Intelligence product. Build every feature as production-bound, with the goal of switching beta into the actual customer-facing tool by the end of May 2026.

## Core Principle

Warehouse/source data stays source-aligned.

MI turns source data into simple actions:

- Who should I know?
- What should I pursue?
- What changed?
- What do I do next?

## Phase 1: Database Audit

- [x] Locate the active OpenGov IQ database source.
- [x] Confirm whether the data lives in Supabase, BigQuery, CSV exports, or another provider.
  - BigQuery project: `fresh-ward-455220-j0`
  - Dataset: `samgovcons`
  - Federal contacts table: `AllSamContacts`
  - Entity table: `SAMEntities`
  - IDIQ table: `IDIQ_details`
  - Research table: `Spenddata_optimized`
  - OpenGov `SAMOpps` exists but is not needed because MI already has active SAM opportunities.
- [x] Compare existing recompete/expiring-contract source against OpenGov `IDIQ_details`.
  - Existing MI file: `public/contracts-data.js`, 9,450 expiring awards.
  - OpenGov export: `IDIQ_details_export.csv`, 50,000 IDV/vehicle records.
  - Exact `Award ID` overlap: 0.
  - Decision: keep recompete as the expiring-award source; use `IDIQ_details` only as vehicle/holder enrichment.
- [x] Audit OpenGov `IDIQ_details` quality before importing.
  - Script: `scripts/audit-opengov-idiq-quality.js`.
  - 50,000 rows, 30,400 unique award IDs, 9,919 duplicate award IDs.
  - 49,990 rows use `CONT_IDV_*`, likely USAspending `generated_unique_award_id`.
  - Core fields are mostly complete, but `CleanedVehicle` is 0% populated.
  - 25.3% of `ai_generated_text` is questionable or low-confidence, including prompt-contaminated rows.
  - Decision: do not trust/import as product data yet; validate against USAspending or rebuild directly from USAspending.
- [x] Spot-check sampled OpenGov IDIQ award IDs against USAspending.
  - Script: `scripts/validate-opengov-idiq-against-usaspending.js`.
  - 25/25 sampled award IDs found in USAspending.
  - 25/25 matched recipient name, recipient UEI, agency, and NAICS.
  - Decision: OpenGov IDIQ core facts are usable as enrichment keys.
  - Caveat: vehicle/IDV label quality is still weak because `CleanedVehicle` is blank and `ai_generated_text` has low-confidence rows.
- [ ] Decide whether to import verified IDIQ factual fields or rebuild the IDV enrichment table directly from USAspending.
- [ ] Export schema/table list.
- [ ] Identify tables for:
  - [x] federal contacts
  - [x] agencies/offices/sub-tiers
  - [x] contractors/vendors
  - [x] opportunities
    - Use existing MI SAM cache, not OpenGov `SAMOpps`.
  - [ ] forecasts/upcoming buys
  - [ ] expiring contracts/recompetes
  - [ ] saved searches
  - [ ] workspace/users
  - [ ] contacts/CRM
  - [ ] conversations/interactions
  - [ ] tasks/calendar events
- [ ] Count records per table.
- [ ] Identify source dates and freshness.
- [ ] Identify duplicate rules for contacts, contractors, and opportunities.
- [ ] Identify missing key fields:
  - [ ] email
  - [ ] phone
  - [ ] agency
  - [ ] office
  - [ ] NAICS
  - [ ] PSC
  - [ ] source URL
  - [ ] updated date

## Phase 2: MI Data Mapping

- [x] Map old federal contacts fields to MI `Relationships`.
  - Endpoint uses imported `opengov_iq_contacts` first, then `fresh-ward-455220-j0.samgovcons.AllSamContacts` via BigQuery REST when service-account env vars are available, then SAM cache fallback.
  - Fallback remains SAM cache contacts plus agency OSBP directory.
- [ ] Map old contractor/vendor fields to MI `Contractors`.
- [ ] Map old forecasts to MI `Upcoming Buys`.
- [ ] Map old expiring contracts/recompetes to MI `Expiring Contracts`.
- [ ] Map old opportunities to MI `Source Feed` and `Today’s Intel`.
- [x] Map old saved searches to MI `Market Focus`.
  - Added user/workspace-level saved filter slices.
  - Market Research can save and reapply named focuses without overwriting the saved profile.
- [ ] Map old contacts/CRM to MI `My Network`.
- [ ] Map old pipeline items to MI `My Pursuits`.
- [ ] Decide which old fields become hidden metadata versus visible UI.

## Phase 3: Product Tables To Add

These are MI-specific tables layered on top of the existing database.

- [x] `mi_beta_contacts`
  - saved government buyers, OSBP contacts, primes, subs, partners, internal contacts
- [x] `mi_beta_market_focuses`
  - saved filter/profile slices with plain-English names
- [x] `mi_beta_contact_opportunity_links`
  - attaches contacts/partners to pursuits
- [x] `mi_beta_pursuit_activity`
  - notes, calls, emails, status changes, next actions
- [x] `opengov_iq_contacts`
  - local Supabase copy of exported Base44/OpenGov IQ `AllSamContacts`
- [x] `opengov_iq_entities`
  - curated Supabase enrichment copy of exported OpenGov IQ `SAMEntities`
- [x] `opengov_iq_idiq_vehicles`
  - curated Supabase enrichment copy of exported OpenGov IQ `IDIQ_details`
- [ ] `mi_beta_data_sources`
  - tracks where each dataset came from and when it was refreshed

Teams phase:

- [ ] `mi_beta_workspaces`
- [ ] workspace-level saved profile
- [ ] shared contacts
- [ ] shared pipeline ownership
- [ ] member roles and seat limits

## Phase 4: Pro Features

- [x] Build `Relationships` panel.
- [x] Add `Find Buyers`.
  - Uses imported OpenGov IQ `AllSamContacts` when loaded, live BigQuery when credentials are configured, and SAM cached contacts as fallback.
- [x] Add enrichment import scaffolding for `SAMEntities` and `IDIQ_details`.
- [x] Add authenticated MI enrichment API for entity and vehicle lookup.
- [x] Add `OSBP Contacts`.
  - Uses the existing MI agency/command OSBP directory.
- [x] Add `Saved Contacts` / `My Network`.
- [x] Add `Partners`.
- [x] Add `Save to My Network`.
- [x] Attach contacts to `My Pursuits`.
- [ ] Add contact context to `Market Research`.
- [x] Add `Market Focus` saved filter sets.
  - API: `/api/mi-beta/market-focus`.
  - UI: Market Research saved profile/focus switcher and save-current-focus flow.
- [x] Add `Request this forecast` when forecast data is missing.
  - API: `/api/mi-beta/forecast-request` (user submissions).
  - Admin API: `/api/admin/forecast-requests` (internal queue management).
  - UI: Request modal in ForecastsPanel, triggered when search returns few/no results.

## Phase 4B: Production-Ready Beta

- [x] Remove or minimize customer-facing beta-only language before launch.
  - Removed BETA badges from sidebar header, top bar, and login page.
  - Updated "Back to Production" to "Legacy View".
  - Updated "Beta team preview" to "Team Preview".
  - Updated 2FA description to remove beta reference.
  - Simplified "Unified Settings" to "Settings".
- [x] Confirm final navigation labels.
  - Labels finalized: Today's Intel, Source Feed, Market Research, Upcoming Buys, Expiring Contracts, Contractors, My Pursuits, My Network, Team Access, Proposal Assist, Federal Grants, Settings.
- [x] Confirm Free, Pro, and Teams feature gates.
  - Free: Source Feed, Market Research, Settings.
  - Pro: All panels except Team Access.
  - Team/Enterprise: All panels including Team Access.
- [x] Confirm setup-account, forgot-password, and reset-password redirects use the final MI route.
  - All auth pages route to `/mi-beta` and include redirect to `mi.govcongiants.com`.
- [x] Confirm email links route users into the new MI experience.
  - Email links use `mi.govcongiants.com/briefings` (legacy dashboard).
  - Decision pending: When to update email links to `/mi-beta` or final route.
- [ ] Confirm all paid users land in the new MI shell.
  - Decision needed: When to update `/briefings` to redirect Pro users to `/mi-beta`.
  - Current: Both dashboards work independently; users can use either.
- [ ] Confirm old production pages can redirect or remain as fallback.
  - Current: `/briefings` remains as legacy dashboard, `/mi-beta` is new unified experience.
  - Decision needed: Final route name (`/mi-beta` → `/mi` or `/dashboard`?).
- [ ] Confirm rollback route if launch needs to be reversed.
  - Rollback: Simply keep `/briefings` as primary, `/mi-beta` as optional.
  - Email links still point to `/briefings`, so no email changes needed for rollback.

## Phase 5: Teams Features

- [ ] First-class workspace switcher.
- [ ] Team invites.
- [ ] Roles: owner, admin, member, viewer.
- [ ] Shared pipeline.
- [ ] Shared contacts.
- [ ] Shared activity.
- [ ] Assign next actions.
- [ ] Comments on pursuits.
- [ ] Team-level settings/profile.

## UX Rules

- [ ] Default every module to saved profile.
- [ ] Show full-database count separately from profile-match count.
- [ ] Hide advanced filters behind `Change filters`.
- [ ] Use `Clear filters` / `View all` for broader exploration.
- [ ] Avoid setup forms when profile data already exists.
- [ ] Pro equals individual relationship intelligence.
- [ ] Teams equals shared company execution.

## Open Questions

- [ ] What is the current canonical database for OpenGov IQ data?
- [x] Can Base44 export `AllSamContacts`?
  - Yes. Base44 export now returns 50,000 rows successfully as CSV.
- [x] Do federal contacts currently live in BigQuery?
  - Old OpenGov IQ code queried a configurable BigQuery table via `getFederalContacts`; the table was configured through Base44 `UIElementMapping`/`DataSource`.
- [ ] Do we have a current refresh process for contacts and forecasts?
- [ ] Are old workspace/users records worth migrating or only using as schema reference?
- [x] Should `Relationships` replace `Teaming CRM` in the nav or absorb it as a tab?
  - Replaced in Pro nav. Team workspace/CRM remains a later Teams feature.
- [ ] What final route should replace `/mi-beta` for launch?
- [ ] Which legacy pages should redirect into the final MI experience?
