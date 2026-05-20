# PRD: Unified Market Intelligence Platform

**Version:** 1.1
**Date:** May 18, 2026
**Author:** GovCon Giants Engineering
**Status:** In Progress - Pro polish / beta QA

---

## Executive Summary

Transform the current redirect-based tool navigation into a true single-page application (SPA) where all Mindy tools render as embedded panels within `getmindy.ai/app`. Design for **100K+ concurrent users** with sub-second panel switching.

Update: the active Mindy build is now centered on `getmindy.ai/app`. `/briefings` remains the legacy production dashboard for existing users until `/app` is complete. `/mi-beta` is no longer the product destination, but may remain as an internal/shared implementation route while the new app stabilizes.

---

## Problem Statement

**Current State:**
- Legacy users still primarily use `/briefings`.
- Mindy development is happening in `/app`, backed by the current `/mi-beta` implementation.
- The app has shared navigation and embedded panels for Today’s Intel, Source Feed, Market Research, Pipeline, Relationships, Team Access, and Proposal Assist.
- Some internal routes and API names still reference `mi-beta`.
- Market Research now has recommendation cards, feedback-aware ranking, multi-set-aside profile settings, and buyer-report fallback logic.
- Empty Market Research report panels fall back to live recommended-opportunity cards so Pro users do not land on dead `0` sections.
- Money values use compact formatting across Mindy cards and panels, including trillion-scale values such as `$1.1T`.
- New Mindy logo has been selected and needs to be applied consistently across app chrome, auth, onboarding, email, and command-center surfaces.

**Desired State:**
- Single-page dashboard with instant panel switching (<200ms)
- Shared user context across all tools (email, NAICS, agencies, geography)
- Unified data layer with intelligent caching
- Progressive enhancement (panels load on-demand)
- Canonical product URL is `getmindy.ai/app`.
- Legacy `/briefings` users migrate only after `/app` has feature parity for Free, Pro, and Teams.

---

## Mindy Pro Finish Line

Mindy Pro is currently in polish, QA, and migration work. The core value loop is present: profile setup, OAuth sign-in, recommendation ranking, feedback tuning, Market Research, Today’s Intel, pipeline saves, and Proposal Prep V1.

**Required before broad Pro migration:**
- Full browser QA for sign in, onboarding, profile updates, recommendations, details drawers, feedback, Market Research, Today’s Intel, and pipeline saves.
- Low-confidence profile nudges when NAICS, states, set-asides, target agencies, or business description are missing or too broad.
- Ranking explanations on cards and drawers so users understand why an item moved up or down.
- Opportunity details must include useful summary text, location, sub-agency/office where available, notice type, set-aside, due date, source link, and SAM.gov link.
- Summary sections must not show raw API URLs as the main summary body.
- All source URLs and email/dashboard links must be clickable.
- All alert and briefing emails must include a visible `Open Mindy Dashboard` CTA to `https://getmindy.ai/app`.
- All old MI, OH Pro, and GovCon Giants upgrade language must be replaced with Mindy Free, Mindy Pro, and Mindy Teams language.
- New Mindy logo must replace placeholder marks in app, email, onboarding, auth, and command center.
- Legacy `/briefings` users remain parked until `/app` passes the Pro QA checklist.

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Panel switch time | 5-7s (page load) | <200ms |
| Time to first interaction | 3-5s | <1s |
| Concurrent users supported | ~1,000 | 100,000+ |
| API calls per session | 15-20 (duplicate) | 5-8 (cached) |
| Bundle size (initial) | ~2MB | <500KB |
| Memory usage per tab | ~150MB | <80MB |

---

## Architecture

### Current Route Strategy

| Route | Status | Purpose |
|-------|--------|---------|
| `/app` | Active | Canonical Mindy product destination on getmindy.ai |
| `/onboarding` | Active | Supabase OAuth onboarding and profile setup |
| `/briefings` | Legacy active | Keep current paid/free users here until Mindy app is ready |
| `/mi-beta` | Internal/shared | Implementation path retained temporarily while `/app` stabilizes |

### Authentication And Signup

