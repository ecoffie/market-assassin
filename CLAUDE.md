# Market Assassin - Claude Project Context

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **This is the DEVELOPMENT project.** Deploys to `tools.govcongiants.org`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
3. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL.
4. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
5. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.
6. **SAM.gov API does NOT support comma-separated NAICS codes.** Must make parallel requests for each NAICS code and merge results. See `src/lib/briefings/pipelines/sam-gov.ts`.

---

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Roadmap:** See [`TOOL-BUILD.md`](./TOOL-BUILD.md)
**Session History:** See [`MEMORY.md`](./MEMORY.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.org` | Marketing site |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Linkedin App` | `linkedin-deal-magnet.vercel.app` | Profile optimizer (separate product) |

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`
**Purpose:** Market intelligence — 5 inputs + agency selection → 4-8 strategic reports
**Tiers:** Standard ($297, 4 reports) | Premium ($497, 8 reports)
**Key Files:** `market-assassin/page.tsx`, `api/reports/generate-all/route.ts`

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `public/content-generator/`
**Purpose:** AI LinkedIn post generator — up to 30 posts/click, 250 agencies, bulk .docx/.zip export
**Tiers:** Content Engine ($197) | Full Fix ($397)
**Key Files:** `public/content-generator/index.html`, `api/content-generator/generate/route.ts`

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** 3,500+ federal contractors with SBLO contacts, filtering, export
**Price:** $497

### 4. Recompete Tracker
**Location:** `/public/recompete.html`
**Purpose:** Track expiring federal contracts for recompete opportunities
**Price:** $397
**Features:** Pagination, CSV/Excel/PDF export, location filtering, mobile responsive

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`
**Purpose:** Find government buyers — agency spending analysis, NAICS targeting
**Price:** Free + Pro ($49) + Alert Pro ($19/mo)

### 6. Action Planner
**Location:** `/src/app/planner/`
**Purpose:** Task management — 5 phases, 36 tasks, progress tracking, PDF export

### 7. Daily Briefings
**Location:** `/src/lib/briefings/`
**Purpose:** Personalized daily GovCon intel emails with win probability scoring
**Features:** Smart profiles, engagement tracking, Lindy AI integration

---

## Products & Pricing

| Product | Price | KV Key | Stripe Metadata |
|---------|-------|--------|-----------------|
| Opportunity Hunter Pro | $49 | `ospro:{email}` | `tier: hunter_pro` |
| Alert Pro (subscription) | $19/mo | `alertpro:{email}` | `tier: alert_pro` |
| Content Reaper | $197 | `contentgen:{email}` | `tier: content_standard` |
| Market Assassin Standard | $297 | `ma:{email}` | `tier: assassin_standard` |
| Content Reaper Full Fix | $397 | `contentgen:{email}` | `tier: content_full_fix` |
| Recompete Tracker | $397 | `recompete:{email}` | `tier: recompete` |
| Federal Contractor Database | $497 | `dbaccess:{email}` | `tier: contractor_db` |
| Market Assassin Premium | $497 | `ma:{email}` | `tier: assassin_premium` |
| Daily Briefings | included in bundles | `briefings:{email}` | `tier: briefings` |

### Bundles
| Bundle | Price | Includes |
|--------|-------|----------|
| Starter ($697) | $943 value | Opp Hunter Pro, Recompete, Contractor DB |
| Pro Giant ($997) | $1,388 value | Contractor DB, Recompete, MA Standard, Content Gen, 1 Year Briefings |
| Ultimate ($1,497) | $1,788 value | Content Full Fix, Contractor DB, Recompete, MA Premium, Lifetime Briefings |

### Memberships
| Membership | Price | Includes |
|------------|-------|----------|
| Federal Help Center | $99/mo | MA Standard + Alert Pro + OH Pro (revoked on cancel) |

---

## Rate Limiting & Abuse Detection

### Rate Limits
| Scope | Limit | Window | KV Key |
|-------|-------|--------|--------|
| Report generation (email) | 50 | 24 hours | `rl:report:{email}` |
| Content generation (email) | 10 | 24 hours | `rl:content:{email}` |
| Authenticated IP fallback | 30 | 1 hour | `rl:ip:{ip}` |
| Unauthenticated IP | 5 | 1 hour | `rl:ip:unauth:{ip}` |
| Admin endpoints | 30 | 1 minute | `rl:admin:{ip}` |

### Abuse Thresholds
| Level | Count | Action |
|-------|-------|--------|
| Warning | 100 | Console log |
| Flagged | 250 | Stored in `abuse:flag:{email}`, added to `abuse:flagged` set |
| Blocked | 500+ | API returns 403, logged to console |

### Admin Endpoint
`/api/admin/abuse-report?password=galata-assassin-2026`
- GET: View all flagged users
- GET `?email=X`: Check specific user
- POST `{ action: "clear", email: "X" }`: Clear flag

---

## Access Control System

### Vercel KV — Primary (gates actual tool access)
**Code:** `src/lib/access-codes.ts`

### Supabase `user_profiles` — Secondary (boolean flags)
**Code:** `src/lib/supabase/user-profiles.ts`

### Purchase Flow (Triple-Write)
1. Customer buys via Stripe → webhook at `/api/stripe-webhook`
2. Webhook writes: Supabase `purchases` + `user_profiles` flags + Vercel KV
3. Sends confirmation email
4. Customer activates at `/activate` (email-only)

---

## Data Systems

### Agency Pain Points
- **Database:** `src/data/agency-pain-points.json` — 250 agencies, 2,765 pain points, 2,500 priorities
- **Admin:** `/api/admin/build-pain-points?password=galata-assassin-2026`
- **API:** `/api/pain-points`

### FY2026 Budget Authority
- **Cached data:** `src/data/agency-budget-data.json` — 47 toptier agencies
- **Admin:** `/api/admin/build-budget-data?password=...&mode=build`
- **API:** `/api/budget-authority`

### Win Probability Scoring
- **File:** `src/lib/briefings/win-probability.ts`
- **Factors:** NAICS (25), Set-Aside (25), Agency (15), Size (15), Capability (10), Vehicle (10)
- **Tiers:** excellent (75%+), good (60-74%), moderate (45-59%), low (30-44%), poor (<30%)

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/products.ts` | Product config with Stripe URLs (source of truth) |
| `src/app/api/stripe-webhook/route.ts` | Payment webhook — triple-write handler |
| `src/lib/supabase/user-profiles.ts` | User & access flag management |
| `src/lib/access-codes.ts` | Vercel KV access checking |
| `src/lib/rate-limit.ts` | Rate limiting functions |
| `src/lib/abuse-detection.ts` | Abuse tracking and flagging |
| `src/lib/send-email.ts` | All email templates |
| `src/lib/briefings/` | Daily briefing system |
| `src/lib/smart-profile/` | User profile learning system |

---

## Admin Endpoint Standard

- **Auth:** `?password=galata-assassin-2026` (or `ADMIN_PASSWORD` env var)
- **GET** = read/preview (safe)
- **POST** = execute (writes data)
- **Preview mode:** `?mode=preview` (default)
- **Execute mode:** `?mode=execute`
- **Response:** `{ success: boolean, message: string, data?: any, errors?: string[] }`

### Key Admin Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/admin/abuse-report` | View/clear abuse flags |
| `/api/admin/build-pain-points` | Rebuild agency pain points |
| `/api/admin/build-budget-data` | Rebuild budget data |
| `/api/admin/trigger-alerts` | Manually trigger alert emails |
| `/api/admin/send-test-briefing` | Generate and send test briefing |
| `/api/admin/grant-briefings` | Batch grant briefings access |
| `/api/cron/health-check` | Automated API health tests |

---

## Bug Prevention Rules

1. **Never `continue` after Supabase failure** — always run KV operations unconditionally.
2. **Never match comma-joined strings directly** — split on delimiters first.
3. **Formatting must be consistent server + client** — markdown must render correctly.
4. **Always persist state after generation** — upsert to database immediately.
5. **Arrays must be `.join(' ')` not interpolated** — avoid `${array}` producing comma-joined.
6. **Never `.slice()` user data silently** — make caps explicit or configurable.

---

## Email Template Standard

- **Footer branding:** "GovCon Giants AI"
- **From address:** `hello@govconedu.com`
- **Support email:** `service@govcongiants.com`
- **Phone:** 786-477-0477
- **Include:** activation link, "Manage preferences", "Unsubscribe"

---

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SMTP_USER=hello@govconedu.com
SMTP_PASSWORD=...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

---

*Last Updated: March 23, 2026*
