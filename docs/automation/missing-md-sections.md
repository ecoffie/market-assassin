# Missing Markdown Sections

Add these sections to canonical docs and runbooks so future Codex sessions do not have to rediscover operational rules.

## Operational Source Of Truth

Define which document wins when docs disagree.

Suggested order:
1. Current production code and deployed schema.
2. `CLAUDE.md` for known hard rules.
3. `docs/product-architecture.md` for product/tier intent.
4. `tasks/lessons.md` for bug-prevention patterns.
5. PRDs and older redesign docs as historical context.

## Environment Matrix

Document local, preview, and production environment differences.

Include:
- Required env vars by feature.
- Which routes fail locally without service-role keys.
- Which APIs are safe to call from local.
- How to smoke test with production read-only endpoints.

## Access Truth Table

Map every product and cohort to expected access.

Columns:
- Product/cohort.
- Stripe signal.
- KV key.
- Supabase table/flags.
- Notification frequency.
- Dashboard access.
- Revocation behavior.

## Cron Calendar

One table for every cron.

Columns:
- Route.
- Schedule.
- Day guard.
- Audience source.
- Dedupe key.
- Log table.
- Test URL.
- Catch-up route.

## Incident Playbooks

Minimum playbooks:
- Daily alerts failed.
- Weekly alerts failed.
- Daily briefings failed.
- Weekly/pursuit briefings failed.
- Email provider degraded.
- SAM cache stale.
- Stripe webhook failed.
- User has paid but cannot access.

## Dry-Run vs Execute Rules

For every admin script/endpoint, document:
- Whether it mutates data.
- Default mode.
- Dry-run parameter.
- Execute parameter.
- Rollback path.
- Sample safe command.

## Customer Campaign SOP

Include:
- Segment source files.
- Suppression rules.
- Activation URL pattern.
- Send windows.
- Metrics report.
- Reply triage.
- Stop conditions.

## Profile Matching Rubric

Include:
- Free-text to NAICS inference.
- Exact NAICS vs prefix fallback.
- Keyword fallback.
- Geography handling.
- Sample picker behavior.
- Regression examples.

## Data Freshness SLA

For every data source:
- Expected refresh cadence.
- Freshness threshold.
- Owner route/script.
- Failure signal.
- Manual refresh command.

## Release Checklist

Include:
- Files touched.
- Focused lint.
- Production build.
- Endpoint smoke tests.
- Data migration checks.
- Rollback notes.
- Post-deploy health checks.

