# Market Assassin - Claude Project Context

## IMPORTANT: No Framer
**This project does NOT use Framer.** Do not use any Framer MCP tools (mcp__framer-mcp__*) for this project. This is a pure Next.js/React codebase.

---

## Related GovCon Projects (Quick Reference)

| Project | Location | Identifier | Purpose |
|---------|----------|------------|---------|
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | "$82B hero page" | Marketing funnel (govcongiants.org) |
| **Market Assassin** | This project | "tools", "market assassin" | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | "live shop", "production" | Live shop (shop.govcongiants.org) |

---

## Project Overview
**Name:** Market Assassin (GovCon Tools Platform)
**Purpose:** Development/staging environment for GovCon Giants tools
**Framework:** Next.js 16.1.1 with Turbopack
**Database:** Supabase
**Payments:** Stripe

## Project Location
```
/Users/ericcoffie/Market Assasin/market-assassin
```

**IMPORTANT:** This is the DEVELOPMENT project. The LIVE shop is at `/Users/ericcoffie/govcon-shop`. When making changes intended for production on shop.govcongiants.org, work in the govcon-shop folder instead.

## Tech Stack
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend:** Next.js API Routes
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth + Custom license/access tokens
- **Payments:** Stripe (payment links + webhooks)
- **Email:** Resend / SMTP
- **PDF Generation:** jsPDF

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`, `/src/app/federal-market-assassin/`
**Purpose:** Market intelligence system for GovCon

**Features:**
- Enter 5 inputs + select target agencies
- Generates 4-8 strategic reports (Standard vs Premium)
- Reports: Pain Points, Government Buyers, Agency Spend, OSBP Contacts, Subcontracting, IDV Contracts, Similar Awards, Tribal Contracting

**Tiers:**
- Standard ($297): 4 reports
- Premium ($497): 8 reports

**Key Files:**
- `/src/app/market-assassin/page.tsx` - Main tool page
- `/src/app/api/reports/generate-all/route.ts` - Report generation API
- `/src/app/api/pain-points/route.ts` - Pain points API

---

### 2. GovCon Content Generator
**Location:** `/src/app/content-generator/`, `/src/app/ai-content/`
**Purpose:** AI-powered LinkedIn post generator for GovCon

**Features:**
- Generate 10 LinkedIn posts per click
- 175 federal agencies supported
- GovCon-tuned AI model
- GEO Boost optimization
- Multiple content styles

**Tiers:**
- Content Engine ($197): Standard generation
- Full Fix ($397): Advanced AI, premium templates

**Key Files:**
- `/src/app/content-generator/page.tsx` - Main tool
- `/src/app/api/content-generator/generate/route.ts` - Generation API

---

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** Searchable database of federal contractors

**Features:**
- 3,500+ federal contractors
- SBLO contact information
- Teaming partner finder
- Vendor portal links
- Advanced filtering
- Export capabilities

**Price:** $497 (one-time)

**Key Files:**
- `/src/app/contractor-database/page.tsx` - Database interface
- `/src/app/api/contractors/route.ts` - Contractors API

---

### 4. Recompete Contracts Tracker
**Location:** `/src/app/expiring-contracts/`, `/src/app/recompete/`
**Purpose:** Track expiring federal contracts for recompete opportunities

**Features:**
- Contracts expiring in 12 months
- Prime contractor details
- NAICS code filtering
- Historical performance data
- Agency breakdown
- Export to CSV

**Price:** $397 (one-time)

**Key Files:**
- `/src/app/expiring-contracts/page.tsx` - Main tracker
- `/src/app/api/government-contracts/search/route.ts` - Contract search API

---

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`, `/src/app/opportunity-scout/`
**Purpose:** Find government buyers for your products/services

**Features:**
- Agency spending analysis
- Prime contractor matching
- NAICS-based targeting
- Historical spend data
- Free tier + Pro ($49)

**Key Files:**
- `/src/app/opportunity-hunter/page.tsx` - Main tool
- `/src/app/api/usaspending/find-agencies/route.ts` - USASpending API

---

### 6. Action Planner Dashboard
**Location:** `/src/app/planner/`
**Purpose:** Task management for 2026 GovCon Action Plan

**Features:**
- 5 phases, 36 total tasks
- Progress tracking with visual indicators
- Task notes and due dates
- Resource library (videos, templates)
- PDF export

