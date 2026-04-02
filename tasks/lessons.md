# Development Lessons Learned

Rules and patterns to prevent repeated mistakes.

---

## Vercel Cron Jobs

**Lesson (Mar 17, 2026):** Vercel cron jobs call endpoints with GET requests, not POST.

**Pattern:**
```typescript
// Extract job logic into standalone function
async function runJob(): Promise<NextResponse> {
  // actual job work here
}

// POST handler for manual triggers with auth
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runJob();
}

// GET handler must detect Vercel cron header
export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (isVercelCron || hasCronSecret) {
    return runJob();
  }

  // Return status info for non-cron requests
  return NextResponse.json({ message: 'Cron endpoint', schedule: '...' });
}
```

**What went wrong:** Alert cron endpoints had job logic only in POST handler. Vercel sent GET requests at scheduled time, but GET just returned status info. Jobs never ran.

**Fix applied to:** `/api/cron/daily-alerts`, `/api/cron/weekly-alerts`

---

## Testing Cron Jobs

**Lesson:** Always manually test cron endpoints before marking as complete.

**How to test:**
```bash
# Simulate Vercel cron call
curl -H "x-vercel-cron: 1" "https://tools.govcongiants.org/api/cron/daily-alerts"

# Or use CRON_SECRET
curl -H "Authorization: Bearer $CRON_SECRET" "https://tools.govcongiants.org/api/cron/daily-alerts"
```

**Checklist for new cron endpoints:**
1. [ ] Job logic in standalone function
2. [ ] GET handler detects `x-vercel-cron: 1`
3. [ ] GET handler also accepts CRON_SECRET for manual testing
4. [ ] GET without auth returns status info (no job execution)
5. [ ] Test with curl + `x-vercel-cron: 1` header
6. [ ] Verify job actually runs (check logs, database, etc.)

---

## Supabase Foreign Key Constraints

**Lesson:** Never `continue` after Supabase failure when KV access is the primary gate.

**Pattern:** Always run KV operations unconditionally. Supabase FK constraints can fail for users without auth accounts, but KV is what gates actual tool access.

```typescript
// BAD - stops if Supabase fails
const supabaseResult = await upsertUserProfile(email, data);
if (!supabaseResult.success) {
  return NextResponse.json({ error: 'Failed' });
}
await kv.set(`tool:${email}`, 'true');

// GOOD - KV always runs
const supabaseResult = await upsertUserProfile(email, data);
// Log but don't block
if (!supabaseResult.success) {
  console.warn('Supabase upsert failed:', supabaseResult.error);
}
// KV is primary access control - must always execute
await kv.set(`tool:${email}`, 'true');
```

---

## Array Formatting

**Lesson:** Arrays must be `.join(' ')` not interpolated.

```typescript
// BAD - produces "tag1,tag2"
const text = `Hashtags: ${post.hashtags}`;

// GOOD - produces "tag1 tag2"
const text = `Hashtags: ${post.hashtags.join(' ')}`;
```

---

## SAM.gov API Authentication

**Lesson (Mar 25, 2026):** SAM.gov Contract Awards and Subaward APIs require **System Account**, not just public API key.

**What works with public API key:**
- Opportunities API ✅
- Entity Management API ✅
- Federal Hierarchy API ✅

**What requires System Account:**
- Contract Awards API ❌
- Subaward Reporting API ❌

**How to get System Account:**
1. Entity must be **Active** in SAM.gov (renew if expired)
2. Go to Workspace → System Accounts
3. Request System Account access
4. Wait 1-4 weeks for approval
5. Add new API key to environment

**Workaround:** USASpending.gov API provides similar contract data including bid counts (`number_of_offers_received`) without authentication. Use as fallback or primary source.

---

## USASpending API Field Mapping

**Lesson (Mar 25, 2026):** USASpending search endpoint returns `generated_internal_id`, not `generated_unique_award_id`.

**Pattern:**
```typescript
// Search endpoint returns generated_internal_id
const awardId = result.generated_internal_id || result.generated_unique_award_id;

// Use that ID for detail lookup
const details = await fetch(`/api/v2/awards/${awardId}/`);
```

