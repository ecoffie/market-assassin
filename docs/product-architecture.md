# GovCon Giants Alerts Tool — Product Architecture v1

> **Last Updated:** April 28, 2026
> **Status:** Canonical reference for all alerts/briefings development

---

## Overview

**ONE product. THREE tiers.**

The GovCon Giants opportunity alerts system is a single unified product with three access tiers. All users enter through the same signup flow and are routed to appropriate features based on their tier.

---

## Tier Definitions

### Tier 1: Weekly Alerts (Free)

| Attribute | Value |
|-----------|-------|
| **Price** | Free |
| **Email Frequency** | Weekly (Sunday digest) |
| **NAICS Codes** | Up to 5 |
| **Filtering** | Basic (NAICS, state) |
| **Features** | Opportunity list, basic matching |
| **Experiment Cohort** | `experiment_hold` |
| **Target Audience** | Free signups, lead gen, low-touch users |

**Value Prop:** "Never miss an opportunity in your space."

---

### Tier 2: Daily Alerts (Paid — $19/mo planned)

| Attribute | Value |
|-----------|-------|
| **Price** | $19/mo (FREE during beta through April 27, 2026) |
| **Email Frequency** | Daily (weekday mornings) |
| **NAICS Codes** | Unlimited |
| **Filtering** | Full (NAICS, PSC, keywords, agencies, set-asides, geography) |
| **Features** | Everything in Tier 1 + daily delivery, advanced filters |
| **Experiment Cohort** | `experiment_alerts` |
| **Target Audience** | Active BD professionals who need daily updates |

**Value Prop:** "Start every day knowing what dropped."

---

### Tier 3: Daily Briefings + Market Intelligence (Paid — $49/mo planned)

| Attribute | Value |
|-----------|-------|
| **Price** | $49/mo (FREE during beta through April 27, 2026) |
| **Email Frequency** | Daily + Weekly Deep Dive (Fri) + Pursuit Brief (Sat) |
| **NAICS Codes** | Unlimited |
| **Filtering** | Full |
| **Features** | Everything in Tier 2 + Market Intelligence layer |
| **Experiment Cohort** | `experiment_briefings` OR `paid_existing` |
| **Target Audience** | Serious capture teams, enterprise BD |

**Market Intelligence Layer includes:**
- Win probability scoring
- Recompete activity tracking
- Agency spend signals
- Incumbent analysis
- Strategic pursuit guidance
- Weekly market movement analysis

**Value Prop:** "Intelligence that wins contracts."

---

## Routing Rules

### Single Signup Flow

**All signups go through `/alerts/signup`**

There is ONE signup page. The signup flow:
1. Collects email, NAICS codes, business type, location
2. Determines tier based on routing rules (below)
3. Creates/updates `user_notification_settings` record
4. Routes user to appropriate experience

### Tier Determination (Priority Order)

```
1. paid_status (from Stripe)
   └─ If user has active Stripe subscription → Check which product
      └─ Daily Briefings product → Tier 3
      └─ Daily Alerts product → Tier 2
      └─ Other GCG product (bundle, legacy) → Tier 3 (paid_existing)

2. experiment_cohort (during beta)
   └─ experiment_briefings → Tier 3
   └─ experiment_alerts → Tier 2
   └─ experiment_hold → Tier 1

3. Default (post-beta, no payment)
   └─ Tier 1 (Free Weekly)
```

### Page Purposes

| Page | Purpose | Is Signup? |
|------|---------|------------|
| `/alerts/signup` | **PRIMARY SIGNUP** for all tiers | ✅ Yes |
| `/alerts/preferences` | Redirects to `/briefings` | ❌ No |
| `/briefings` | Dashboard for Tier 2/3 users | ❌ No |
| `/market-intelligence` | **UPSELL/MARKETING** page, NOT signup | ❌ No |

### Access Verification

All access checks use the same logic:
1. Check `user_notification_settings.tier` (future)
2. Check `user_notification_settings.briefings_enabled` (Tier 3)
3. Check `user_notification_settings.alerts_enabled` (Tier 2)
4. Check KV store for legacy access keys
5. Default to Tier 1 features

---

## Database Schema

### Primary Table: `user_notification_settings`

