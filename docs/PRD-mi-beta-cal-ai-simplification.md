# PRD: MI Beta Cal AI Simplification

**Status:** ✅ Complete (May 12, 2026)

## Implementation Summary

All slices completed:
- ✅ Slice 1: Naming and Hierarchy - Labels finalized (Today's Intel, Source Feed, Upcoming Buys, Expiring Contracts, My Pursuits, My Network, Settings)
- ✅ Slice 2: Paid Card Actions - Review Fit with expandable cards + Track in Pipeline
- ✅ Slice 3: Source Feed Positioning - Paid users see "Source Feed", free users see "Daily Alerts" in legacy
- ✅ Slice 4: Global Defaults - Profile defaults applied across all tabs, Clear Filters / View All available

Open Decisions resolved:
- Review Fit opens inline expandable cards (not modal or drawer)
- Today's Intel does not auto-expand top item (user clicks to expand)
- Source Feed remains in Intelligence section as secondary to Today's Intel
- Scoring uses match signals (NAICS, set-aside, agency, deadline proximity)

## Decision

Market Intelligence beta should behave less like a collection of tools and more like an outcome workspace. The paid user should not feel like they bought access to more filters. They should feel like the product already knows their profile, finds the right opportunities, explains the fit, and tells them what to do next.

## Research Signals

- Cal AI simplified a complex tracking workflow into one obvious action: take a food photo, get calories. TechCrunch reported the app passed 15M downloads and $30M+ ARR before MyFitnessPal acquired it in 2026.
- MyFitnessPal kept Cal AI standalone because it served a different user preference: speed and ease over granular precision. That maps directly to MI: many users want the answer first, with raw SAM detail available only when needed.
- McKinsey's product-led growth research emphasizes fast time-to-value, self-serve onboarding, in-product nudges, and product usage analytics. For MI, that means saved profile data must carry across the product and every paid tab should begin with useful defaults.
- Nielsen Norman usability heuristics support this direction: reduce recall, use familiar language, maintain consistency, and remove irrelevant information because extra information competes with the user's actual task.

## Core Product Promise

Tell me which federal opportunities matter today and what to do next.

## Product Principle

Free users get alerts. Paid users get answers.

## User Segments

### Free User

The free user is evaluating the product and should understand the basic value quickly.

Primary experience:
- Daily Alerts
- Saved profile setup
- Basic SAM.gov opportunity matches
- Clear upgrade path to AI Briefings and advanced intelligence

### Paid User

The paid user has already paid for leverage, prioritization, and guidance.

Primary experience:
- Today's Intel
- Top opportunities by fit and urgency
- AI summaries and recommended next actions
- Pipeline actions
- Optional raw source feed for validation and search

## Information Architecture

### Paid Navigation

- Today's Intel
- Source Feed
- Market Research
- Upcoming Buys
- Expiring Contracts
- Contractors
- My Pursuits
- Teaming CRM
- Team Access
- Proposal Assist
- Federal Grants
- Settings

### Free Navigation

- Daily Alerts
- Market Research
- Settings
- Locked paid modules with simple upgrade CTA

## Key UX Requirements

1. Paid users land on Today's Intel, not the raw source feed.
2. Paid users should never see the product title "Free Daily Alerts."
3. Saved profile settings should apply globally across briefings, source feed, forecasts, recompetes, contractors, and market research.
4. Each opportunity card should be collapsed by default.
5. Collapsed cards should show title, agency, due date, fit signal, and one recommendation.
6. Expanded cards should show overview, why it matches, source metadata, and actions.
7. The primary action on a paid opportunity card should be Review Fit.
8. Secondary actions should be Track, View SAM.gov, and Share.
9. Raw databases should support "Use Saved Profile" and "View All" or "Clear Filters."
10. Advanced filters should be available but not required for first value.

## MVP Build Scope

### Slice 1: Naming and Hierarchy

- Rename paid AI Briefings nav label to Today's Intel.
- Rename paid Daily Alerts nav label to Source Feed.
- Rename paid Forecasts to Upcoming Buys.
- Rename paid Recompetes to Expiring Contracts.
- Rename paid Pipeline Tracker to My Pursuits.
- Keep free labels simple and explicit.

### Slice 2: Paid Card Actions

- Add Review Fit as the primary expanded-card action.
- Keep View SAM.gov as a secondary source action.
- Preserve Track/Save actions where data supports it.

### Slice 3: Source Feed Positioning

- For paid users, describe Source Feed as the raw SAM.gov source layer behind AI Briefings.
- For free users, keep Daily Alerts as the free product.

### Slice 4: Global Defaults

- Ensure saved profile defaults are applied automatically across all data-heavy tabs.
- Make Clear Filters / View All available on tabs where users may want broader exploration.

## Non-Goals

- Do not remove SAM/source data.
- Do not hide advanced filters from power users.
- Do not create a marketing landing page inside the paid app.
- Do not require paid users to repeat onboarding inputs inside individual tabs.

## Success Metrics

- Paid users reach a meaningful opportunity within one click after login.
- Fewer support questions about why profile data must be re-entered.
- Higher use of Track/Review actions from Today's Intel.
- Lower navigation to raw Source Feed as the first paid action.
- Increased free-to-paid conversion from Daily Alerts.

## Open Decisions (Resolved)

- ✅ Review Fit opens inline expandable cards showing description, category, signals, and action URL
- ✅ Today's Intel does not auto-expand - users click to expand individual cards
- ✅ Source Feed remains in Intelligence section as secondary item after Today's Intel
- ✅ Top opportunities ordered by match signals (NAICS match, set-aside, agency, deadline proximity)

