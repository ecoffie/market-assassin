# Build Plan

Prioritize by impact, repeat frequency, and implementation ease.

## Phase 1: Read-Only Operations Visibility

**Build first:** Daily Briefings Operations Agent + Supabase Ops Tool.

Why:
- Highest operational risk.
- Used every day.
- Existing tables and admin endpoints already expose most data.
- Can start read-only, so low blast radius.

Deliverables:
1. Supabase read helpers for audience, logs, templates, errors, and dead-letter queue.
2. Daily report markdown generator.
3. One admin endpoint or script: `briefings-ops-report`.
4. No writes in v1.

Initial script:

```bash
node scripts/briefings-ops-report.js --date=2026-05-01
node scripts/briefings-ops-report.js --date=2026-05-01 --json
```

Acceptance:
- Given a date, report eligible users, sent/skipped/failed counts, template freshness, recent errors, and recommended actions.

## Phase 2: Campaign Launch System

Build the Campaign Packet Builder skill and Campaign Launch Agent.

Deliverables:
1. Segment validator for CSV/JSON campaign files.
2. Campaign packet generator.
3. End-of-day report template.
4. Optional email metrics integration.

Acceptance:
- Given source files, generate cohort counts, templates, send schedule, suppression list, activation URLs, and metrics checklist.

## Approved Action Agent: Profile Completion Reminders

Implemented first because it directly addresses the live ops finding: briefing users with no NAICS, keywords, or agencies.

Endpoint:

```bash
curl -X POST "https://tools.govcongiants.org/api/admin/send-profile-reminders?password=xxx&mode=preview&limit=25"
curl -X POST "https://tools.govcongiants.org/api/admin/send-profile-reminders?password=xxx&mode=execute&limit=25&batchSize=10"
```

Dashboard:

- `/admin/dashboard` includes a Profile Completion Reminder Agent card.
- Preview is read-only.
- Send requires an explicit browser confirmation and bounded limit.

Safety rules:

- Default mode is preview.
- Execute mode is bounded by `limit`.
- The candidate query checks active `briefings_enabled` users with no NAICS, keywords, or agencies.

## Phase 3: Entitlement Audit And Repair

Build Access Entitlement Audit Writer + Stripe Entitlement Tool + Entitlement Repair Agent.

Deliverables:
1. Read-only compare of Stripe/KV/Supabase.
2. Dry-run repair plan.
3. Execute mode with explicit approval.

Acceptance:
- Given an email, classify access state and produce exact expected changes.

## Phase 4: Matching QA

Build NAICS/Profile Matching Debugger + SAM/NAICS Matching Tool + Matching QA Agent.

Deliverables:
1. NAICS inference fixtures.
2. Ranked sample search.
3. Regression report.

Acceptance:
- "roofer in south florida" infers `238160`, `FL`, and ranks roofing/construction examples before unrelated examples.

## Phase 5: Data Freshness Automation

Build Scraper/Data Freshness Agent + GitHub/Vercel health tool.

Deliverables:
1. Freshness checks by source.
2. Row-count baseline comparisons.
3. Deploy correlation in incidents.
4. Approved scraper trigger flow.

Acceptance:
- Report stale/empty sources and recommend or trigger the correct refresh path.

## Implementation Order

1. `briefings-ops-report` script or admin endpoint.
2. Campaign packet generator around existing `scripts/briefings-activation-campaign.js`.
3. Entitlement compare command using existing verification/repair scripts.
4. Matching QA fixtures for sample opportunities.
5. Data freshness report.
