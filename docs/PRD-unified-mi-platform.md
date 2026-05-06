# PRD: Unified Market Intelligence Platform

**Version:** 1.0
**Date:** May 5, 2026
**Author:** GovCon Giants Engineering
**Status:** Draft

---

## Executive Summary

Transform the current redirect-based tool navigation into a true single-page application (SPA) where all Market Intelligence tools render as embedded panels within `/briefings`. Design for **100K+ concurrent users** with sub-second panel switching.

---

## Problem Statement

**Current State:**
- Users click sidebar items → see "Launch Tool" buttons → redirect to separate pages
- Each page has its own layout, auth check, and data fetching
- Context is lost between tools (user must re-enter email, re-select filters)
- 5-7 second page load per tool switch
- No shared state between tools

**Desired State:**
- Single-page dashboard with instant panel switching (<200ms)
- Shared user context across all tools (email, NAICS, agencies, geography)
- Unified data layer with intelligent caching
- Progressive enhancement (panels load on-demand)

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

### 1. Panel Component Architecture

```
/briefings (page.tsx)
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

**Source:** `/src/app/federal-market-assassin/page.tsx`

**Core Functionality:**
- 5 business inputs form
- Agency multi-select (250+ agencies)
- Report type selection (4 free, 10 pro)
- AI report generation
- PDF export

**Adaptations for Panel:**
- Remove page layout wrapper
- Use shared MIContext for email/tier
- Pre-fill NAICS from user profile
- Show report history from cache

**API Endpoints Used:**
- `POST /api/reports/generate-all`
- `GET /api/budget-authority`
- `GET /api/pain-points`

**Estimated Bundle Size:** ~120KB

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
