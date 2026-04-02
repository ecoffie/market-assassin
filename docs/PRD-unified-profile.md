# PRD: Unified User Profile System

## Problem Statement

Currently, user business data is fragmented across multiple tables:
- `user_profiles` - access flags, Stripe info
- `user_notification_settings` - alerts/briefings preferences
- `user_briefing_profile` - detailed business profile

**Pain points:**
1. User enters NAICS in Market Assassin form but it doesn't auto-fill in Alerts
2. Content Reaper doesn't know user's industry to suggest topics
3. Recompete Tracker doesn't filter by user's NAICS
4. Contractor Database doesn't highlight teaming partners in user's space
5. Each tool asks for the same info repeatedly

---

## Key UX Principles

### 1. Industry-First Selection (Not NAICS-First)
Users don't know NAICS codes. They know their industry.

**Current UI (keep this):**
```
┌─────────────────────────────────────────┐
│  🎯 What Opportunities?                 │
│                                         │
│  Quick Select by Industry               │
│                                         │
│  [🏗️ Construction ✓]  [💻 IT Services]  │
│  [🔒 Cybersecurity]   [📊 Professional] │
│  [🏥 Healthcare]      [📦 Logistics]    │
│  [🔧 Facilities]      [🎓 Training]     │
│                                         │
│  ↓ Auto-expands to NAICS codes          │
│                                         │
│  💡 Pro tip: Use 3-digit codes (236)    │
│     to match entire industries          │
└─────────────────────────────────────────┘
```

User clicks "Construction" → System auto-populates:
- `236` (all building construction)
- `238` (all specialty trades)
- Related PSC codes

**User never has to know NAICS codes.** They just pick their industry.

### 2. Smart Expansion (Background Intelligence)
System automatically expands user's profile to catch more opportunities:

| User Selects | System Adds (Behind the Scenes) |
|--------------|--------------------------------|
| NAICS 541512 | Related: 541511, 541519, 518210 |
| "Cybersecurity" | Keywords: "zero trust", "CMMC", "FedRAMP" |
| State: FL | Includes: Remote/Telework opportunities |

User doesn't configure this. It happens automatically.

### 3. Cross-Reference Intelligence (Not User Work)
System finds mislabeled/miscategorized opportunities by cross-referencing:

| Signal | What System Does |
|--------|------------------|
| PSC codes | Search PSC even when NAICS doesn't match |
| Keywords | Find opps with wrong NAICS but right keywords |
| Agency patterns | "VA usually posts IT under 541512 but sometimes 518210" |

**Example:** User is NAICS 541512 (IT). System also searches:
- PSC D302, D306, D307 (IT services PSC codes)
- Keywords: "software", "cloud", "cybersecurity"
- Catches: VA opportunity miscategorized as 541990 but has "IT support" in title

**This is intelligence, not configuration.** User sets profile once, system does the work.

---

## Solution: Single Profile Table

### New Table: `govcon_profiles`

One canonical source for all business information, read by every tool.