| Column | Type | Purpose |
|--------|------|---------|
| `user_email` | TEXT PK | User identifier |
| `naics_codes` | TEXT[] | NAICS codes for matching |
| `alerts_enabled` | BOOLEAN | Tier 2+ access |
| `briefings_enabled` | BOOLEAN | Tier 3 access |
| `alert_frequency` | TEXT | 'daily' or 'weekly' |
| `experiment_cohort` | TEXT | Beta experiment assignment |
| `stripe_customer_id` | TEXT | Stripe customer for paid users |
| `source` | TEXT | Signup source tracking |

### Future Additions (Post-Beta)

| Column | Type | Purpose |
|--------|------|---------|
| `subscription_tier` | TEXT | 'free', 'alerts', 'briefings' |
| `subscription_status` | TEXT | 'active', 'canceled', 'past_due' |
| `subscription_started_at` | TIMESTAMP | When paid subscription began |

---

## Experiment Cohorts (Beta Period)

During beta (through April 27, 2026), users are assigned to cohorts:

| Cohort | Tier | Features | Assignment |
|--------|------|----------|------------|
| `experiment_hold` | 1 | Weekly only | Control group |
| `experiment_alerts` | 2 | Daily alerts | Treatment A |
| `experiment_briefings` | 3 | Full MI | Treatment B |
| `paid_existing` | 3 | Full MI | Existing GCG customers |

**Cohort assignment happens at signup** and persists for the experiment duration.

---

## Email Products by Tier

| Email | Tier 1 | Tier 2 | Tier 3 |
|-------|--------|--------|--------|
| Weekly Digest (Sun) | ✅ | ✅ | ✅ |
| Daily Alerts (weekdays) | ❌ | ✅ | ✅ |
| Daily Market Intel (weekdays) | ❌ | ❌ | ✅ |
| Weekly Deep Dive (Fri) | ❌ | ❌ | ✅ |
| Pursuit Brief (Sat) | ❌ | ❌ | ✅ |

---

## Color/Branding by Tier

| Tier | Primary Color | Badge |
|------|---------------|-------|
| Tier 1 (Free) | Slate/Gray | — |
| Tier 2 (Alerts) | Purple | `#7c3aed` |
| Tier 3 (Briefings) | Green/Emerald | `#10b981` |

---

## Migration Path

### Current State (April 2026)
- Multiple signup flows exist
- Separate access verification for alerts vs briefings
- Magic links going to different pages

