# Market Assassin - API Reference

Complete API endpoint inventory for the Market Assassin platform.

---

## Authentication Methods

| Method | Usage |
|--------|-------|
| **Admin Password** | `?password=galata-assassin-2026` (or `ADMIN_PASSWORD` env var) |
| **Cron Secret** | `Authorization: Bearer {CRON_SECRET}` header |
| **Email-based** | Most user endpoints require `email` parameter |
| **Stripe Signature** | Webhook verification via `stripe-signature` header |
| **Tokens** | MA access tokens, Database tokens |
| **Cookies** | Set by verification endpoints (httpOnly, 1-year expiry) |

---

## Admin Endpoints

All admin endpoints require `?password=galata-assassin-2026`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/verify-password` | POST | Verify admin password |
| `/api/admin/abuse-report` | GET/POST | View/clear abuse flags |
| `/api/admin/trigger-briefings` | GET | Manually trigger briefing sends |
| `/api/admin/trigger-alerts` | GET | Manually trigger SAM alerts |
| `/api/admin/grant-ma-access` | POST | Grant Market Assassin access |
| `/api/admin/grant-briefings` | GET/POST | Grant briefings access |
| `/api/admin/grant-content-generator` | POST | Grant Content Reaper access |
| `/api/admin/grant-database-access` | POST | Grant Contractor DB access |
| `/api/admin/grant-recompete` | POST | Grant Recompete access |
| `/api/admin/grant-ospro-access` | POST | Grant OH Pro access |
| `/api/admin/revoke-access` | POST | Revoke access for user/product |
| `/api/admin/check-access` | GET | Complete access audit (KV + Supabase + Stripe) |
| `/api/admin/list-access` | GET | List all access grants by product |
| `/api/admin/list-purchases` | GET | List all purchases (500 limit) |
| `/api/admin/list-profiles` | GET | List all user profiles |
| `/api/admin/user-audit` | GET | User audit trail |
| `/api/admin/stripe-lookup` | GET | Lookup Stripe customer |
| `/api/admin/sync-fhc-members` | GET | Sync Federal Help Center members |
| `/api/admin/build-pain-points` | GET/POST | Build agency pain points data |
| `/api/admin/build-budget-data` | GET | Fetch FY2025/2026 budget data |
| `/api/admin/build-psc-crosswalk` | POST | Build PSC-NAICS crosswalk |
| `/api/admin/build-recompete-data` | GET/POST | Rebuild recompete data |
| `/api/admin/kv` | GET | Direct Vercel KV inspector |
| `/api/admin/create-token` | POST | Create access tokens |
| `/api/admin/send-test-briefing` | POST | Generate and send test briefing |
| `/api/admin/seed-test-briefing` | GET | Seed test briefing data |
| `/api/admin/debug-snapshots` | GET | Debug briefing snapshots |

---

## Webhook & Cron Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/stripe-webhook` | POST | Stripe Signature | Handle Stripe events (triple-write) |
| `/api/cron/health-check` | GET | Cron Secret | Automated API health tests (15+ tests) |
| `/api/cron/daily-alerts` | GET | Cron Secret | Daily SAM alerts |
| `/api/cron/weekly-alerts` | GET | Cron Secret | Weekly SAM alerts |
| `/api/cron/send-briefings` | GET | Cron Secret | Scheduled briefing delivery |
| `/api/cron/aggregate-profiles` | GET | Cron Secret | Aggregate user profiles |
| `/api/cron/snapshot-awards` | GET | Cron Secret | Snapshot award data |
| `/api/cron/snapshot-contractors` | GET | Cron Secret | Snapshot contractor data |
| `/api/cron/snapshot-opportunities` | GET | Cron Secret | Snapshot opportunities |
| `/api/cron/snapshot-recompetes` | GET | Cron Secret | Snapshot recompetes |
| `/api/cron/web-intelligence` | GET | Cron Secret | Gather web intelligence |

---

## Access Verification Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/verify-access` | POST | Email/License | Check product access |
| `/api/verify-ma-access` | POST | Access Code | Verify MA access + set cookie |
| `/api/verify-ma-tier` | POST | Email | Check MA tier (standard/premium) |
| `/api/verify-ospro-access` | POST | Email | Verify OH Pro access |
| `/api/verify-content-generator` | POST | Email | Verify Content Reaper access |
| `/api/verify-db-access` | POST | Email | Verify Contractor DB access |
| `/api/verify-db-password` | POST | Password | Contractor DB password access |
| `/api/verify-recompete-access` | POST | Email | Verify Recompete access |
| `/api/verify-recompete-password` | POST | Password | Recompete password access |
| `/api/database-access/[token]` | GET | Token | Token-based DB access |