**Key field locations in award detail response:**
```typescript
// Competition data is nested
const bidCount = details.latest_transaction_contract_data.number_of_offers_received;
const competition = details.latest_transaction_contract_data.extent_competed;

// Recipient is nested
const recipientName = details.recipient.recipient_name;

// Dates are nested
const endDate = details.period_of_performance.end_date;

// NAICS is nested
const naicsCode = details.naics_hierarchy.base_code.code;
```

---

## Daily Briefings Pipeline Migration

**Lesson (Mar 26, 2026):** When replacing a data source (FPDS → USASpending), update ALL consumers, not just the wrapper.

**Files that import from `fpds-recompete.ts`:**
- `snapshot-recompetes/route.ts` - cron job
- `diff-engine.ts` - snapshot comparison
- `ai-briefing-generator.ts` - AI prompt generation
- `generator.ts` - email generation
- `pursuit-brief-generator.ts` - pursuit briefs
- `weekly-briefing-generator.ts` - weekly digests
- `perplexity-enrichment.ts` - web enrichment
- `pipelines/index.ts` - unified exports

**Pattern:**
```typescript
// OLD - imported from retired FPDS
import { fetchFPDSByNaics, FPDSAward } from '@/lib/utils/fpds-api';

// NEW - use SAM/USASpending wrapper
import {
  getExpiringContracts,
  type ContractAward
} from '@/lib/sam';
```

**Key changes to RecompeteContract interface:**
```typescript
// NEW fields added
incumbentUei: string | null;      // DUNS deprecated
numberOfBids?: number;            // From USASpending
competitionLevel?: 'sole_source' | 'low' | 'medium' | 'high';
competitionType?: string;         // e.g., "Full and Open Competition"
```

---

## Market Intelligence System (3 Report Types)

**Lesson (Mar 26, 2026):** The system is called "Market Intelligence" with 3 distinct report types.

**The 3 Report Types:**
1. **Daily Brief** - Daily Market Intel with Top 10 + 3 Ghosting/Teaming Plays
2. **Weekly Deep Dive** - Full analysis of 10 Opportunities with competitive landscape, calendar
3. **Pursuit Brief** - Single opportunity deep dive with score (68/100 CONDITIONAL)

**Key Files:**
- `/api/admin/send-all-briefings/route.ts` - Sends all 3 types
- Uses `user_notification_settings` table for NAICS codes
- Fetches real data from USASpending API

**Pattern:**
```typescript
// Always pull NAICS from user's saved profile
const { data: userSettings } = await supabase
  .from('user_notification_settings')
  .select('naics_codes, agencies, keywords')
  .eq('user_email', email)
  .single();

const userNaics = userSettings?.naics_codes || [];
```

---

## Daily Alerts vs Market Intelligence

**Lesson (Mar 26, 2026):** These are TWO SEPARATE systems - do NOT conflate them.

| System | Access | KV Key | Access Flag |
|--------|--------|--------|-------------|
| **Daily Alerts** | FREE for everyone (beta) | `alertpro:{email}` for Pro tier | N/A (free) |
| **Market Intelligence** | Pro/Ultimate bundles only | `briefings:{email}` | `access_briefings` |

**Daily Alerts:**
- Simple SAM.gov opportunity notifications
- User sets NAICS codes at `/alerts/preferences`
- Cron: `/api/cron/daily-alerts`
- FREE during beta - no access check

**Market Intelligence:**
- Premium system with 3 report types
- Deep analysis, bid counts, win probability
- Only granted via Pro Bundle ($997) or Ultimate Bundle ($1,497)
- Individual tool purchases do NOT include Market Intelligence

**Why separate?**
- Daily Alerts = demo/trial hook to show value
- Market Intelligence = premium upsell for serious contractors

---

## Pre-Deploy QA Testing

**Lesson (Mar 27, 2026):** Always run QA tests before deployment. The SAM.gov date format bug (YYYY-MM-DD vs MM/dd/yyyy) would have been caught.

**Commands:**
```bash
# Run pre-deploy tests (required before deploy)
npm run test:pre-deploy

# Safe deploy (runs tests first, blocks if failures)
npm run deploy

# Run all test suites
npm test
```

**What pre-deploy tests check:**
1. TypeScript compilation (no type errors)
2. SAM.gov date format validation
3. Critical API endpoint health
4. Daily alerts pipeline
5. Market Intelligence pipeline
6. Access control rules (Starter bundle exclusion)
7. Environment variable references

