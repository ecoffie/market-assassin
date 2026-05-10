# API Security Audit Agent

**Status:** Draft  
**Owner:** GovCon Giants / Engineering  
**Mission:** Classify and harden API routes so no customer, admin, paid, operational, or write endpoint remains accidentally open.

## Job To Be Done

The agent answers:

- Which API routes exist?
- Which routes are intentionally public?
- Which routes need token, admin, or MI user auth?
- Which routes expose data or write to the database?
- Which routes are highest risk?
- What needs to be fixed this sprint?

## Source Inputs

- `src/app/api/**/route.ts`
- `scripts/audit-api-auth.js`
- API audit output
- Environment variable usage
- Supabase service role usage
- Admin password/token checks
- MI auth/session helpers

## Classification

| Class | Meaning | Expected Protection |
| --- | --- | --- |
| Public | Safe marketing/demo/feed route | Explicit audit allowlist with comment |
| Token protected | Webhook, cron, shared-secret route | Secret/password/token validation |
| Admin only | Internal operational route | Admin password/session gate |
| MI user protected | Customer data or paid feature | MI auth session and entitlement check |

## Risk Ranking

Highest risk first:

1. Writes to database
2. Uses service role
3. Returns customer data
4. Returns paid/product data
5. Admin/ops actions
6. Cron/send/email routes
7. Public demo routes

## Operating Cadence

### Sprint Start

- Run API audit.
- Export candidate routes.
- Group by classification.
- Pick highest-risk routes.

### During Sprint

- Harden routes.
- Add audit allowlist comments for intentional public routes.
- Add tests or curl checks where practical.

### Sprint End

- Re-run audit.
- Confirm no accidental open routes remain.
- Update `tasks/todo.md` with remaining route counts.

## Guardrails

- Do not make a route public just to make the audit pass.
- Do not expose service-role-powered data without auth.
- Public SEO routes must return only public-safe data.
- Cron/webhook routes must use secrets.
- MI customer routes must verify auth and access.

## Output

Produce:

- Route classification table
- Risk ranking
- Suggested protection pattern
- Files to change
- Test commands
- Remaining open questions

## Definition Of Done

The audit pass is complete when:

- Every route is classified
- Every risky route is protected
- Intentional public routes are documented
- `npm run audit:api-auth` produces only expected allowlisted routes
