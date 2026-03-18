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

*Last Updated: March 17, 2026*
