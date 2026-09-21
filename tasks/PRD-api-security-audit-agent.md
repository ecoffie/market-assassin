# PRD: API Security Audit Agent V1

**Status:** Draft for implementation  
**Date:** May 10, 2026  
**Owner:** Engineering / MI Ops  
**Related spec:** `tasks/agents/api-security-audit-agent.md`  
**Baseline audit:** `npm run audit:api-auth` found 253 API routes and 68 open candidates on May 10, 2026.

## 1. Problem

MI is becoming the unified platform for free users, paid users, internal users, public SEO visitors, and future white-glove clients. That means the API surface is now business-critical. Some routes are intentionally public, but others return customer data, operational data, paid feature data, or write to the database.

The team needs a repeatable way to classify every API route and make sure no route is accidentally open.

If we do nothing:

- Customer data can be exposed.
- Paid data can be accessed without entitlement.
- Admin operations can be triggered without the right protection.
- Public SEO routes may expose too much data.
- Future engineers will not know which routes are intentionally public.

## 2. Customer Segment

- MI Internal
- Admin/operator
- Engineering
- Security/trust
- Public SEO visitor, indirectly, because public routes must be safe by design
- MI Free and MI Pro, indirectly, because protected app routes must enforce account and entitlement rules

## 3. Core Outcome

Every API route is intentionally classified, protected, or documented as public-safe.

## 4. Business Goal

- Protect customer trust.
- Protect paid MI value.
- Support public SEO acquisition without leaking gated data.
- Reduce risk before scaling MI Free, MI Pro, team accounts, and white-glove.
- Make route security auditable during every sprint.

## 5. User Stories

> As an engineer, I want an audit that lists unclassified API routes, so I know exactly what to harden next.

> As an operator, I want admin routes protected consistently, so operational tools cannot be triggered by the public.

> As a product owner, I want public SEO routes explicitly documented, so we can share useful teasers without exposing paid data.

> As an MI Pro customer, I want paid data protected, so my access remains valuable and trusted.

> As Eric, I want a simple route classification report, so I can see what is safe, what is risky, and what is left.

## 6. Public vs Gated Access

| Level | Visible Data | CTA |
| --- | --- | --- |
| Public | Only public-safe marketing, lead capture, unsubscribe, webhook receiver, or SEO teaser data | Create free account / upgrade |
| MI Free | Free-tier product data tied to authenticated user/session | Upgrade to Pro |
| MI Pro | Paid product data and workflows tied to authenticated user/session and entitlement | Use/save/export |
| Internal/Admin | Operational routes, migrations, campaigns, sync jobs, debug data | Manage/repair/run |

## 7. Data Sources

Primary inputs:

- `src/app/api/**/route.ts`
- `scripts/audit-api-auth.js`
- `package.json` script `audit:api-auth`
- Auth helper usage:
  - `requireMIAuthSession`
  - `requireTwoFactorSession`
  - `verifyMIAccess`
  - `verifyMAAccess`
  - `verifyAdminPassword`
  - `verifyAdminSecret`
  - webhook signature validation
  - cron/shared-secret checks
- Supabase service role usage.
- Database write usage.
- External API access.
- Public SEO API route list.

Baseline open candidate groups from the May 10 audit:

- User actions: `/api/actions/*`, `/api/opportunities/*`, `/api/pipeline/*`, `/api/profile/*`
- MI/product data: `/api/briefings/*`, `/api/mi-dashboard`, `/api/mi-beta/engagement`, `/api/contractors`, `/api/recompete`, `/api/grants`, `/api/sbir`
- Intelligence/data APIs: `/api/agencies/*`, `/api/agency-*`, `/api/budget-*`, `/api/contract-intel/*`, `/api/sam/*`, `/api/usaspending/*`
- Access/license/verification: `/api/activate*`, `/api/verify-*`, `/api/usage/*`
- Integrations/tools: `/api/lindy/*`, `/api/templates`, `/api/stripe-session`, `/api/teaming*`, `/api/content-generator/library`
- Public/SEO candidate: `/api/public/contractors/[slug]`

## 8. UX Requirements

### First Screen

The output can start as a CLI/report, then feed an admin page later. V1 should produce:

- Total route count.
- Open candidate count.
- Route classification table.
- Risk rank.
- Suggested protection pattern.
- Owner/status.

### Primary Action

Pick the next route batch to harden:

1. Database writes.
2. Service role routes.
3. Admin/ops routes.
4. Paid/customer data routes.
5. Cron/webhook/token routes.
6. Intentional public routes.

### Empty State

