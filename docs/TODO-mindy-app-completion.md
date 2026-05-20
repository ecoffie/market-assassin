# Mindy App Completion TODO

Source of truth: `getmindy.ai/app` is the active Mindy workbench. The old `/mi-beta` route is discontinued publicly and may remain as an internal implementation path until the app is stable.

Last updated: May 18, 2026.

## Current Status

- [x] `getmindy.ai/app` is the canonical user-facing Mindy app.
- [x] `/app` and `/mi-beta` share the same implementation while Mindy is being finished.
- [x] Keep legacy users on `/briefings` until the Mindy app is complete enough for migration.
- [x] Google OAuth and Microsoft/Azure OAuth are configured in Supabase and verified to reach Mindy onboarding.
- [x] OAuth signup lands on `/onboarding` so the browser can persist the Supabase session.
- [x] Onboarding and settings support multiple set-aside certifications because users may have several statuses.
- [x] Recommendation cards render in Market Research and accept feedback.
- [x] Buyer report fallback prevents Market Research from showing `0 agencies to review` when the live agency lookup returns no rows.
- [x] Agency prioritization uses small-business entry signals from simplified acquisitions, micro-purchases, and budget momentum instead of raw spend alone.
- [x] Empty Market Research report panels now fall back to live recommended-opportunity cards instead of dead `0` sections.
- [x] Money formatting has been normalized so trillion-scale values display as `$1.1T` instead of `$1057.7B`.
- [x] Production deploy for the latest Market Research fixes completed on May 18, 2026.
- [ ] Rename remaining internal `mi-beta` implementation paths once `/app` is stable and deployed.

## Pro Finish Line

Mindy Pro is in polish, QA, and migration work. The core value loop is present: profile, recommendations, feedback-aware ranking, Market Research, Today’s Intel, pipeline saves, and Proposal Prep V1.

- [ ] Browser QA the full Pro loop: sign in/OAuth, onboarding, profile/settings, Market Research refresh, recommendations, details drawer, feedback, save to pipeline, Proposal Prep, and sign out.
- [ ] Make low-confidence profile states obvious with a "complete your profile" nudge.
- [ ] Add visible ranking/downranking explanations directly on opportunity cards and details drawers.
- [ ] Add location, sub-agency/office, set-aside, and source links consistently inside all opportunity detail views.
- [ ] Make generated summaries useful; never show raw API URLs as the summary body.
- [ ] Make summary/source links clickable where URLs appear.
- [ ] Confirm every "Choose What You Need" tile either has real report data or a useful live-opportunity fallback.
- [ ] Add a clear "Open Mindy Dashboard" link to every alert/briefing email.
- [ ] Replace old MI, OH Pro, and GovCon Giants upgrade language with Mindy Free, Mindy Pro, and Mindy Teams language.
- [ ] Add the new Mindy logo to app chrome, emails, onboarding, auth, and command-center surfaces.
- [ ] Decide when legacy `/briefings` users are migrated into `/app`.

## 1. Pro Feedback Loop

- [x] Add feedback controls on paid opportunity cards.
- [x] Store good match, bad match, not my industry, too big/small, already knew, and want more like this.
- [x] Track saves and feedback events.
- [x] Track clicks, dismissals, and save/track conversions.
- [x] Expose feedback summary endpoint for ranking and briefing generation.
- [x] Feed feedback into Market Research ranking and briefing generation.
- [x] Show "Recommended Opportunities" cards in Market Research.
- [x] Add opportunity details drawer from recommendation cards.
- [x] Use feedback reasons to boost/downrank similar future matches.

## 2. Team Seat/Admin Enforcement

- [x] Enforce 5 seats for MI Team invites.
- [x] Support larger invite capacity for Enterprise.
- [x] Keep owner/admin/member/viewer roles.
- [ ] Make admin dashboard clear enough for team owners.

## 3. Shared Pipeline Polish

- [x] Confirm pipeline CRUD actions respect workspace access.
- [x] Record team activity for create, update, stage move, and delete.
- [x] Record team activity for comments.
- [x] Show owner/assignee clearly in shared views.

## 4. Proposal Prep Pack V1