```sql
CREATE TABLE govcon_profiles (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Company Info
  company_name TEXT,
  cage_code TEXT,              -- 5-char CAGE
  uei TEXT,                    -- 12-char UEI (replaced DUNS)
  sam_status TEXT,             -- 'active', 'inactive', 'pending'

  -- Business Classification
  naics_codes TEXT[] DEFAULT '{}',           -- Primary codes user works in
  naics_primary TEXT,                         -- Single primary code
  psc_codes TEXT[] DEFAULT '{}',             -- Product Service Codes
  business_type TEXT,                         -- 'small', 'wosb', 'sdvosb', 'hubzone', '8a', etc.
  certifications TEXT[] DEFAULT '{}',         -- ['8a', 'SDVOSB', 'HUBZone', 'WOSB', 'EDWOSB']

  -- Size & Revenue
  company_size TEXT,                          -- 'micro', 'small', 'medium', 'large'
  employee_count INTEGER,
  annual_revenue NUMERIC,

  -- Location
  state TEXT,                  -- 2-letter code
  states TEXT[] DEFAULT '{}', -- Multi-state if operates in multiple
  zip_code TEXT,
  geographic_scope TEXT,       -- 'local', 'regional', 'national'

  -- Capabilities
  capability_keywords TEXT[] DEFAULT '{}',    -- ['cybersecurity', 'cloud migration', etc.]
  contract_vehicles TEXT[] DEFAULT '{}',      -- ['GSA Schedule', 'SEWP V', 'OASIS']

  -- Target Market
  target_agencies TEXT[] DEFAULT '{}',        -- ['DOD', 'VA', 'DHS']
  past_performance_agencies TEXT[] DEFAULT '{}',

  -- Notification Preferences
  alerts_enabled BOOLEAN DEFAULT true,
  briefings_enabled BOOLEAN DEFAULT true,
  alert_frequency TEXT DEFAULT 'daily',       -- 'daily', 'weekly', 'realtime'
  timezone TEXT DEFAULT 'America/New_York',

  -- API Keys (User's Own - Optional)
  sam_api_key TEXT,                           -- User's own SAM.gov API key (encrypted)
  sam_api_key_valid BOOLEAN DEFAULT false,    -- Validated against SAM.gov
  sam_api_key_added_at TIMESTAMPTZ,
  use_own_api_key BOOLEAN DEFAULT false,      -- Prefer user's key over shared

  -- Smart Expansion (System-Generated, Not User-Configured)
  expanded_naics TEXT[] DEFAULT '{}',         -- Related NAICS auto-added by system
  expanded_psc TEXT[] DEFAULT '{}',           -- PSC codes derived from NAICS
  expanded_keywords TEXT[] DEFAULT '{}',      -- Keywords inferred from industry
  industry_category TEXT,                      -- 'construction', 'it', 'healthcare', etc.

  -- Behavioral Data (auto-populated)
  naics_weights JSONB DEFAULT '{}',           -- { "541512": 0.8, "541611": 0.5 }
  agency_weights JSONB DEFAULT '{}',
  search_history JSONB DEFAULT '[]',          -- Last 100 searches
  clicked_opportunities TEXT[] DEFAULT '{}',
  engagement_score INTEGER DEFAULT 0,

  -- Profile Quality
  completeness_score INTEGER DEFAULT 0,       -- 0-100%
  last_activity_at TIMESTAMPTZ,
  onboarding_completed BOOLEAN DEFAULT false
);

-- Indexes
CREATE INDEX idx_govcon_profiles_email ON govcon_profiles(email);
CREATE INDEX idx_govcon_profiles_naics ON govcon_profiles USING GIN(naics_codes);
CREATE INDEX idx_govcon_profiles_state ON govcon_profiles(state);
CREATE INDEX idx_govcon_profiles_business_type ON govcon_profiles(business_type);
```

---

## Background Intelligence Logic

### When Profile is Saved, System Auto-Generates:

```typescript
async function expandProfileIntelligence(profile: GovConProfile) {
  // 1. Expand NAICS to related codes
  const expandedNaics = await getRelatedNaicsCodes(profile.naics_codes);
  // 541512 → [541511, 541519, 518210, 519130]

  // 2. Cross-reference to PSC codes
  const expandedPsc = await naicsToPscCrosswalk(profile.naics_codes);
  // 541512 → [D302, D306, D307, D308, D310, D399]

  // 3. Infer keywords from industry
  const expandedKeywords = await getIndustryKeywords(profile.industry_category);
  // 'it' → ['software', 'cloud', 'cybersecurity', 'devops', 'IT support']

  // 4. Save back to profile (user never sees this)
  await updateGovConProfile(profile.email, {
    expanded_naics: expandedNaics,
    expanded_psc: expandedPsc,
    expanded_keywords: expandedKeywords,
  });
}
```

### Search Logic Uses All Signals:

```typescript
async function findOpportunities(email: string) {
  const profile = await getGovConProfile(email);

  // Search with ALL signals (user's + system-expanded)
  const allNaics = [...profile.naics_codes, ...profile.expanded_naics];
  const allPsc = [...profile.psc_codes, ...profile.expanded_psc];
  const allKeywords = [...profile.capability_keywords, ...profile.expanded_keywords];

  // Parallel searches to catch mislabeled opportunities
  const [byNaics, byPsc, byKeywords] = await Promise.all([
    searchByNaics(allNaics),
    searchByPsc(allPsc),
    searchByKeywords(allKeywords),
  ]);

  // Merge, dedupe, score by relevance
  return mergeAndScore([byNaics, byPsc, byKeywords], profile);
}
```

### Why This Matters

**Without cross-referencing:** User misses 20-30% of relevant opportunities because:
- Agency posted under wrong NAICS
- Opportunity uses PSC code instead of NAICS
- Title/description has keywords but wrong category

**With cross-referencing:** System catches mislabeled opps automatically. User just sets profile once.

---

## Tool Integration Points

### 1. Market Assassin
**Current:** Asks for business type, NAICS, ZIP, veteran status each time
**After:** Pre-fills from `govcon_profiles`, saves back on submit