- Supabase OAuth is configured for Google and Microsoft/Azure.
- OAuth users land on `/onboarding` so the browser can persist the Supabase session.
- Onboarding profile saves require a real Supabase session.
- The MI session bridge remains available for dashboard APIs that expect the older MI session token.
- Email confirmation should remain enabled to reduce fake accounts.

### 1. Panel Component Architecture

```
/app (page.tsx)
├── UnifiedSidebar.tsx (navigation)
├── MIHeader.tsx (branding + user)
├── SharedContextProvider.tsx (user profile, filters)
└── PanelContainer.tsx (lazy-loaded panels)
    ├── DashboardPanel (AI Briefings)
    ├── AlertsPanel (Daily Alerts)
    ├── MarketResearchPanel (Federal Market Assassin)
    ├── ForecastsPanel ✅ (exists)
    ├── RecompetesPanel (Expiring Contracts)
    ├── ContractorsPanel (Contractor Database)
    ├── SbirPanel ✅ (exists)
    ├── GrantsPanel ✅ (exists)
    ├── PipelinePanel ✅ (exists)
    ├── ContactsPanel ✅ (exists)
    ├── ContentReaperPanel (AI Content)
    └── ActionPlannerPanel (36-Task Roadmap)
```

### 2. Shared Context Layer

```typescript
// src/context/MIContext.tsx
interface MIUserContext {
  email: string;
  tier: 'free' | 'pro' | 'team' | 'enterprise';

  // Profile data (loaded once, shared everywhere)
  profile: {
    naicsCodes: string[];
    pscCodes: string[];
    keywords: string[];
    targetAgencies: string[];
    states: string[];
    setAsides: string[];
    businessDescription: string;
  };

  // Cached data (reduces API calls)
  cache: {
    opportunities: CachedOpportunities;
    forecasts: CachedForecasts;
    contractors: CachedContractors;
    recompetes: CachedRecompetes;
  };

  // Actions
  updateProfile: (partial: Partial<Profile>) => Promise<void>;
  refreshCache: (dataType: CacheKey) => Promise<void>;
  invalidateCache: (dataType: CacheKey) => void;
}
```

### 3. Lazy Loading Strategy

```typescript
// Panel loading with React.lazy + Suspense
const panels = {
  dashboard: lazy(() => import('@/components/panels/DashboardPanel')),
  research: lazy(() => import('@/components/panels/MarketResearchPanel')),
  recompetes: lazy(() => import('@/components/panels/RecompetesPanel')),
  contractors: lazy(() => import('@/components/panels/ContractorsPanel')),
  content: lazy(() => import('@/components/panels/ContentReaperPanel')),
  planner: lazy(() => import('@/components/panels/ActionPlannerPanel')),
  // ... existing panels already work
};

// Preload adjacent panels for instant switching
function preloadAdjacentPanels(currentPanel: MIPanel) {
  const adjacentPanels = getAdjacentPanels(currentPanel);
  adjacentPanels.forEach(panel => {
    panels[panel].preload?.();
  });
}
```

### 4. Data Caching Architecture

```typescript
// src/lib/mi-cache.ts
interface CacheConfig {
  opportunities: { ttl: 5 * 60 * 1000, staleWhileRevalidate: true };
  forecasts: { ttl: 60 * 60 * 1000, staleWhileRevalidate: true };
  contractors: { ttl: 24 * 60 * 60 * 1000, staleWhileRevalidate: false };
  recompetes: { ttl: 60 * 60 * 1000, staleWhileRevalidate: true };
  userProfile: { ttl: Infinity, invalidateOn: ['profile-update'] };
}

// React Query or SWR for data fetching with caching
const useOpportunities = (filters: OpportunityFilters) => {
  return useQuery({
    queryKey: ['opportunities', filters],
    queryFn: () => fetchOpportunities(filters),
    staleTime: 5 * 60 * 1000,
    cacheTime: 30 * 60 * 1000,
    // Share cache across panels
    refetchOnWindowFocus: false,
  });
};
```

---

## Panel Specifications

### Panel 1: MarketResearchPanel (Federal Market Assassin)

**Source:** `/src/components/mi-beta/panels/MarketResearchPanel.tsx`

