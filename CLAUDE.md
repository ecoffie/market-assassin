# Market Assassin - Claude Project Context

## Critical Rules

1. **No Framer.** Do not use any Framer MCP tools. This is a pure Next.js/React codebase.
2. **No Node.js on dev machine.** `npm`, `node`, `vercel` CLI are not available locally. Vercel handles builds on push.
3. **This is the DEVELOPMENT project.** Deploys to `tools.govcongiants.org`. For live `shop.govcongiants.org` changes, use `/Users/ericcoffie/govcon-shop`.
4. **Content Reaper `API_BASE` must be `''`** (empty string) in all `public/content-generator/*.html` files. Never set to an external URL — `govcon-content-generator.vercel.app` is dead.
5. **Different Supabase databases.** market-assassin and govcon-shop have SEPARATE Supabase instances. They do NOT share tables.
6. **KV store connected to BOTH projects** via Vercel Storage integration. KV backfills can run from either project.

---

## Project Overview

**Name:** Market Assassin (GovCon Tools Platform)
**Framework:** Next.js 16.1.1 with Turbopack, React 19, TypeScript, Tailwind CSS
**Database:** Supabase (PostgreSQL) | **Payments:** Stripe | **Email:** SMTP | **PDF:** jsPDF
**Roadmap:** See [`TOOL-BUILD.md`](./TOOL-BUILD.md)

---

## Related Projects

| Project | Location | Deploys To | Purpose |
|---------|----------|------------|---------|
| **Market Assassin** | This project | `tools.govcongiants.org` | Dev/staging tools |
| **GovCon Shop** | `/Users/ericcoffie/govcon-shop` | `shop.govcongiants.org` | Live shop (production) |
| **GovCon Funnels** | `/Users/ericcoffie/govcon-funnels` | `govcongiants.org` | Marketing funnel |
| **Action Planner** | `/Users/ericcoffie/Projects/govcon-planner` | GitHub: `ecoffie/action-planner` | Standalone planner (copy, not move) |
| **LinkedIn Deal Magnet** | `/Users/ericcoffie/Projects/linkedin-deal-magnet` | Dead | Reference only (31-agency knowledge base) |

---

## Tools Built

### 1. Federal Market Assassin
**Location:** `/src/app/market-assassin/`, `/src/app/federal-market-assassin/` (legacy)
**Purpose:** Market intelligence — 5 inputs + agency selection → 4-8 strategic reports
**Tiers:** Standard ($297, 4 reports) | Premium ($497, 8 reports)
**Key Files:** `market-assassin/page.tsx`, `api/reports/generate-all/route.ts`, `api/pain-points/route.ts`

### 2. Content Reaper
**Location:** `/src/app/content-generator/`, `/src/app/ai-content/`
**Purpose:** AI LinkedIn post generator — up to 30 posts/click, 250 agencies, bulk .docx/.zip export
**Tiers:** Content Engine ($197) | Full Fix ($397, advanced AI + visuals)
**Key Files:** `content-generator/page.tsx`, `api/content-generator/generate/route.ts`

### 3. Federal Contractor Database
**Location:** `/src/app/contractor-database/`
**Purpose:** 3,500+ federal contractors with SBLO contacts, filtering, export
**Price:** $497
**Key Files:** `contractor-database/page.tsx`, `api/contractors/route.ts`

### 4. Recompete Tracker
**Location:** `/src/app/expiring-contracts/`, `/src/app/recompete/`
**Purpose:** Track expiring federal contracts for recompete opportunities
**Price:** $397
**Key Files:** `expiring-contracts/page.tsx`, `api/government-contracts/search/route.ts`

### 5. Opportunity Hunter
**Location:** `/src/app/opportunity-hunter/`, `/src/app/opportunity-scout/`
**Purpose:** Find government buyers — agency spending analysis, NAICS targeting
**Price:** Free + Pro ($49)
**Key Files:** `opportunity-hunter/page.tsx`, `api/usaspending/find-agencies/route.ts`

### 6. Action Planner
**Location:** `/src/app/planner/`
**Purpose:** Task management — 5 phases, 36 tasks, progress tracking, PDF export
**Key Files:** `planner/page.tsx`, `planner/phase/[phaseId]/page.tsx`, `lib/supabase/planner.ts`

---

## Free Resources

All require email capture before download (via `ProductPageAppSumo` email gate → `/api/capture-lead`).

| Resource | Page | Download File |
|----------|------|---------------|
| SBLO Directory | `/src/app/sblo-directory/` | `/public/resources/sblo-contact-list.html` |
| Tier-2 Directory | `/src/app/tier2-directory/` | `/public/resources/tier2-supplier-list.html` |
| December Spend Forecast | `/src/app/december-spend/` | `/public/resources/december-spend-forecast.html` |
| AI Prompts (75+) | `/src/app/ai-prompts/` | `/public/resources/ai-prompts-govcon.html` |
| 2026 Action Plan | `/src/app/action-plan-2026/` | `/public/resources/action-plan-2026.html` |
| Guides & Templates | `/src/app/guides-templates/` | `/public/resources/govcon-guides-templates.html` |
| Tribal Contractor List | `/src/app/tribal-list/` | `/public/resources/tribal-contractor-list.csv` |
| Expiring Contracts CSV | `/src/app/expiring-contracts-csv/` | `/public/resources/expiring-contracts-sample.csv` |