If no candidates remain, show:

- Total classified routes.
- Public allowlist count.
- Last audit time.
- Remaining manual review notes.

### Error State

If the audit cannot scan routes, show:

- Missing directory or file.
- Script error.
- Last known candidate count, if available.

## 9. Metrics

Track:

- Total API routes.
- Unclassified/open candidates.
- Routes hardened this sprint.
- Routes allowlisted with comments.
- Admin routes protected.
- MI user routes protected.
- Token/webhook/cron routes protected.
- Public SEO routes documented.
- Build/test/curl verification count.

## 10. Decision Levers

| Signal | Meaning | Lever |
| --- | --- | --- |
| Open candidates increasing | New API work is bypassing classification | Add PR checklist/audit gate |
| Service role route open | High-risk exposure | Add admin/session/token auth immediately |
| Paid route open | MI value leakage | Add MI auth and entitlement |
| Public SEO route returns too much | Gating strategy too loose | Reduce fields and add CTA |
| Many routes using custom auth | Inconsistent security | Centralize helper pattern |
| Audit false positives high | Scanner lacks route comments | Add explicit annotations/allowlist comments |

## 11. Access And Security

Required route classes:

| Class | Meaning | Required Protection |
| --- | --- | --- |
| Public | Safe marketing/demo/feed/SEO teaser | Explicit allowlist with comment and no private data |
| Token protected | Webhook, cron, shared secret | Signature, bearer token, cron secret, or signed token |
| Admin only | Internal operational/admin data or writes | Admin password/session/secret helper |
| MI user protected | Customer data, app actions, paid/free product data | MI auth session and entitlement if paid |

Security rules:

- No database write route should be open.
- No service-role route should be open.
- No customer-specific data route should be open.
- No paid/product data route should be open.
- No admin/ops route should rely on obscurity.
- Public SEO routes must return only public-safe teaser fields.

## 12. Non-Goals

- No full auth refactor in V1.
- No new identity provider work in V1.
- No removal of useful public SEO routes.
- No blanket admin-locking of public marketing or unsubscribe routes.
- No destructive route deletions.

## 13. Proposed Route Classification Output

```json
{
  "generatedAt": "2026-05-10T12:00:00.000Z",
  "totalRoutes": 253,
  "openCandidateCount": 68,
  "routes": [
    {
      "route": "/api/pipeline/",
      "file": "src/app/api/pipeline/route.ts",
      "classification": "mi_user_protected",
      "risk": "high",
      "reason": "Customer pipeline data and database writes",
      "requiredProtection": "requireMIAuthSession + ownership check",
      "status": "todo"
    }
  ]
}
```

## 14. Implementation Plan

### Phase 1: Improve Audit Metadata

- Add route classification fields to `scripts/audit-api-auth.js`.
- Support a reviewed-route config or inline comments.
- Output grouped candidates by risk and required protection.
- Include service role and database write detection heuristics.

### Phase 2: Classify All 68 Candidates

- Create a route classification table.
- Mark each as public, token protected, admin only, or MI user protected.
- Add rationale for each intentional public route.

### Phase 3: Harden Highest-Risk Routes

First batch:

- `/api/actions/add-to-pipeline/`
- `/api/actions/mute-opportunity/`
- `/api/opportunities/save/`
- `/api/opportunities/save-redirect/`
- `/api/pipeline/stats/`
- `/api/profile/`
- `/api/profile/track/`
- `/api/briefings/latest/`
- `/api/briefings/preferences/`
- `/api/briefings/profile-stats/`

Second batch:

- `/api/contract-intel/*`
- `/api/contacts/`
- `/api/teaming*`
- `/api/ma-usage/`
- `/api/mi-dashboard/`
- `/api/mi-beta/engagement/`

Third batch:

- Public/SEO route review.
- Public intelligence teaser routes.
- Access/verification route review.

### Phase 4: Add Sprint Gate

- Add audit run to release checklist.
- Consider CI warning if open candidate count increases.
- Update `tasks/todo.md` after each hardening batch.

## 15. Acceptance Criteria

- [ ] Audit output includes route classification and risk.
- [ ] All 68 baseline candidates are reviewed.
- [ ] Highest-risk write/customer routes require auth.
- [ ] Public routes are explicitly allowlisted with comments.
- [ ] Public SEO routes return only public-safe teaser data.
- [ ] `npm run audit:api-auth` shows only expected unclassified routes, or zero unclassified routes.
- [ ] Todo file records remaining route count after each sprint.
- [ ] No route is made public merely to satisfy the audit.