**Core Functionality:**
- 5 business inputs form
- Agency multi-select (250+ agencies)
- Report type selection (4 free, 10 pro)
- AI report generation
- PDF export
- Recommended opportunity cards
- Opportunity details drawer
- Opportunity detail drawers include location, office/sub-agency when available, notice type, due date, set-aside, useful summary, source links, and SAM.gov links.
- Feedback controls for "good match", "bad match", "not my industry", "too big/small", "already knew", and "more like this"
- Set-aside-aware ranking
- Small-business-first agency ranking using simplified acquisition, micro-purchase, and budget momentum signals
- Live opportunity cards render as fallbacks when generated report sections have no rows yet.

**Adaptations for Panel:**
- Remove page layout wrapper
- Use shared MIContext for email/tier
- Pre-fill NAICS from user profile
- Show report history from cache
- Fall back to target agencies and cached budget data when live agency lookup returns no buyer rows, so the dashboard does not show `0 agencies to review`.

**API Endpoints Used:**
- `POST /api/reports/generate-all`
- `GET /api/budget-authority`
- `GET /api/pain-points`
- `GET /api/mi-beta/opportunities`
- `POST /api/mindy/opportunity-feedback`

**Estimated Bundle Size:** ~120KB

**Current ranking priority:**
1. Direct NAICS / PSC / keyword fit.
2. Positive feedback and saved/tracked opportunity signals.
3. Matching set-aside certifications from the user profile.
4. Total Small Business and other small-business-friendly opportunities.
5. Buyer/agency fit, including VA downranking for non-veteran profiles.
6. Sources Sought, RFI, and Special Notice market-research signals.
7. Full and Open / unrestricted opportunities.
8. Special set-asides where the user lacks the required certification.
9. Negative feedback and dismissed opportunities.

**Agency prioritization model:**
- Simplified acquisition activity is the primary buyer-selection signal because most Mindy users are small businesses. Awards under the current `$350K` SAT threshold carry the heaviest weight.
- Micro-purchase activity under the current `$15K` threshold is treated as a fast-entry signal for new past performance.
- Budget Checkup momentum is used as a growth signal, so agencies with expanding FY2026 budget authority rank above flat or declining agencies when accessibility is comparable.
- Raw total spend remains useful, but it is a tie-breaker behind accessibility and budget momentum.

**Set-aside rules:**
- Users can select multiple set-asides in profile settings.
- SDVOSB, VOSB, 8(a), WOSB, EDWOSB, HUBZone, and tribal/native set-asides are downranked unless the profile includes that status.
- Total Small Business is upranked for small business profiles.
- Sources Sought, RFI, and Special Notice notices remain visible even when set-aside fit is weak because they are research/positioning signals.

**Agency fit rules:**
- Veterans Affairs is not a default buyer recommendation for non-veteran profiles because most VA pursuit fit skews toward SDVOSB, VOSB, and veteran-owned firms.
- VA can rank normally for profiles that include SDVOSB, VOSB, veteran-owned, or service-disabled veteran-owned status.
- VA Sources Sought, RFI, and Special Notice records can remain visible for non-veteran users, but should rank as lower-priority research signals.

**Opportunity detail quality rules:**
- Use the most specific buyer label available: contracting office, sub-agency, or office beats broad department names such as `DEPT OF DEFENSE`.
- Show place of performance and contracting office location when available; geography is part of the fit decision.
- Do not duplicate `NAICS` and `set-aside` lines in the same card body.
- If set-aside is missing or unrestricted, display `Full and Open` or `No set-aside listed` once.
- Raw API URLs should be hidden behind readable labels such as `SAM.gov source`, `Notice details`, or `Attachments`.
- Details drawers must have a clear close path and a persistent `Open on SAM.gov` action.

---

### Panel 2: RecompetesPanel (Expiring Contracts)

**Source:** `/src/app/recompete/page.tsx`

**Core Functionality:**
- USASpending expiring contracts table
- Filters: NAICS, Agency, State, Value, Expiration
- CSV/Excel/PDF export
- Pagination (100 per page)