**Templates:** `public/templates/capability-statement-template.html`, `email-scripts-sblo.html`, `proposal-checklist.html`

---

## Products & Pricing

### Individual Products
| Product | Price | Stripe Metadata |
|---------|-------|-----------------|
| Opportunity Hunter Pro | $49 | `tier: hunter_pro` |
| Content Reaper | $197 | `tier: content_standard` |
| Market Assassin Standard | $297 | `tier: assassin_standard` |
| Content Reaper Full Fix | $397 | `tier: content_full_fix` |
| Recompete Tracker | $397 | `tier: recompete` |
| Federal Contractor Database | $497 | `tier: contractor_db` |
| Market Assassin Premium | $497 | `tier: assassin_premium` |

### Upgrades
| Upgrade | Price | Stripe Metadata |
|---------|-------|-----------------|
| MA Premium Upgrade | $200 | `tier: assassin_premium_upgrade` |
| Content Full Fix Upgrade | $200 | `tier: content_full_fix_upgrade` |

### Bundles
| Bundle | Price | Includes |
|--------|-------|----------|
| Starter ($697) | $943 value | Opp Hunter Pro, Recompete, Contractor DB |
| Pro Giant ($997) | $1,388 value | Contractor DB, Recompete, MA Standard, Content Gen |
| Ultimate ($1,497) | $1,788 value | Content Full Fix, Contractor DB, Recompete, MA Premium |

---

## Access Control System

Access is managed in TWO places (both must be considered):

### Vercel KV (`@vercel/kv`) — Primary, gates actual tool access
| Tool | KV Key | Check Function |
|------|--------|----------------|
| Content Reaper | `contentgen:{email}` | `hasContentGeneratorAccess()` |
| Market Assassin | `ma:{email}` | `hasMarketAssassinAccess()` |
| Opportunity Hunter Pro | `ospro:{email}` | — |
| Contractor Database | `dbtoken:{token}` + `dbaccess:{email}` | — |
| Recompete | `recompete:{email}` | — |

**Code:** `src/lib/access-codes.ts`

### Supabase (`user_profiles` table) — Unified profile with boolean flags
`access_content_standard`, `access_content_full_fix`, `access_assassin_standard`, `access_assassin_premium`, `access_hunter_pro`, `access_recompete`, `access_contractor_db`

**Code:** `src/lib/supabase/user-profiles.ts`

### Purchase Flow (Triple-Write)
1. Customer buys via Stripe → webhook at `/api/stripe-webhook`
2. Webhook writes: Supabase `purchases` + `user_profiles` flags + Vercel KV
3. Sends confirmation email
4. Customer activates at `/activate` (email-only, no license key)

### Checking Access (for support)
```bash
curl -s -X POST https://tools.govcongiants.org/api/verify-content-generator \
  -H "Content-Type: application/json" -d '{"email":"user@example.com"}'
```

---

## Data Systems

### Agency Pain Points & Priorities
- **Database:** `src/data/agency-pain-points.json` — 250 agencies, 2,765 pain points, 2,500 spending priorities
- **Admin:** `/api/admin/build-pain-points?password=galata-assassin-2026` (`?mode=preview`, `?agency=X`, `?type=priorities`)
- **API:** `/api/pain-points` — returns `painPoints[]` and `priorities[]`
- **Used by:** Content Reaper (Step 2 prompt), Market Assassin (reports + cross-reference engine), Opportunity Hunter (agency modal)
- **Key files:** `src/lib/utils/pain-points.ts`, `src/lib/utils/pain-point-generator.ts`, `src/lib/utils/federal-oversight-data.ts`

### FY2026 Budget Authority
- **Cached data:** `src/data/agency-budget-data.json` — 47 toptier agencies
- **Sub-agency mapping:** `SUB_AGENCY_PARENT_MAP` in `budget-authority.ts` — 175 entries, 218/250 agencies (87%) resolve
- **Admin:** `/api/admin/build-budget-data?password=...&mode=build`
- **Public API:** `/api/budget-authority` — supports `?agency=`, `?type=winners|losers`, `?limit=N`
- **Key files:** `src/lib/utils/budget-authority.ts`, `src/data/agency-toptier-codes.json`

### SAT Entry Point Analysis
- Zero extra API calls — SAT (≤$250K) and micro (≤$10K) computed during existing award aggregation
- Agency type fields: `satSpending`, `satContractCount`, `microSpending`, `microContractCount`
- Market Assassin Premium: Entry Points tab with `satFriendlinessScore` (0-100)
- Opportunity Hunter: blurred SAT teaser → upgrade CTA to Market Assassin