- [x] Generate proposal prep from a saved pursuit.
- [x] Include solicitation summary, bid/no-bid risks, win themes, compliance checklist, questions to ask, and draft outline.
- [x] Keep this as Pro/Team value without pretending full proposal writing is done.

## 5. Profile And Ranking Quality

- [x] Add multi-select set-aside preferences in settings.
- [x] Persist `setAsides` while keeping `businessType` for backwards compatibility.
- [x] Downrank special set-asides when the user does not have the required certification.
- [x] Up-rank Total Small Business / small-business-friendly matches for small business profiles.
- [x] Downrank Veterans Affairs buyer/opportunity matches for non-veteran profiles.
- [x] Keep Sources Sought, RFI, and Special Notice visible as research signals even when the set-aside is not a direct fit.
- [x] Use profile and feedback together in recommendation ordering.
- [ ] Add clearer "complete your profile" nudges when ranking confidence is low.
- [ ] Add a visible explanation when a match is downranked because of set-aside mismatch.

### Current Recommendation Priority

1. Direct NAICS / PSC / keyword fit.
2. User feedback boosts: "good match", "more like this", saved/tracked opportunities, similar agencies/NAICS.
3. Profile certification fit: matching SDVOSB, VOSB, 8(a), WOSB, EDWOSB, HUBZone, tribal/native, or small business status.
4. Total Small Business and broadly small-business-friendly opportunities.
5. Buyer/agency fit: VA can rank normally for SDVOSB, VOSB, and veteran-owned profiles, but is downranked for non-veteran profiles.
6. Sources Sought, RFI, Special Notice, and market-research notices, kept visible even if not an immediate bid.
7. Neutral Full and Open / unrestricted opportunities.
8. Special set-asides the user does not qualify for, except research notices.
9. User feedback penalties: bad match, not my industry, too big/small, already knew, dismissed opportunities.

### Agency Selection Rules

- Buyer/agency ranking is now small-business-first:
  1. High share of simplified acquisition awards under the current $350K threshold.
  2. High share of micro-purchases under the current $15K threshold.
  3. Meaningful volume of accessible SAT/micro awards.
  4. Positive FY2026 budget momentum from Budget Checkup.
  5. Raw agency spend only as a tie-breaker, not the main driver.
- Default buyer reports should not choose Veterans Affairs for non-veteran profiles.
- VA can be selected and recommended when the profile includes SDVOSB, VOSB, veteran-owned, or service-disabled veteran-owned status.
- If a VA Sources Sought, RFI, or Special Notice appears for a non-veteran profile, keep it visible as a lower-priority research signal instead of treating it like a top pursuit.

## 6. Full Proposal Assist Later

- [x] Add RFP upload/parsing. (PDF, DOCX, TXT — `/api/app/proposal/upload`)
- [x] Generate compliance matrix from source docs. (Groq llama-3.3-70b — `/api/app/proposal/compliance`)
- [x] Draft proposal sections. (5 sections, profile-grounded — `/api/app/proposal/draft`)
- [x] Add review checklist and export workflow. (11-item checklist + .docx package — `/api/app/proposal/export`)

## 7. Verification Checklist

- [x] `npm run build` passes after the latest Market Research buyer fallback.
- [x] Local API check returns nonzero agency count when `selectedAgencyData` is empty and target agencies are provided.
- [x] `npm run build` passes after the live-opportunity report fallback.
- [x] Production deploy for `getmindy.ai/app` returns HTTP 200 and maps to the shared Mindy implementation.
- [ ] Browser check: refresh `localhost:3001/app`, click Market Research `Refresh`, and confirm `Agencies to review` is nonzero.
- [ ] Browser check: click each "Choose What You Need" tile and confirm the matching report opens.
- [ ] Browser check: save multiple set-asides in settings, refresh recommendations, and confirm mismatched special set-asides fall below eligible Small Business / Full and Open / research notices.
- [ ] Browser check: remove veteran/SDVOSB/VOSB status, refresh recommendations, and confirm VA is not chosen as a buyer agency unless the notice is a lower-priority research signal.
- [ ] Browser check: open several recommendation details and confirm place of performance, sub-agency/office, useful summary, clickable source links, and working close behavior.
- [ ] Browser check: validate all major money cards display `$M`, `$B`, or `$T` consistently across Mindy.