**Adaptations for Panel:**
- Auto-apply user's NAICS profile as default filter
- Share filter state with Pipeline (one-click add)
- Virtual scrolling for 12K+ rows

**API Endpoints Used:**
- `GET /api/recompetes` (or direct USASpending MCP)
- `POST /api/pipeline` (add to tracking)

**Estimated Bundle Size:** ~80KB

---

### Panel 3: ContractorsPanel (Contractor Database)

**Source:** `/src/app/contractor-database/page.tsx`

**Core Functionality:**
- 3,500+ contractors with SBLO contacts
- Search by name, NAICS, agency, certifications
- Contact export (CSV)
- Teaming outreach tracking

**Adaptations for Panel:**
- Integrate with ContactsPanel (shared CRM data)
- "Add to Contacts" one-click
- Virtual scrolling for large result sets

**API Endpoints Used:**
- `GET /api/contractors` (Supabase)
- `POST /api/teaming` (add partner)

**Estimated Bundle Size:** ~60KB

---

### Panel 4: ContentReaperPanel (AI Content Generator)

**Source:** `/src/app/content-generator/page.tsx` + `/public/content-generator/`

**Core Functionality:**
- Agency pain point selection
- Content type selection (LinkedIn, capability, email)
- AI generation (30 posts per click)
- Bulk export (.docx, .zip)

**Adaptations for Panel:**
- Use shared MIContext for agency targets
- Pre-select agencies from user profile
- Show generation history
- Rate limit display (10/day)

**API Endpoints Used:**
- `POST /api/content-generator/generate`
- `GET /api/pain-points`

**Estimated Bundle Size:** ~100KB

---

### Panel 5: ActionPlannerPanel (36-Task Roadmap)

**Source:** `/src/app/planner/page.tsx`

**Core Functionality:**
- 5 phases, 36 tasks
- Progress tracking (per user)
- Task completion with notes
- Resources and lessons
- PDF export

**Adaptations for Panel:**
- Persist progress to Supabase (not localStorage)
- Link tasks to actual tools (e.g., "Complete Market Research" → opens research panel)
- Show contextual tips based on pipeline stage

**API Endpoints Used:**
- `GET/POST /api/planner/progress`
- `GET /api/planner/resources`

**Estimated Bundle Size:** ~90KB

---

## Database Schema Additions

### User Progress Table (Action Planner)

```sql
CREATE TABLE user_planner_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  phase_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, phase_id, task_id)
);

CREATE INDEX idx_planner_progress_email ON user_planner_progress(user_email);
```

### Panel Usage Analytics

```sql
CREATE TABLE panel_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  panel_name TEXT NOT NULL,
  action TEXT NOT NULL, -- 'view', 'generate', 'export', 'search'
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- For 100K users: partition by month
CREATE INDEX idx_panel_usage_email_date ON panel_usage(user_email, created_at DESC);
```

---

## Performance Requirements (100K Users)

### Client-Side

| Requirement | Target |
|-------------|--------|
| Initial bundle (critical) | <500KB gzipped |
| Panel chunk size (max) | <150KB each |
| First Contentful Paint | <1.5s |
| Time to Interactive | <3s |
| Panel switch (cached) | <100ms |
| Panel switch (fresh) | <500ms |
| Memory per tab | <80MB |

### Server-Side

| Requirement | Target |
|-------------|--------|
| API response (cached) | <50ms |
| API response (DB query) | <200ms |
| API response (AI generation) | <10s |
| Concurrent API connections | 10,000+ |
| Database connections pool | 100 |
| Cache hit rate | >80% |

### Caching Strategy