```typescript
// On page load
const profile = await getGovConProfile(email);
setBusinessType(profile.business_type);
setNaicsCode(profile.naics_primary || profile.naics_codes[0]);
setZipCode(profile.zip_code);

// On report generation (save back)
await updateGovConProfile(email, {
  naics_codes: addIfNotExists(profile.naics_codes, inputNaics),
  last_activity_at: new Date()
});
```

### 2. Content Reaper
**Current:** Generic topic selection
**After:** Suggests topics based on NAICS and capability keywords

```typescript
const profile = await getGovConProfile(email);
const suggestedTopics = await getSuggestedTopics(profile.naics_codes, profile.capability_keywords);
// Shows: "Based on your profile: Cybersecurity, Cloud Migration, IT Modernization"
```

### 3. Recompete Tracker
**Current:** Manual NAICS filter
**After:** Auto-filters to user's NAICS, highlights best matches

```typescript
const profile = await getGovConProfile(email);
const recompetes = await fetchRecompetes({ naics: profile.naics_codes });
// Highlight contracts matching user's certifications as set-aside opportunities
```

### 4. Contractor Database
**Current:** Manual search
**After:** "Find teaming partners" button shows contractors in same NAICS + complementary capabilities

```typescript
const profile = await getGovConProfile(email);
const teamingPartners = await findTeamingPartners({
  naics: profile.naics_codes,
  state: profile.state,
  excludeCertifications: profile.certifications, // Find partners with different certs
});
```

### 5. Opportunity Hunter / Alerts
**Current:** Uses `user_notification_settings`
**After:** Reads from `govcon_profiles`

```typescript
// No change to user experience, just data source
const profile = await getGovConProfile(email);
const opportunities = await searchOpportunities({
  naics: profile.naics_codes,
  states: profile.states || [profile.state],
  setAside: mapBusinessTypeToSetAside(profile.business_type),
});
```

---

## Migration Plan

### Phase 1: Create Table + Sync (Week 1)
1. Create `govcon_profiles` table in Supabase
2. Create migration script to merge data from:
   - `user_profiles` (email, stripe info)
   - `user_notification_settings` (NAICS, keywords, location, prefs)
   - `user_briefing_profile` (company info, certifications, capabilities)
3. Run migration for all existing users
4. Create `getGovConProfile()` and `updateGovConProfile()` functions

### Phase 2: Update Write Paths (Week 2)
1. Update `/api/alerts/save-profile` → write to `govcon_profiles`
2. Update `/api/profile` → write to `govcon_profiles`
3. Update `/api/alerts/preferences` → write to `govcon_profiles`
4. Keep old tables for backward compatibility (read-only)

### Phase 3: Update Read Paths (Week 3)
1. Update daily-alerts cron → read from `govcon_profiles`
2. Update briefings cron → read from `govcon_profiles`
3. Update Market Assassin form → pre-fill from `govcon_profiles`
4. Update Content Reaper → read capabilities

### Phase 4: New Features (Week 4+)
1. "Complete Your Profile" prompt across all tools
2. Teaming partner suggestions in Contractor Database
3. Auto-filter Recompete Tracker
4. Smart topic suggestions in Content Reaper

---

## API Design

### GET /api/profile/unified?email=X
Returns full profile, used by all tools.

```json
{
  "email": "user@company.com",
  "companyName": "Acme Federal",
  "naicsCodes": ["541512", "541519"],
  "naicsPrimary": "541512",
  "businessType": "sdvosb",
  "certifications": ["SDVOSB", "Small Business"],
  "state": "VA",
  "zipCode": "22030",
  "targetAgencies": ["DOD", "VA"],
  "contractVehicles": ["GSA Schedule", "SEWP V"],
  "capabilityKeywords": ["cybersecurity", "cloud", "devops"],
  "completenessScore": 75,
  "alertsEnabled": true,
  "briefingsEnabled": true
}
```

### POST /api/profile/unified
Updates any fields, merges arrays intelligently.

```json
{
  "email": "user@company.com",
  "naicsCodes": ["541512"],  // Adds to existing, doesn't replace
  "addNaics": true,           // Flag to append vs replace
  "state": "VA"               // Simple replace
}
```

### GET /api/profile/suggestions?email=X
Returns AI-generated suggestions based on profile.

```json
{
  "suggestedNaics": ["541611", "541330"],
  "suggestedAgencies": ["GSA", "DOE"],
  "suggestedKeywords": ["zero trust", "CMMC"],
  "teamingGaps": ["Need 8(a) partner for DOD work"]
}
```