---

## Content Reaper Internals

**Frontend:** Static HTML in `public/content-generator/` — `index.html` (~6000+ lines), `library.html`, `calendar.html`

**API Routes:**
| Route | Purpose |
|-------|---------|
| `/api/agencies/lookup` | NAICS-based agency matching |
| `/api/templates` | List content templates |
| `/api/generate` | Generate LinkedIn posts |
| `/api/generate-quote` | Generate quote card graphics |
| `/api/convert-post-to-carousel` | Post → carousel slides |
| `/api/usage`, `/api/usage/check`, `/api/usage/increment` | Usage tracking |
| `/api/verify-content-generator` | Verify access by email |
| `/api/content-generator/generate` | Alternative generation endpoint |

**CDN Libraries:** `docx@9.0.2` (.docx export), `jszip@3.10.1` (zip bundling), `file-saver@2.0.5` (`saveAs()`)

**Formatting:** API preserves `**bold**`/`*italic*` markdown. `renderMarkdown()` converts to HTML for display. `stripMarkdown()` removes markers for clipboard/graphics. Two display functions: `displayQuickGeneratedPosts()` (quick flow), `displayPosts()` (full flow).

**Generation:** Thought leadership tone (not sales pitches). 20 `CONTENT_LENSES` shuffled per generation. `previousAngles[]` from localStorage history prevents repetition. Temperature: Step 2 = 0.85, Step 3 = 0.7.

---

## Key Files & Directory Structure

| File | Purpose |
|------|---------|
| `src/lib/products.ts` | Product config with Stripe URLs (source of truth) |
| `src/app/api/stripe-webhook/route.ts` | Payment webhook — triple-write handler |
| `src/lib/supabase/user-profiles.ts` | User & access flag management |
| `src/lib/access-codes.ts` | Vercel KV access checking |
| `src/lib/send-email.ts` | All email templates |
| `src/app/page.tsx` | Homepage |
| `src/app/store/page.tsx` | Shop page |
| `src/components/BundleProductPage.tsx` | Bundle landing page template |
| `src/components/ProductPageAppSumo.tsx` | Product page template (includes email gate) |
| `src/components/federal-market-assassin/tables/AgencySelectionTable.tsx` | Agency selection with badges |
| `src/components/federal-market-assassin/reports/ReportsDisplay.tsx` | Report display with tabs |
| `src/components/federal-market-assassin/forms/CoreInputForm.tsx` | Business type + NAICS input |

```
src/
├── app/
│   ├── api/               # stripe-webhook, content-generator, reports, contractors, usaspending, admin
│   ├── market-assassin/   # Market Assassin tool
│   ├── content-generator/ # Content Reaper tool
│   ├── contractor-database/, expiring-contracts/, opportunity-hunter/, planner/
│   ├── store/, bundles/, admin/
│   └── [free resource pages]
├── components/            # BundleProductPage, ProductPageAppSumo, PurchaseGate, federal-market-assassin/
├── data/                  # agency-pain-points.json, agency-budget-data.json, agency-toptier-codes.json
└── lib/                   # products.ts, send-email.ts, access-codes.ts, supabase/, utils/
```

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
```

---

## Common Development Tasks

### Adding a New Tool
1. Create page in `/src/app/{tool-name}/page.tsx`
2. Create API routes in `/src/app/api/{tool-name}/`
3. Add product to `/src/lib/products.ts`
4. Add access flag logic to `/src/lib/supabase/user-profiles.ts`
5. Add email template to `/src/lib/send-email.ts`
6. Update webhook to handle the new product

### Adding a New Market Assassin Report
1. Create API route in `/src/app/api/{report-name}/route.ts`
2. Add to `/src/app/api/reports/generate-all/route.ts`
3. Update ReportsDisplay UI

---

## Recent Work History

> Full session history (Sessions 1-18) is in MEMORY.md.

### Session 18 (Feb 21, 2026)
- Fixed all 8 free download pages — `checkoutUrl` pointing to actual resource files
- Added email gate to `ProductPageAppSumo` for free resources (captures leads to Supabase)
- Expanded `/free-resources` page: 5 → 11 resources
- Store page fixes: Content Reaper link, agency count 175 → 250

### Session 17 (Feb 18, 2026)
- SAT Entry Point Analysis — zero extra API calls, computed during existing aggregation
- Market Assassin Premium: Entry Points tab with satFriendlinessScore ranking
- AgencySelectionTable: 5 sort mode pills, "Easy Entry" badge for >50% SAT agencies
- Opportunity Hunter: blurred SAT teaser with Market Assassin upgrade CTA
- FY2026 budget data expanded: 23 → 47 toptier agencies, 175-entry sub-agency parent map

*Last Updated: February 24, 2026*