**Key Files:**
- `/src/app/planner/page.tsx` - Dashboard
- `/src/app/planner/phase/[phaseId]/page.tsx` - Phase detail
- `/src/app/planner/resources/page.tsx` - Resources library
- `/src/lib/supabase/planner.ts` - Planner utilities

---

## Free Resources / PDFs

| Resource | Location |
|----------|----------|
| SBLO Directory | `/src/app/sblo-directory/` |
| Tier-2 Directory | `/src/app/tier2-directory/` |
| December Spend Forecast | `/src/app/december-spend/` |
| AI Prompts (75+) | `/src/app/ai-prompts/` |
| 2026 Action Plan | `/src/app/action-plan-2026/` |
| Guides & Templates | `/src/app/guides-templates/` |
| Tribal Contractor List | `/src/app/tribal-list/` |
| Expiring Contracts CSV | `/src/app/expiring-contracts-csv/` |

---

## Directory Structure

```
src/
├── app/
│   ├── api/                      # API routes
│   │   ├── stripe-webhook/       # Stripe payment handling
│   │   ├── content-generator/    # AI content generation
│   │   ├── reports/              # Market Assassin reports
│   │   ├── contractors/          # Database APIs
│   │   ├── usaspending/          # USASpending integration
│   │   └── ...
│   ├── market-assassin/          # Market Assassin tool
│   ├── content-generator/        # Content Generator tool
│   ├── contractor-database/      # Contractor Database
│   ├── expiring-contracts/       # Recompete Tracker
│   ├── opportunity-hunter/       # Opportunity Hunter
│   ├── planner/                  # Action Planner
│   ├── store/                    # Shop page
│   ├── bundles/                  # Bundle landing pages
│   ├── admin/                    # Admin panel
│   └── ...
├── components/
│   ├── BundleProductPage.tsx     # Bundle landing template
│   ├── ProductPageAppSumo.tsx    # Product page template
│   ├── PurchaseGate.tsx          # Access gate component
│   └── ...
└── lib/
    ├── products.ts               # Product config & Stripe URLs
    ├── send-email.ts             # Email templates
    └── supabase/
        ├── client.ts             # Supabase client
        ├── user-profiles.ts      # User/access management
        └── planner.ts            # Planner utilities
```

---

## Products & Pricing

### Individual Products
| Product | Price | Stripe Metadata |
|---------|-------|-----------------|
| Opportunity Hunter Pro | $49 | `tier: hunter_pro` |
| AI Content Generator | $197 | `tier: content_standard` |
| Market Assassin Standard | $297 | `tier: assassin_standard` |
| Content Generator Full Fix | $397 | `tier: content_full_fix` |
| Recompete Contracts Tracker | $397 | `tier: recompete` |
| Federal Contractor Database | $497 | `tier: contractor_db` |
| Market Assassin Premium | $497 | `tier: assassin_premium` |

### Upgrades
| Upgrade | Price | Stripe Metadata |
|---------|-------|-----------------|
| MA Premium Upgrade | $200 | `tier: assassin_premium_upgrade` |
| Content Full Fix Upgrade | $200 | `tier: content_full_fix_upgrade` |

### Bundles
| Bundle | Price | Value | Savings |
|--------|-------|-------|---------|
| Starter Bundle | $697 | $943 | $246 |
| Pro Giant Bundle | $997 | $1,388 | $391 |
| Ultimate Bundle | $1,497 | $1,788 | $291 |

---

## Access Control System

### Access Flags (user_profiles table)
| Flag | Products That Grant It |
|------|------------------------|
| `access_hunter_pro` | Opp Hunter Pro, Starter, Ultimate |
| `access_content_standard` | Content Generator, Pro, Ultimate |
| `access_content_full_fix` | Content Full Fix, Ultimate |
| `access_assassin_standard` | MA Standard, Pro, Ultimate |
| `access_assassin_premium` | MA Premium, Ultimate |
| `access_recompete` | Recompete, Starter, Pro, Ultimate |
| `access_contractor_db` | Contractor DB, Starter, Pro, Ultimate |