### Target State
- Single `/alerts/signup` handles all tiers
- Unified access verification in one place
- `/market-intelligence` is marketing only
- Tier determined by routing rules, not page visited

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/alerts/save-profile` | Create/update user profile (all tiers) |
| `GET /api/alerts/save-profile` | Get user profile |
| `POST /api/alerts/verify-invite` | Verify magic link tokens |
| `POST /api/briefings/verify` | Check Tier 3 access |
| `GET /api/alerts/preferences` | Get preferences (redirects) |

---

## Non-Goals

1. **Separate MI signup flow** — All signups go through `/alerts/signup`
2. **Multiple access verification systems** — One unified check
3. **Different databases per tier** — All in `user_notification_settings`
4. **Separate dashboards** — `/briefings` serves all tiers with feature gating

---

---

## Architecture Violations Audit (April 28, 2026)

The following code contradicts the documented architecture and would need to change to align:

### 1. CRITICAL: Duplicate MI Signup Page

**Violation:** `/market-intelligence/signup/page.tsx` exists as a separate signup flow

**Location:** `src/app/market-intelligence/signup/page.tsx`

**Problem:** Architecture states "All signups go through `/alerts/signup`" but we created a separate MI signup page that duplicates:
- Token verification logic (uses `/api/alerts/verify-invite` which doesn't exist)
- Profile save logic (calls `/api/alerts/save-profile`)
- Form UI (NAICS, business type, location)

**To Fix:**
- Delete `/market-intelligence/signup/page.tsx`
- Update magic link script to point to `/alerts/signup?invite=xxx`
- Ensure `/alerts/signup` handles all tier scenarios correctly

---

### 2. CRITICAL: Magic Link Points to Wrong Page

**Violation:** `scripts/generate-subscriber-invitations.js` line 108

**Current:** `${BASE_URL}/market-intelligence/signup?invite=${token}`

**Should Be:** `${BASE_URL}/alerts/signup?invite=${token}`

**To Fix:** Revert the URL change and keep single signup flow

---

### 3. MODERATE: Two Different Invite Verification APIs

**Violation:** Two endpoints for invite verification with different interfaces

**Endpoints:**
1. `/api/invitations/verify` (GET for verify, POST for mark-used)
   - Used by `/alerts/signup/page.tsx`
   - Returns `{ valid, customerId, email, firstName, productName }`

2. `/api/alerts/verify-invite` (referenced in MI signup but DOES NOT EXIST)
   - Was referenced in `/market-intelligence/signup/page.tsx`
   - Expected `{ isValid, email, firstName, stripeCustomerId, productName }`

**To Fix:**
- Delete reference to non-existent `/api/alerts/verify-invite`
- Use `/api/invitations/verify` as the single canonical endpoint
- Standardize response format

---

### 4. MODERATE: Multiple Access Verification Systems

**Violation:** Separate access checks for alerts vs briefings

**Systems:**
1. **KV Store:** `briefings:{email}` key (Tier 3 only)
2. **Supabase `user_profiles`:** `access_briefings`, `briefings_expires_at` columns
3. **Supabase `user_notification_settings`:** `alerts_enabled`, `briefings_enabled` columns

**Files:**
- `src/lib/briefings/access.ts` - checks KV + `user_profiles`
- `src/app/api/briefings/verify/route.ts` - calls `hasBriefingsAccess()`
- Various cron jobs check `alerts_enabled` and `briefings_enabled` separately

**To Fix:**
- Unify access check into single function that respects tier hierarchy
- Consider adding `subscription_tier` enum column to replace boolean flags
- Single source of truth for tier determination

---

### 5. MODERATE: No Experiment Cohort Assignment Logic

**Violation:** Architecture mentions experiment cohorts but they're not implemented in signup

**Current:** Signup just sets `source: 'paid_existing'` or `source: 'free-signup'`

**Missing:**
- No `experiment_cohort` assignment during signup
- No logic to route users to different tiers based on cohort
- Only one admin endpoint references experiments: `/api/admin/apply-experiment-migration/route.ts`

**To Fix:**
- Add experiment cohort assignment logic to `/api/alerts/save-profile`
- Create experiment configuration (percentage allocation)
- Add cohort to tier routing logic

---

### 6. MINOR: Inconsistent Color Branding in Code

**Violation:** Architecture specifies color branding but code is inconsistent

**Architecture:**
- Tier 2 (Alerts): Purple `#7c3aed`
- Tier 3 (Briefings): Green/Emerald `#10b981`

**In Code:**
- `/alerts/signup` success for paid users: Uses emerald/green ✓
- `/alerts/signup` success for free users: Uses emerald/green (should be neutral?)
- `/market-intelligence/signup` (to be deleted): Uses emerald/green ✓
- `/market-intelligence` landing: Uses purple (correct - it's upsell page)

**To Fix:** Ensure signup flow shows correct colors based on tier being assigned

---

### 7. MINOR: `/alerts/preferences` Still Exists

**Violation:** Architecture says it redirects to `/briefings` but it's a full page

**Location:** `src/app/alerts/preferences/page.tsx`

**To Fix:** Verify it actually redirects, or convert to redirect

---

### 8. INFO: Missing Tier Field in Database

**Note:** Architecture mentions future `subscription_tier` field

**Current Schema:** Uses `alerts_enabled` (bool) + `briefings_enabled` (bool)

**Recommendation:** Consider migration to enum field for cleaner tier logic:
```sql
ALTER TABLE user_notification_settings
ADD COLUMN subscription_tier TEXT CHECK (subscription_tier IN ('free', 'alerts', 'briefings'));
```

---

## Summary

| Priority | Issue | Action |
|----------|-------|--------|
| 🔴 CRITICAL | Duplicate MI signup page | Delete `market-intelligence/signup/` |
| 🔴 CRITICAL | Magic link URL wrong | Change back to `/alerts/signup` |
| 🟡 MODERATE | Two invite verify APIs | Consolidate to one |
| 🟡 MODERATE | Multiple access systems | Unify access checking |
| 🟡 MODERATE | No experiment cohorts | Implement or defer |
| 🟢 MINOR | Color branding inconsistent | Review and align |
| 🟢 MINOR | `/alerts/preferences` | Verify redirect |
| ℹ️ INFO | Missing tier enum | Consider for post-beta |

---

## Change Log

| Date | Change |
|------|--------|
| 2026-04-28 | Initial architecture document |
| 2026-04-28 | Added architecture violations audit |
