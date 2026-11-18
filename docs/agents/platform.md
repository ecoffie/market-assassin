# Platform architecture and engineering standards

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## 🧭 The GovCon Operating System — READ THIS FIRST for any new build

**`docs/strategy/MINDY-OPERATING-THESIS.md`** is the spine. Before starting any new Mindy build,
read it and name which paradigm(s) + guardrails it draws from — so we trace direction back to one
thesis instead of re-deriving it. It holds: the one thesis (bulletproof-but-boring → make it fun,
open, agent-native; public data = content, private history = moat), the paradigm bucket
(AWS / Robinhood / Higgsfield / gamification / news-as-source), the load-bearing principles, the
**engineering invariants** (filter-before-rank, count≠null, ground-in-real-data — each an
automated pre-push gate, not a hope), and the **knowledge-architecture rule** (CLAUDE.md +
MEMORY.md = always-on; `docs/**` = on-demand depth; gates = invariants that fire; skills =
procedures). It is the index into every other strategy doc — open the deep doc it points to,
don't re-derive.

---

## Unified MI Platform Architecture (May 2026)

**Decision:** All Market Intelligence tools are panels within `/briefings`, NOT separate routes.

**Pattern:** Atlassian sidebar navigation — sidebar switches content panels, not routes.
- Reference: https://www.atlassian.com/blog/design/designing-atlassians-new-navigation

**Why Sidebar (Not Tabs):**
- Industry standard (Slack, Google, Microsoft, Notion)
- Vertical space for 10+ items
- Bird's-eye view of all tools
- Familiar pattern for SaaS users

### Tier Structure (May 2026) - SIMPLIFIED

| Tier | Price | Includes |
|------|-------|----------|
| **MI Free** | $0 | Market Research (4 reports, 5/mo) + Daily Alerts (simple list) |
| **MI Pro** | $149/mo | **Everything:** Market Research (10 reports, unlimited) + AI Briefings + Forecasts + Pipeline + CRM + FHC Training |

**Public-facing = 2 tiers only: Free → Pro**

> ⚠️ **Current tiers (2026-11-13) — this older table is history.** Public plans are Free / Pro $149/mo ($1,490/yr) / Team $499/mo ($4,027/yr), both paid plans with a 14-day card trial. Pro access = `resolveAccess` (paid briefings · `access_team` · an active `trial_ends_at`); `verifyMIAccess` now honors the trial too. Pro credits are MCP-only (Claude/ChatGPT/Cursor) — the app is included in the plan. Team annual (402700¢) is recognized by the monthly credit grant. Weekly alerts: Pro/Team/trial get 15, free 5.

No decision fatigue. Clear upgrade path.

**MI Free Features:**
- Market Research (4 Standard reports: Analytics, Budget Authority, Gov Buyers, OSBP Contacts)
- 5 reports per month cap
- Daily Alerts (simple opportunity list, no AI analysis)
- Profile setup + NAICS preferences

**MI Pro Features ($149/mo):**
- Market Research (all 10 reports, unlimited usage)
- AI Briefings (Daily + Weekly + Pursuit)
- 7,700+ Forecasts
- Pipeline Tracker + Teaming CRM
- Content Reaper (AI LinkedIn posts)
- FHC Training access

**Grandfathered Users (internal tracking only):**
- OH Pro ($49 one-time) → Keep OH Pro features forever
- Briefings ($49/mo) → Keep at $49/mo, get AI briefings (no full tools)
- Alert Pro ($19/mo) → Cancel, migrate to MI Free
- Tool bundles (Starter/Pro Giant/Ultimate) → Lifetime MI Pro access

**Pricing Notes (May 5, 2026):**
- Public page shows **Free vs $149/mo Pro only**
- $49/mo exists but NOT promoted (loyalty/grandfather only)
- $149/mo includes FHC training (replaces separate $99/mo product)