### Purchase Flow
1. Customer clicks Buy → Stripe Checkout
2. Stripe webhook → `/api/stripe-webhook`
3. Webhook saves purchase, creates user profile, updates access flags
4. Sends license key email
5. Customer activates at `/activate`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `/src/lib/products.ts` | Product config with Stripe URLs |
| `/src/app/api/stripe-webhook/route.ts` | Payment webhook handler |
| `/src/lib/supabase/user-profiles.ts` | User & access management |
| `/src/lib/send-email.ts` | All email templates |
| `/src/app/page.tsx` | Homepage |
| `/src/app/store/page.tsx` | Shop page |

---

## Environment Variables

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Email
SMTP_USER=hello@govconedu.com
SMTP_PASSWORD=...

# OpenAI (for content generator)
OPENAI_API_KEY=sk-...
```

---

## Common Development Tasks

### Run Development Server
```bash
cd "/Users/ericcoffie/Market Assasin/market-assassin"
npm run dev
```

### Build for Production
```bash
npm run build
```

### Adding a New Tool
1. Create page in `/src/app/{tool-name}/page.tsx`
2. Create API routes in `/src/app/api/{tool-name}/`
3. Add product to `/src/lib/products.ts`
4. Add access flag logic to `/src/lib/supabase/user-profiles.ts`
5. Add email template to `/src/lib/send-email.ts`
6. Update webhook to handle the new product

### Adding a New Report to Market Assassin
1. Create API route in `/src/app/api/{report-name}/route.ts`
2. Add to report generation in `/src/app/api/reports/generate-all/route.ts`
3. Update UI to display new report

---

## Action Planner Phases

| Phase | Tasks | Type |
|-------|-------|------|
| Phase 1: Setup | 12 | One-time |
| Phase 2: Bidding | 6 | Repeatable |
| Phase 3: Business Development | 7 | Repeatable |
| Phase 4: Business Enhancement | 7 | One-time |
| Phase 5: Contract Management | 4 | Ongoing |

**Total:** 36 tasks

---

## Content Generator (Critical Details)

**Frontend:** Static HTML files in `public/content-generator/`
- `index.html` — Main content generator UI (~6000+ lines)
- `library.html` — Saved posts library
- `calendar.html` — Content calendar (FullCalendar)

**API Routes (Next.js):**
| Route | Purpose |
|-------|---------|
| `/api/agencies/lookup` | NAICS-based agency matching (USASpending API) |
| `/api/templates` | List content templates |
| `/api/generate` | Generate LinkedIn posts |
| `/api/generate-quote` | Generate quote card graphics |
| `/api/convert-post-to-carousel` | Convert post to carousel slides |
| `/api/usage` | Track daily post usage |
| `/api/usage/check` | Check usage limits |
| `/api/usage/increment` | Increment usage counter |
| `/api/verify-content-generator` | Verify user access by email |
| `/api/content-generator/generate` | Alternative generation endpoint |

**CRITICAL:** `API_BASE` in all three HTML files MUST be `''` (empty string) for same-origin API calls. NEVER set it to an external URL like `govcon-content-generator.vercel.app` — that deployment is dead.

---

## Dual Access Control System

Access is managed in TWO places (both must be considered):

### 1. Vercel KV (`@vercel/kv`) — Primary for individual tools
- **Content Generator:** `contentgen:{email}` key → checked by `hasContentGeneratorAccess()`
- **Market Assassin:** `ma:{email}` key → checked by `hasMarketAssassinAccess()`
- **Opportunity Hunter Pro:** `ospro:{email}` key
- **Contractor Database:** `dbtoken:{token}` + `dbaccess:{email}` keys
- **Recompete:** `recompete:{email}` key
- **Code:** `src/lib/access-codes.ts`

### 2. Supabase (`user_profiles` table) — Unified profile with boolean flags
- `access_content_standard`, `access_content_full_fix`
- `access_assassin_standard`, `access_assassin_premium`
- `access_hunter_pro`, `access_recompete`, `access_contractor_db`
- **Code:** `src/lib/supabase/user-profiles.ts`

### Checking user access (e.g., for support):
```bash
curl -s -X POST https://tools.govcongiants.org/api/verify-content-generator \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | All GovCon tools (active) |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Projects/linkedin-deal-magnet` | Dead Vercel deployment | Original Express backend (reference only) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.org` | Marketing funnel |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |

---

## Notes for Claude

