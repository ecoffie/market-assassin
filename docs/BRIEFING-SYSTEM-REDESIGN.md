# Briefing System Redesign

**Date**: April 8, 2026
**Status**: Implementation Required
**Problem Duration**: Over 1 week of failed attempts

## Problem Statement

The AI briefing system cannot deliver to 250+ users because:
1. Each briefing requires Claude API call (~3-10 seconds)
2. Code has 3-second delay between users
3. Vercel API routes timeout at 60 seconds
4. Result: Only ~5-10 users per cron run instead of 250

## Root Cause Analysis

| System | Speed | Why |
|--------|-------|-----|
| Daily Alerts | ✅ ~3s/user | SAM.gov API + scoring (no LLM) |
| AI Briefings | ❌ ~10s/user | Claude API call per user |

The briefings code was designed for a runtime that doesn't exist on Vercel.

## Solution Architecture

### Approach: Queue-Based Pre-Generation

Instead of generating briefings during delivery, pre-generate them in background jobs.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Pre-Generate   │────▶│  Briefing Queue │────▶│  Send Emails    │
│  (Background)   │     │  (Supabase)     │     │  (Cron)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     │                                                  │
     │ Uses Groq (fast)                                 │ No LLM calls
     │ or Claude Haiku                                  │ Just fetch + send
     ▼                                                  ▼
 5-50 users/min                                    100+ users/min
```

### Phase 1: Multi-LLM Router (Immediate)

**LLM Options by Priority:**

| LLM | Speed | Cost | Use Case |
|-----|-------|------|----------|
| Groq (Llama 3.1 70B) | ~50x faster | Free tier avail | Bulk generation |
| Claude Haiku | ~5x faster | $0.25/1M | Standard briefings |
| Claude Sonnet | Baseline | $3/1M | Premium users |
| Claude Opus | Slow | $15/1M | Special analysis |

**Implementation:**
1. Create `src/lib/llm/router.ts` with model selection
2. Default to Groq for bulk briefing generation
3. Fall back to Claude Haiku if Groq unavailable
4. Use Claude Sonnet for premium users only

### Phase 2: Briefing Queue Table

```sql
CREATE TABLE briefing_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL,
  briefing_type TEXT NOT NULL, -- 'daily_brief', 'weekly_deep_dive', 'pursuit_brief'
  status TEXT DEFAULT 'pending', -- 'pending', 'generating', 'ready', 'sent', 'failed'
  priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest
  briefing_content JSONB,
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, briefing_type, DATE(created_at))
);

CREATE INDEX idx_queue_status ON briefing_queue(status, priority);
CREATE INDEX idx_queue_ready ON briefing_queue(status) WHERE status = 'ready';
```

### Phase 3: New Cron Jobs

| Cron | Schedule | Purpose | Duration |
|------|----------|---------|----------|
| `queue-briefings` | 5 AM UTC | Add users to queue | <30s |
| `generate-briefings` | Every 10 min | Generate 10 briefings | <60s |
| `send-queued-briefings` | 7 AM UTC | Send ready briefings | <60s |

### Phase 4: Implementation Plan

#### Step 1: Create LLM Router
```typescript
// src/lib/llm/router.ts
export async function generateBriefingContent(
  email: string,
  options: { maxOpportunities: number; maxTeamingPlays: number }
): Promise<BriefingContent> {
  // Try Groq first (fastest, free tier)
  if (process.env.GROQ_API_KEY) {
    try {
      return await generateWithGroq(email, options);
    } catch (groqErr) {
      console.warn('[LLM Router] Groq failed, falling back to Claude');
    }
  }

  // Fall back to Claude Haiku
  return await generateWithClaudeHaiku(email, options);
}
```

#### Step 2: Refactor Generation
- Move AI generation logic to LLM router
- Make briefing generators use the router
- Store generated content in queue table

#### Step 3: New Cron Endpoints
- `/api/cron/queue-briefings` - Populate queue
- `/api/cron/generate-briefings` - Generate batches
- `/api/cron/send-queued-briefings` - Send ready emails

## QA/QC Criteria

### Before Deploy
- [ ] TypeScript compiles without errors
- [ ] All existing tests pass
- [ ] New endpoints respond correctly
- [ ] LLM router falls back properly
- [ ] Queue table created in Supabase

### Smoke Tests
- [ ] Single user briefing generates via Groq
- [ ] Single user briefing generates via Claude Haiku
- [ ] Briefing content matches expected format
- [ ] Email sends successfully
- [ ] Deduplication works (no double sends)

### Load Tests
- [ ] Queue 50 users in <30 seconds
- [ ] Generate 10 briefings in <60 seconds
- [ ] Send 100 ready briefings in <60 seconds

### Monitoring
- [ ] Track generation times per LLM
- [ ] Track queue depth over time
- [ ] Alert if queue backs up >500

## Migration Plan

1. **Day 1**: Deploy LLM router + queue table
2. **Day 2**: Deploy new cron jobs (disabled)
3. **Day 3**: Enable `queue-briefings` only, verify users queued
4. **Day 4**: Enable `generate-briefings`, verify content quality
5. **Day 5**: Enable `send-queued-briefings`, verify delivery
6. **Day 6**: Disable old `send-briefings` cron
7. **Day 7**: Full monitoring, adjust batch sizes

## Rollback Plan

If issues arise:
1. Disable new cron jobs
2. Re-enable old `send-briefings` cron (limited but working)
3. Clear queue table
4. Investigate and fix

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Daily Brief Recipients | ~30 | 250+ |
| Weekly Deep Dive Recipients | ~4 | 250+ |
| Pursuit Brief Recipients | ~0 | 250+ |
| Generation Time | ~10s/user | ~2s/user |
| Cost per Briefing | ~$0.03 | ~$0.003 |

---

*This document serves as the technical specification for the briefing system redesign.*