**Domain Structure (May 20, 2026):**
- `govcongiants.com` → Marketing/SEO (govcon-funnels)
- `getmindy.ai` → **Primary SaaS app** — Mindy. Hosted by the market-assassin Vercel project via host-based rewrites in `next.config.ts`. New users sign up here.
- `mi.govcongiants.com` → SaaS app, legacy domain, same code as `getmindy.ai`. Kept for in-flight users and email links; do not promote.
- `auth.getmindy.ai` → Supabase custom domain for OAuth. Google + Microsoft consent screens show "Sign in to auth.getmindy.ai" instead of the raw Supabase project subdomain.
- `shop.govcongiants.com` → KILLED (redirect to /pricing)
- See `docs/strategy/DOMAIN-BRAND-CONSOLIDATION.md` for full plan
- Custom-domain cutover runbook (Supabase + DNS + Google + Azure): `tasks/oauth-branding-runbook.md`

**Folder structure (May 20, 2026):**
- `src/app/app/` — the `/app` user surface (renamed from `mi-beta/`, commit `cbadcac`). Contains onboarding, signup, sign-in, password flows.
- `src/app/api/app/` — API routes consumed by `/app` (renamed from `api/mi-beta/`).
- `src/components/app/` — `/app` UI components including all `panels/*.tsx`.
- `src/lib/app/workspace.ts` — workspace utilities (renamed from `lib/mi-beta/`).
- Old `mi-beta` paths no longer exist in the codebase.

### MITier Type

```typescript
// src/components/UnifiedSidebar.tsx
export type MITier = 'free' | 'pro';  // Simplified: only 2 public tiers

const tierInfo: Record<MITier, { name: string; price: string; color: string }> = {
  free: { name: 'MI Free', price: '$0', color: 'gray' },
  pro: { name: 'MI Pro', price: '$149/mo', color: 'emerald' },
};

function hasProAccess(userTier: MITier): boolean {
  return userTier === 'pro';
}
```

**Internal tracking** (for grandfathered users, not in UI):
- `legacy_briefings` = $49/mo briefings subscribers (AI briefings only)
- `legacy_oh_pro` = $49 one-time OH Pro buyers (agency search only)
- `legacy_bundle` = Tool bundle buyers (full MI Pro)

### MIPanel Type

```typescript
// src/components/UnifiedSidebar.tsx
export type MIPanel =
  | 'dashboard'      // AI Briefings - Daily/Weekly/Pursuit (Pro only)
  | 'alerts'         // Daily Alerts - simple list (Free), AI analysis (Pro)
  | 'research'       // Market Research - 4 reports free, 10 Pro (Federal Market Assassin)
  | 'forecasts'      // 7,700+ upcoming procurements
  | 'recompetes'     // Expiring contracts
  | 'contractors'    // 3,500+ with contacts
  | 'pipeline'       // Track pursuits (Pro tier)
  | 'contacts'       // CRM & relationships (Pro tier)
  | 'content'        // Content Reaper
  | 'planner'        // Action Planner
  | 'sbir'           // SBIR/STTR
  | 'grants';        // Federal grants
```

### Navigation Sections by Tier

| Section | MI Free ($0) | MI Pro ($149/mo) |
|---------|--------------|------------------|
| **Market Research** | 4 reports, 5/mo cap | All 10 reports, unlimited |
| **Daily Alerts** | Simple list (no AI) | ✅ |
| **AI Briefings** | ❌ | Daily + Weekly + Pursuit |
| **Forecasts** | ❌ | 7,700+ |
| **SBIR/STTR** | ❌ | ✅ |
| **Grants** | ❌ | ✅ |
| **Pipeline** | ❌ | ✅ |
| **CRM/Contacts** | ❌ | ✅ |
| **Content Reaper** | ❌ | ✅ |
| **FHC Training** | ❌ | ✅ |

### Key Files

| File | Purpose |
|------|---------|
| `src/components/UnifiedSidebar.tsx` | Sidebar with tier-based access control |
| `src/app/briefings/page.tsx` | Main dashboard with panel conditional rendering |
| `src/components/bd-assist/PipelineBoard.tsx` | Pipeline panel component |
| `src/components/bd-assist/ContactsPanel.tsx` | Contacts panel component |
| `src/components/bd-assist/ForecastsPanel.tsx` | Forecasts panel component |
| `src/components/briefings/SbirPanel.tsx` | SBIR/STTR panel component |
| `src/components/briefings/GrantsPanel.tsx` | Grants panel component |