---

## Evaluation Criteria

### Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Profile completeness | ~30% | 70% | `completeness_score` avg |
| Fields filled per user | 3-4 | 8-10 | Count non-null fields |
| Cross-tool data reuse | 0% | 80% | % of sessions using pre-filled data |
| User re-entry of same data | 3-4x | 0x | Track duplicate field submissions |
| Time to first search (MA) | 45s | 15s | Analytics event timing |

### Quality Gates

Before launch:
- [ ] All 5 tools read from `govcon_profiles`
- [ ] All 3 write paths update `govcon_profiles`
- [ ] Migration covers 100% of existing users
- [ ] No data loss from old tables
- [ ] Profile completeness prompt shows on <50% profiles
- [ ] Pre-fill works in Market Assassin form

### Rollback Plan

1. Keep old tables intact (no DROP)
2. Feature flag `USE_UNIFIED_PROFILE=true` in env
3. If issues, set flag to false → falls back to old tables
4. Old tables remain source of truth until flag is true for 30 days

---

## Data Mapping: Old → New

| Old Table | Old Column | New Table | New Column |
|-----------|-----------|-----------|-----------|
| user_profiles | email | govcon_profiles | email |
| user_profiles | name | govcon_profiles | company_name |
| user_notification_settings | naics_codes | govcon_profiles | naics_codes |
| user_notification_settings | keywords | govcon_profiles | capability_keywords |
| user_notification_settings | business_type | govcon_profiles | business_type |
| user_notification_settings | location_state | govcon_profiles | state |
| user_notification_settings | location_states | govcon_profiles | states |
| user_notification_settings | alerts_enabled | govcon_profiles | alerts_enabled |
| user_notification_settings | briefings_enabled | govcon_profiles | briefings_enabled |
| user_notification_settings | timezone | govcon_profiles | timezone |
| user_briefing_profile | company_name | govcon_profiles | company_name |
| user_briefing_profile | cage_code | govcon_profiles | cage_code |
| user_briefing_profile | state | govcon_profiles | state |
| user_briefing_profile | zip_code | govcon_profiles | zip_code |
| user_briefing_profile | certifications | govcon_profiles | certifications |
| user_briefing_profile | set_aside_preferences | govcon_profiles | business_type |
| user_briefing_profile | capability_keywords | govcon_profiles | capability_keywords |
| user_briefing_profile | contract_vehicles | govcon_profiles | contract_vehicles |
| user_briefing_profile | past_performance_agencies | govcon_profiles | past_performance_agencies |
| user_briefing_profile | engagement_score | govcon_profiles | engagement_score |

---

## Edge Cases

### Multiple Sources for Same Field
**Example:** User has `naics_codes` in both `user_notification_settings` and `user_briefing_profile`
**Resolution:** Merge arrays, deduplicate, keep most recent update timestamp

### Conflicting Data
**Example:** `state: "VA"` in one table, `state: "MD"` in another
**Resolution:** Use `user_notification_settings` as primary (more recently updated by user)

### Missing Email
**Example:** Old `user_briefing_profile` record with email not in `user_profiles`
**Resolution:** Create minimal `govcon_profiles` entry with just email + data from that table

---

## Open Questions

1. **Should we expose SAM.gov registration status?**
   - Could auto-validate CAGE/UEI against SAM Entity API
   - Show "Verified" badge on profile

2. **Should profiles be shareable?**
   - For teaming partner introductions
   - Privacy controls needed

3. **How to handle email changes?**
   - User changes email in Stripe
   - Need webhook to update `govcon_profiles.email`

---

## User-Provided SAM API Keys

### Why Allow This?

**Problem:** Our shared SAM.gov API key has rate limits (1,000 requests/day). With 800+ users, this becomes a bottleneck.

**Solution:** Let users provide their own SAM.gov API key for priority/unlimited access.

### Implementation Tiers

| Tier | API Key | Rate Limit |
|------|---------|------------|
| **Free** | Shared (ours) | Lowest priority, may be throttled |
| **Paid (no key)** | Shared (ours) | Standard priority |
| **Paid + Own Key** | User's key | Unlimited (their quota) |
| **Enterprise** | Required own key | Full control |

### How Users Get a SAM API Key

1. Go to https://sam.gov/
2. Create account (if needed)
3. Navigate to: Profile → API Keys → Request Key
4. Select "Public" API access (free)
5. Copy key and paste into GovCon Giants profile

### Profile UI Addition