1. **This is the DEVELOPMENT project** - For live shop.govcongiants.org changes, use `/Users/ericcoffie/govcon-shop`

2. **Products file is key** - `/src/lib/products.ts` has all Stripe URLs and product configs

3. **Two Market Assassin pages** - `/market-assassin/` and `/federal-market-assassin/` (legacy)

4. **Access is email-based** - Users enter purchase email at `/activate` to see unlocked tools (no license key required)

5. **Webhook handles everything** - Stripe webhook does triple-write: Supabase purchases + user_profiles flags + Vercel KV

6. **No Node.js on dev machine** - Can't run `npm run build` locally. Vercel handles builds on push

7. **Content Generator HTML uses same-origin API** - Never hardcode external API URLs in `public/content-generator/*.html`

8. **No Node.js on dev machine** - `npm`, `node`, `vercel` CLI are not available locally

9. **Two access systems** - Vercel KV (access-codes.ts) AND Supabase (user-profiles.ts). Check both when debugging access issues.

10. **linkedin-deal-magnet repo** - Contains agency knowledge base (31 agencies), viral hooks, and content templates. Reference only — don't deploy from there.

11. **Different Supabase databases** - market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share `user_profiles` or `purchases` tables.

12. **KV store lives HERE (market-assassin)** - Vercel KV is connected to this project via Vercel Storage integration. govcon-shop does NOT have KV write access. KV backfills and admin grants must run from tools.govcongiants.org.

13. **Admin backfill endpoints** - `/api/admin/backfill-kv` reads Stripe checkout sessions and grants KV access based on tier/bundle metadata. Use for new customer onboarding issues.

---

## Recent Work History

### February 6, 2026 (Session 3)
- **Created `/api/admin/backfill-kv`** — pulls Stripe checkout sessions, grants KV access from tier/bundle metadata
- **Backfilled 32 customers** — 22 auto-granted via Stripe metadata, 10 Opp Hunter Pro manually granted via admin endpoint
- **Discovered govcon-shop and market-assassin use DIFFERENT Supabase databases**
- KV store is only connected to market-assassin (Vercel Storage integration) — govcon-shop can't write to KV

### February 6, 2026 (Sessions 1-2)
- **govcon-shop: Removed all LemonSqueezy code** — deleted `lemonsqueezy.ts`, both webhook routes
- **govcon-shop: Created `products.ts`** — Stripe product IDs, bundle config, reverse lookup map
- **govcon-shop: Created `user-profiles.ts`** — ported from market-assassin for access flag management
- **govcon-shop: Rewrote Stripe webhook** — triple-write: Supabase purchases + user_profiles flags + Vercel KV
- **govcon-shop: Rewrote activate-license** — reads user_profiles access flags, email-only (no license key input)
- **govcon-shop: Added universal purchase confirmation email** — covers 9/12 products that were missing emails
- **govcon-shop: Verified all 12 Stripe payment link metadata** — all `tier`/`bundle` values correct
- Fixed all Stripe checkout links in govcon-shop — 5 old/dead payment links replaced
- Updated 13 files across govcon-shop
- LemonSqueezy fully canceled — all payments now through Stripe directly

### February 5, 2026
- Removed PDF carousel download — LinkedIn no longer supports PDF carousels
- Made PNG slide images the primary/only download option in carousel preview modal
- Updated help text from "Upload PDF to LinkedIn" to "Upload images to LinkedIn"
- Fixed Content Generator API URLs — replaced all hardcoded `govcon-content-generator.vercel.app` with relative paths (same-origin)
- Affected files: `public/content-generator/index.html`, `library.html`, `calendar.html`
- Verified Olga's (olga@olaexecutiveconsulting.com) Full Fix access is intact via API
- **Note:** Missing API endpoints: `/api/generate-carousel` (standalone builder) and `/api/upload-carousel` (save to library) — not yet implemented

### February 2, 2026
- Created bundle landing pages (`/bundles/starter`, `/bundles/pro`, `/bundles/ultimate`)
- Created `BundleProductPage.tsx` component
- Updated store page navigation

### January 30, 2026
- Completed Stripe integration
- Removed LemonSqueezy
- Fixed webhook to grant access without user_id
- Aligned bundle names

---

*Last Updated: February 6, 2026*