### Implementation Pattern

```tsx
// In /briefings/page.tsx
const [activePanel, setActivePanel] = useState<MIPanel>('dashboard');

return (
  <div className="flex">
    <UnifiedSidebar
      activePanel={activePanel}
      onPanelChange={setActivePanel}
      userTier="pro" // Determines feature access
    />
    <main>
      {activePanel === 'dashboard' && <DashboardContent />}
      {activePanel === 'pipeline' && <PipelineBoard email={email} />}
      {activePanel === 'contacts' && <ContactsPanel email={email} />}
      {/* ... other panels */}
    </main>
  </div>
);
```

### DO NOT

- Create separate routes for tools (e.g., `/pipeline`, `/contacts`)
- Use href links in sidebar — use onClick with panel state
- Add tools outside `/briefings` — all tools are panels within MI
- Allow access to tier-restricted features without proper userTier check

---

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Session History:** See [`MEMORY.md`](./MEMORY.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `getmindy.ai` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.com` | Marketing site |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Linkedin App` | `linkedin-deal-magnet.vercel.app` | Profile optimizer (separate product) |

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
`/api/admin/abuse-report?password=$ADMIN_PASSWORD`
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
| `src/app/api/cron/daily-alerts/route.ts` | Daily alerts cron (FREE for everyone; phased setup nudges via `profile-setup.ts`) |
| `src/lib/alerts/profile-setup.ts` | Alert conversion window + `userNeedsMindySetup()` |
| `src/lib/sam/attachment-metadata.ts` | SAM attachment filename resolution (HEAD / Content-Disposition) |
| `src/components/app/SamAttachmentLinks.tsx` | Lazy attachment labels in Alerts + Market Dashboard |
| `src/app/api/sam-attachment/metadata/route.ts` | `GET ?url=` → `{ filename }` for SAM download links |
| `src/app/api/cron/precompute-briefings/route.ts` | Pre-compute daily templates by NAICS |
| `src/app/api/cron/send-briefings-fast/route.ts` | Send daily briefings (~100ms/user) |
| `src/app/api/cron/precompute-weekly-briefings/route.ts` | Pre-compute weekly templates by NAICS |
| `src/app/api/cron/send-weekly-fast/route.ts` | Send weekly briefings (~100ms/user) |
| `src/app/api/cron/precompute-pursuit-briefs/route.ts` | Pre-compute pursuit templates by NAICS |
| `src/app/api/cron/send-pursuit-fast/route.ts` | Send pursuit briefs (~100ms/user) |
| `src/app/alerts/preferences/page.tsx` | Alert/briefing preferences UI |
| `src/lib/utils/psc-crosswalk.ts` | PSC-NAICS crosswalk for broader search |
| `src/app/api/suggest-codes/route.ts` | AI code suggestion (Groq Llama 3.3 70B) |
| `src/app/api/sample-opportunities/route.ts` | Sample opportunity picker for profile calibration |
| `docs/govcon-market-research.md` | GAO market research framework for AI prompts |
| `docs/PRD-market-research-intelligence.md` | PRD for market research integration |

---

## Admin Endpoint Standard

- **Auth:** `?password=$ADMIN_PASSWORD` (or `ADMIN_PASSWORD` env var)
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
| `/api/admin/test-sam-awards` | Test SAM Contract Awards API |
| `/api/admin/test-sam-entity` | Test SAM Entity Management API |
| `/api/admin/test-sam-subaward` | Test SAM Subaward API |
| `/api/admin/test-sam-hierarchy` | Test SAM Hierarchy API |
| `/api/admin/test-market-intel-pipeline` | **Full Market Intel pipeline testing** |
| `/api/admin/sync-alert-to-notification` | Sync users between alert/notif tables |
| `/api/admin/send-naics-reminder` | Send NAICS setup reminder emails |
| `/api/cron/health-check` | Automated API health tests |
| `/api/admin/tool-health` | **AI Tool Health Dashboard** — unified monitoring |
| `/api/admin/apply-tool-errors-migration` | Apply tool_errors database migration |
| `/api/admin/mi-growth-brief` | **MI Growth Brief** — engagement metrics + behavioral queues |
| `/api/admin/qualify-customers` | **Customer Qualification Agent** — purchase-based scoring |
| `/api/admin/launch-manager-brief` | Launch Manager Brief — team execution guidance |
| `/api/admin/map-funnel` + page `/admin/map-funnel` | **Opportunity Map "Today's Product" dashboard** (Epic #1) — behavioral analytics of the map: the discovery FUNNEL (map_open→pin→popup→listing→pursuit→proposal, per-step drop-off), top STRATEGY combinations, + "why this opportunity?" per-strand click-through. Reads `user_engagement` (the generic event sink; map emits via `__track`/`__trackCard`). Emitters: `src/app/opportunity-map/route.ts` + `template.html`. |

---

## Vercel KV Resilience (May 2026)

**Problem:** Upstash KV free tier has 500K requests/month limit. When exceeded, all KV operations throw `UpstashError: ERR max requests limit exceeded`.

**Solution:** All KV-dependent functions now have try-catch fallback handling:

| Function | On KV Failure |
|----------|---------------|
| `checkRateLimit()` | Returns `allowed: true` (allows request) |
| `trackGeneration()` | Returns 0, allows request |
| `isUserBlocked()` | Returns `false` (allows request) |
| `getMarketAssassinAccess()` | Returns `null` (free tier) |
| `getAbuseRecord()` | Returns 0 |
| `getFlaggedUsers()` | Returns empty array |

**Key Files:**
- `src/lib/rate-limit.ts` — Rate limiting with KV fallback
- `src/lib/abuse-detection.ts` — Abuse tracking with KV fallback
- `src/lib/access-codes.ts` — Access checks with KV fallback

**Monitoring:**
```bash
# Check KV usage in Vercel Dashboard → Storage → KV → Usage
# Logs show: "[RateLimit] KV unavailable for..." when quota exceeded
```

**Prevention:**
- Free tier: 500K requests/month, 10K commands/day
- Consider upgrading to Pro ($10/mo) for 10M requests/month
- KV quota resets on the 1st of each month

---

## Email Template Standard

**Everything from Mindy** (2026-07-16 — see memory `mindy-email-sender-architecture`). This
repo sends TRANSACTIONAL email only; marketing/bulk is GHL (`send.getmindy.ai`).

- **From address:** `Mindy <alerts@mail.getmindy.ai>` — set via `EMAIL_FROM` (the primary Resend
  path default). Do NOT send from `*@govcongiants.com`.
- **Reply-to:** `admin@getmindy.ai` — `sendEmail` defaults `replyTo` to this (`EMAIL_REPLY_TO`
  override) unless a caller sets an explicit reply-to.
- **Support / refunds / contact in email bodies + pages:** `admin@getmindy.ai` — ONE address for
  everything customer-facing (Eric, 2026-11-10; replaced `support@`/`hello@getmindy.ai`). API
  User-Agent contact strings (SEC, Federal Register, USAJOBS, Institute) and the internal
  alert-health recipient were deliberately left as they were.
- **Logo:** 3D Mindy logo header — hosted PNG `getmindy.ai/brand/mindy-logo-3d.png` (SVG isn't
  rendered in Gmail/Outlook email).
- **Footer branding:** "GovCon Giants AI" (the operating entity behind the Mindy product).
- **Include:** activation link, "Manage preferences", "Unsubscribe".
- **No fallback provider (2026-10-27).** The Office 365 fallback authenticated as a
  `govcongiants.com` mailbox, so a Resend failure moved Mindy mail onto govcongiants (last fired
  2026-08-03: 27 `profile_reminder` sends). It is removed: a Resend failure throws, callers'
  existing retry/error handling runs, and nothing is recorded as sent. `SMTP_*` env vars are no
  longer read by this repo (they stay in Vercel until removal is approved).

---

## Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=re_...                 # the ONLY Mindy email provider
EMAIL_FROM=alerts@mail.getmindy.ai   # must be on mail.getmindy.ai (sendEmail refuses anything else)
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

---