```
Layer 1: Browser (React Query)
├── User profile: Infinity (until logout)
├── Opportunities: 5 minutes
├── Forecasts: 1 hour
└── Contractors: 24 hours

Layer 2: Edge (Vercel KV)
├── SAM.gov responses: 1 hour
├── USASpending responses: 24 hours
└── AI generations: 7 days (per input hash)

Layer 3: Database (Supabase)
├── sam_opportunities: 24 hours refresh
├── agency_forecasts: weekly refresh
└── contractors: monthly refresh
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `MIContext` provider with shared state
- [ ] Implement lazy loading infrastructure
- [ ] Add React Query for data caching
- [ ] Create `PanelContainer` with Suspense boundaries
- [ ] Add loading skeletons for each panel type

### Phase 2: Simple Panels (Week 2)
- [ ] **ContractorsPanel** — Extract from contractor-database
- [ ] **RecompetesPanel** — Extract from recompete
- [ ] Wire up shared profile filters
- [ ] Add virtual scrolling for large tables
- [ ] Test with 10K+ rows

### Phase 3: Complex Panels (Week 3)
- [ ] **MarketResearchPanel** — Extract from federal-market-assassin
- [ ] **ContentReaperPanel** — Extract from content-generator
- [ ] Handle multi-step wizards in panel context
- [ ] Add generation progress indicators
- [ ] Implement rate limiting UI

### Phase 4: Action Planner (Week 4)
- [ ] **ActionPlannerPanel** — Extract from planner
- [ ] Create `user_planner_progress` table
- [ ] Migrate localStorage to Supabase
- [ ] Link tasks to panel actions
- [ ] Add phase completion celebrations

### Phase 5: Polish & Scale (Week 5)
- [ ] Performance audit (Lighthouse, Web Vitals)
- [ ] Load testing (k6 with 100K simulated users)
- [ ] Error boundaries per panel
- [ ] Offline support (critical data)
- [ ] Analytics integration

---

## File Structure

```
src/
├── context/
│   └── MIContext.tsx              # Shared user/cache context
├── components/
│   └── panels/
│       ├── index.ts               # Lazy exports
│       ├── PanelContainer.tsx     # Suspense wrapper
│       ├── PanelSkeleton.tsx      # Loading states
│       ├── MarketResearchPanel.tsx
│       ├── RecompetesPanel.tsx
│       ├── ContractorsPanel.tsx
│       ├── ContentReaperPanel.tsx
│       └── ActionPlannerPanel.tsx
├── hooks/
│   ├── useOpportunities.ts        # React Query hooks
│   ├── useForecasts.ts
│   ├── useContractors.ts
│   ├── useRecompetes.ts
│   └── usePlannerProgress.ts
└── lib/
    ├── mi-cache.ts                # Cache configuration
    └── panel-preload.ts           # Preload strategy
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Bundle size explosion | Code splitting + dynamic imports |
| Memory leaks (long sessions) | Panel unmount cleanup, cache limits |
| API rate limits | Client-side request deduplication |
| Stale data | SWR with background revalidation |
| Auth token expiry | Silent refresh, graceful re-auth |
| Panel crash affects all | Error boundaries per panel |

---

## Dependencies

### New Packages

```json
{
  "@tanstack/react-query": "^5.x",      // Data fetching + caching
  "@tanstack/react-virtual": "^3.x",    // Virtual scrolling
  "zustand": "^4.x"                      // Lightweight state (optional)
}
```

### Existing (No Changes)

- Next.js 16 (App Router)
- Supabase (Database)
- Vercel KV (Edge Cache)
- Tailwind CSS (Styling)

---

## Success Criteria

### MVP (Week 2)
- [ ] 2 panels fully embedded (Contractors + Recompetes)
- [ ] Panel switch < 500ms
- [ ] Shared profile context working
- [ ] No regressions in existing panels

### Full Launch (Week 5)
- [ ] All 5 new panels embedded
- [ ] 100K user load test passed
- [ ] Lighthouse Performance > 90
- [ ] Error rate < 0.1%
- [ ] User session duration +30%

---

## Appendix: Component Migration Checklist

For each panel migration:

- [ ] Extract core JSX from page.tsx
- [ ] Remove page-level layout/wrapper
- [ ] Replace `useSearchParams` with props
- [ ] Use `MIContext` for email/tier
- [ ] Pre-fill from user profile where applicable
- [ ] Add error boundary wrapper
- [ ] Add loading skeleton
- [ ] Test standalone rendering
- [ ] Test within PanelContainer
- [ ] Verify no style conflicts
- [ ] Check bundle size impact
- [ ] Update CLAUDE.md with new component

---

*End of PRD*