---

## Tool-Specific Endpoints

### Market Assassin
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/reports/generate-all` | POST | Generate 4-8 report bundle |
| `/api/customer-report` | POST | Generate full report from form |
| `/api/ma-usage` | GET/POST | Check/increment MA usage |

### Content Reaper
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/content-generator/generate` | POST | Generate LinkedIn posts (up to 30) |
| `/api/content-generator/library` | GET | Fetch saved content library |
| `/api/generate-graphic` | POST | Generate social graphic |
| `/api/generate-quote` | POST | Generate quote graphic |
| `/api/convert-post-to-carousel` | POST | Convert post to carousel |
| `/api/templates` | GET | Get content templates |

### Opportunity Hunter
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/usaspending/find-agencies` | POST | Find top agencies by NAICS |
| `/api/usaspending/find-hit-list` | POST | Find high-value targets |
| `/api/sam/live-opportunities` | POST | Fetch live SAM.gov opportunities |
| `/api/sam/historical-context` | POST | Get historical context |

### Other Tools
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/contractors` | GET | Get contractor database (paginated) |
| `/api/idv-search` | POST | Search IDV contract vehicles |
| `/api/government-contracts/search` | POST | Search government contracts |
| `/api/planner/verify-access-code` | POST | Verify Action Planner access |

---

## Briefings & Alerts Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/briefings/latest` | GET | Get latest briefing for user |
| `/api/briefings/preferences` | GET/POST | Get/update briefing preferences |
| `/api/briefings/verify` | POST | Verify briefing access |
| `/api/briefings/sms-webhook` | POST | Twilio SMS webhook |
| `/api/briefings/test-sms` | POST | Send test SMS |
| `/api/alerts/save-profile` | POST | Save alert profile |
| `/api/alerts/preferences` | GET/POST | Get/update alert preferences |
| `/api/alerts/unsubscribe` | GET | Unsubscribe from alerts |
| `/api/planner/weekly-digest` | GET | Send weekly planner digest |

---

## Data & Intelligence Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pain-points` | GET | Get agency pain points |
| `/api/budget-authority` | GET | Get FY2025/2026 budget trends |
| `/api/agencies` | GET | List all agencies |
| `/api/agencies/lookup` | GET | Lookup specific agency |
| `/api/agency-knowledge-base/[agencyName]` | GET | Get agency knowledge base |

---

## Lead Capture & User Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/capture-lead` | POST | Capture lead for free resource |
| `/api/search-capture` | POST | Capture search intent |
| `/api/profile` | GET/POST | Get/update user profile |
| `/api/profile/track` | POST | Track user activity |
| `/api/activate` | POST | Activate license key |
| `/api/activate-license` | POST | Activate by access code |
| `/api/access-codes` | GET/POST/DELETE | Manage access codes |
| `/api/stripe-session` | GET | Get Stripe session status |

---

## Usage Tracking

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/usage` | GET/POST | Usage tracking |
| `/api/usage/check` | GET | Check current limits |
| `/api/usage/increment` | POST | Increment usage counter |

---

## Lindy.AI Integration

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/lindy` | POST | Lindy AI webhook handler |
| `/api/lindy/match` | POST | Match user to opportunities |
| `/api/lindy/intelligence` | POST | Generate market intelligence |
| `/api/lindy/docs` | GET | Get integration docs |

---

## Rate Limits

| Scope | Limit | Window | KV Key |
|-------|-------|--------|--------|
| Report generation | 50 | 24 hours | `rl:report:{email}` |
| Content generation | 10 | 24 hours | `rl:content:{email}` |
| Authenticated IP | 30 | 1 hour | `rl:ip:{ip}` |
| Unauthenticated IP | 5 | 1 hour | `rl:ip:unauth:{ip}` |
| Admin endpoints | 30 | 1 minute | `rl:admin:{ip}` |

---

## Response Formats

**Standard Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Standard Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Rate Limited (429):**
```json
{
  "error": "Too many requests. Please try again later."
}
```
Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

---

*Last Updated: March 20, 2026*