```
┌─────────────────────────────────────────┐
│  ⚙️ API Settings (Optional)             │
├─────────────────────────────────────────┤
│                                         │
│  SAM.gov API Key                        │
│  [••••••••••••••••••••••••••••••••••]  │
│  [Validate Key]                         │
│                                         │
│  ✅ Key validated successfully          │
│                                         │
│  Why add your own key?                  │
│  • Faster searches (no shared limits)   │
│  • Priority opportunity alerts          │
│  • Unlimited API requests               │
│                                         │
│  [Get a free SAM.gov API key →]         │
│                                         │
└─────────────────────────────────────────┘
```

### Technical Implementation

```typescript
async function getSAMApiKey(email: string): Promise<string> {
  const profile = await getGovConProfile(email);

  // Prefer user's own key if valid
  if (profile.use_own_api_key && profile.sam_api_key_valid && profile.sam_api_key) {
    return decrypt(profile.sam_api_key);
  }

  // Fall back to shared key
  return process.env.SAM_API_KEY;
}

async function validateSAMApiKey(key: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.sam.gov/opportunities/v2/search?api_key=${key}&limit=1`
    );
    return response.ok;
  } catch {
    return false;
  }
}
```

### Security

- Store API keys encrypted (AES-256)
- Never log or expose keys in responses
- Validate keys before storing
- Allow users to delete their key anytime

---

## Timeline

| Week | Milestone |
|------|-----------|
| 1 | Create table, write migration script, test on staging |
| 2 | Update all write paths (POST endpoints) |
| 3 | Update all read paths (GET endpoints, cron jobs) |
| 4 | Add "Complete Profile" prompts, pre-fill in MA form |
| 5 | Launch teaming partner suggestions |
| 6 | Monitor, fix edge cases, deprecate old tables |

---

## Appendix: SQL Migration Script

```sql
-- Migration: Create govcon_profiles from existing data
INSERT INTO govcon_profiles (
  email,
  company_name,
  cage_code,
  naics_codes,
  naics_primary,
  business_type,
  certifications,
  state,
  states,
  zip_code,
  capability_keywords,
  contract_vehicles,
  target_agencies,
  past_performance_agencies,
  alerts_enabled,
  briefings_enabled,
  alert_frequency,
  timezone,
  engagement_score,
  completeness_score,
  onboarding_completed,
  created_at,
  updated_at
)
SELECT DISTINCT ON (COALESCE(uns.user_email, ubp.user_email, up.email))
  COALESCE(uns.user_email, ubp.user_email, up.email) as email,
  COALESCE(ubp.company_name, up.name) as company_name,
  ubp.cage_code,
  COALESCE(uns.naics_codes, ubp.naics_codes, '{}') as naics_codes,
  (COALESCE(uns.naics_codes, ubp.naics_codes, '{}'))[1] as naics_primary,
  COALESCE(uns.business_type, ubp.set_aside_preferences[1]) as business_type,
  COALESCE(ubp.certifications, '{}') as certifications,
  COALESCE(uns.location_state, ubp.state) as state,
  COALESCE(uns.location_states, '{}') as states,
  COALESCE(ubp.zip_code, uns.location_zip) as zip_code,
  COALESCE(ubp.capability_keywords, uns.keywords, '{}') as capability_keywords,
  COALESCE(ubp.contract_vehicles, '{}') as contract_vehicles,
  COALESCE(uns.agencies, ubp.past_performance_agencies, '{}') as target_agencies,
  COALESCE(ubp.past_performance_agencies, '{}') as past_performance_agencies,
  COALESCE(uns.alerts_enabled, true) as alerts_enabled,
  COALESCE(uns.briefings_enabled, true) as briefings_enabled,
  COALESCE(uns.alert_frequency, 'daily') as alert_frequency,
  COALESCE(uns.timezone, 'America/New_York') as timezone,
  COALESCE(ubp.engagement_score, 0) as engagement_score,
  COALESCE(ubp.profile_completeness, 0) as completeness_score,
  COALESCE(ubp.onboarding_completed, false) as onboarding_completed,
  NOW() as created_at,
  NOW() as updated_at
FROM user_profiles up
FULL OUTER JOIN user_notification_settings uns ON LOWER(up.email) = LOWER(uns.user_email)
FULL OUTER JOIN user_briefing_profile ubp ON LOWER(up.email) = LOWER(ubp.user_email)
WHERE COALESCE(uns.user_email, ubp.user_email, up.email) IS NOT NULL
ON CONFLICT (email) DO NOTHING;
```