**Rule:** Never deploy without running `npm run test:pre-deploy` first.

**Files:**
- `tests/test-pre-deploy.sh` - Main QA script
- `tests/run-all-tests.sh` - Full test suite runner

---

## Market Intelligence - Two Table Problem (RESOLVED)

**Lesson (Mar 27, 2026):** ~~Daily Alerts and Daily Briefings use DIFFERENT user tables. Must query BOTH.~~

**UPDATE (Mar 29, 2026):** This was resolved by dropping old tables and using UNIFIED `user_notification_settings` table for everything.

**Old approach (don't use):**
- Query `user_alert_settings` AND `user_notification_settings`, dedupe by email

**New approach:**
- Single source of truth: `user_notification_settings`
- Fallback for NAICS: `smart_user_profiles` (search history aggregation)

**Admin endpoints:**
- `/api/admin/test-market-intel-pipeline` - Pipeline status/testing

---

## Fallback NAICS Codes

**Lesson (Mar 27, 2026):** Users without NAICS codes should still receive alerts/briefs using popular defaults.

**Problem:** 362/394 users had no NAICS codes set. They received nothing.

**Solution:** If user has no NAICS AND no agencies, use fallback codes:
```typescript
if (naics.length === 0 && agencies.length === 0) {
  naics = [
    '541512', // Computer Systems Design
    '541611', // Management Consulting
    '541330', // Engineering Services
    '541990', // Other Professional Services
    '561210', // Facilities Support Services
  ];
}
```

**Why these codes:** Highest volume of federal opportunities, covers most small businesses.

**Companion action:** Send NAICS reminder email to encourage personalization.
- Endpoint: `/api/admin/send-naics-reminder?password=xxx&mode=execute`

---

## Auto-Enrollment for Purchasers

**Lesson (Mar 27, 2026):** All purchasers should be auto-enrolled in free alerts during beta.

**What changed (Stripe webhook):**
```typescript
// AUTO-ENROLL ALL PURCHASERS in alert settings
if (supabase) {
  const { data: existingSettings } = await supabase
    .from('user_alert_settings')
    .select('user_email')
    .eq('user_email', email.toLowerCase())
    .limit(1);

  if (!existingSettings || existingSettings.length === 0) {
    await supabase.from('user_alert_settings').insert({
      user_email: email.toLowerCase(),
      alerts_enabled: true,
      briefings_enabled: true,
      subscription_status: 'beta',
      // ... other defaults
    });
  }
}
```

**Added to purchase emails:**
```html
<div style="background: #f0fdf4; border: 2px solid #22c55e;">
  🎁 BONUS: Free Daily Opportunity Alerts
  As a GovCon Giants customer, you're automatically enrolled!
  <a href="https://tools.govcongiants.org/alerts/preferences?email=...">
    Set Up Your Daily Alerts
  </a>
</div>
```

---

## Briefing Snapshot Pipeline

**Lesson (Mar 27, 2026):** Daily Briefings require populated snapshot tables. No snapshots = 0 briefing items.

**Data flow:**
```
Crons (7 AM UTC)          →    briefing_snapshots table    →    generateBriefing()
snapshot-opportunities    →    tool: opportunity_hunter    →    items for user
snapshot-recompetes      →    tool: recompete             →    items for user
snapshot-awards          →    tool: market_assassin       →    items for user
snapshot-contractors     →    tool: contractor_db         →    items for user
```

**If briefing returns 0 items, check:**
1. Are snapshots being created? Query `briefing_snapshots` for today
2. Does user's NAICS match any snapshot data?
3. Is the NAICS code included in snapshot crons?

**Construction NAICS (236, 238) coverage:**
- May have lower volume in snapshot data
- Consider expanding snapshot cron queries to include construction codes

---

## Pipeline Testing Checklist

**Lesson (Mar 27, 2026):** Always test the full Market Intelligence pipeline before declaring victory.

**Pipeline Test Endpoint:**
```bash
curl "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026"
```

**What it checks:**
- Daily Alerts: Users eligible, users with NAICS, recent deliveries
- Daily Briefs: Both tables, recent deliveries
- Pursuit Brief: Eligibility
- Weekly Deep Dive: Eligibility

**Test specific user:**
```bash
curl "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026&email=user@example.com"
```

**Send test component:**
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/test-market-intel-pipeline?password=galata-assassin-2026&email=user@example.com&component=briefs"
```

---

## Unified Notification Table Migration

**Lesson (Mar 29, 2026):** The old `user_alert_settings` and `user_briefing_profile` tables were DROPPED and replaced with `user_notification_settings`.

**What happened:**
- Supabase schema was migrated to unified `user_notification_settings` table
- BUT code still referenced old tables (`user_alert_settings`, `user_briefing_profile`)
- Cron health check showed 15/16 passing (Alerts Signup failing)
- Root cause: Table didn't exist

**Files that needed updating:**
| File | Old Table | New Table |
|------|-----------|-----------|
| `api/cron/daily-alerts/route.ts` | `user_alert_settings` | `user_notification_settings` |
| `api/cron/send-briefings/route.ts` | `user_alert_settings` | `smart_user_profiles` (fallback) |
| `api/admin/trigger-alerts/route.ts` | `user_alert_settings` | `user_notification_settings` |
| `api/alerts/save-profile/route.ts` | `user_alert_settings` | `user_notification_settings` |
| `api/alerts/unsubscribe/route.ts` | `user_alert_settings` | `user_notification_settings` |
| `api/briefings/preferences/route.ts` | `user_briefing_profile` | `user_notification_settings` |

**Column mapping:**
| Old Column | New Column |
|------------|------------|
| `target_agencies` | `agencies` |
| `email_frequency` | `briefing_frequency` |
| `is_active` (for alerts) | `alerts_enabled` |
| `is_active` (for briefings) | `briefings_enabled` |

**Pattern:** Always check Supabase schema before assuming table names. Use health check endpoint to verify all systems working.

---

## GHL API Pagination

**Lesson (Mar 29, 2026):** GoHighLevel API uses cursor-based pagination, not offset-based.

**Wrong:**
```bash
# This fails with "property skip should not exist"
curl ".../contacts/?skip=100&limit=100"
```

**Correct:**
```bash
# Get first page
response=$(curl ".../contacts/?limit=100")

# Extract next page URL from response
next_url=$(echo "$response" | jq -r '.meta.nextPageUrl')

# Use that URL for next page
curl "$next_url"
```

**Pattern:** Check `.meta.nextPageUrl` in response for cursor. Total count in `.meta.total`.

---

## Bulk Enrollment Best Practice

**Lesson (Mar 29, 2026):** Test with small sample before bulk operations.

**Pattern:**
1. Test with 5 users first
2. Verify they appear in database
3. Then batch enroll remaining
4. Save email list to permanent file (not /tmp)

**File saved:** `data/bootcamp-attendees-to-enroll.txt` (8,804 emails)

---

## Vercel.json Changes Must Be Committed

**Lesson (Apr 2, 2026):** Vercel cron changes made to `vercel.json` must be **committed to git** to persist.

**What happened:**
1. Briefing crons were added in commit `b940a72`
2. During a different commit (`332674a`), some crons were accidentally removed
3. Each time we manually fixed `vercel.json` and deployed, it worked *once*
4. But the next deploy from git reverted back to the committed (broken) version
5. Result: Briefings sent once then stopped; Daily Alerts kept working (they were committed)

**Why this happens:**
- Vercel deploys from git HEAD
- Local changes to `vercel.json` deploy when you run `vercel --prod`
- But if you don't commit, next team deploy or CI deploy uses git version

**Prevention:**
```bash
# After changing vercel.json, ALWAYS commit
git add vercel.json
git commit -m "fix: Update cron schedules"

# Verify crons are in git
git show HEAD:vercel.json | grep "your-cron-path"
```

**Checklist for cron changes:**
1. [ ] Edit vercel.json locally
2. [ ] Deploy and test: `vercel --prod`
3. [ ] **COMMIT THE CHANGE**: `git add vercel.json && git commit -m "..."`
4. [ ] Verify: `git show HEAD:vercel.json | grep cron`
5. [ ] Push to remote if using CI

**Rule:** "If it's not committed, it didn't happen."

---

*Last Updated: April 2, 2026*
