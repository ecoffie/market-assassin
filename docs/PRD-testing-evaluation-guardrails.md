# PRD Enhancement: Testing, Evaluation & Guardrails

## 1. What's Missing from Current PRDs

### PRD-moat-strategy.md
| Missing | Why It Matters |
|---------|----------------|
| Success criteria for 30-day test | How do we know Moat 1 & 2 are working? |
| Rollback triggers | When do we pause and fix? |
| Data collection plan | What metrics to track from day 1? |
| User feedback mechanism | How do users report issues? |

### PRD-outcome-based-intelligence.md
| Missing | Why It Matters |
|---------|----------------|
| A/B test design | How do we compare unified vs separate emails? |
| Entitlement validation | How do we verify access derivation is correct? |
| Email deliverability monitoring | Are emails landing in inbox? |
| Intelligence quality scoring | Is the intel actually useful? |

### PRD-unified-profile.md
| Missing | Why It Matters |
|---------|----------------|
| Data migration validation | How do we verify no data loss? |
| Profile completeness tracking | Are users filling out profiles? |
| Cross-reference accuracy | Is smart expansion finding real matches? |
| Performance benchmarks | Is the system fast enough? |

---

## 2. Testing Criteria

### Daily Alerts (Moat 1) - 30 Day Test

#### Functional Tests (Run Daily)
```bash
# Automated test script: tests/test-daily-alerts.sh

# 1. Cron executes successfully
curl -s "https://tools.govcongiants.org/api/cron/daily-alerts?password=$ADMIN_PASSWORD" | jq '.success'
# Expected: true

# 2. Emails sent without errors
# Check: No errors in Vercel logs
# Check: SMTP delivery rate > 95%

# 3. SAM.gov API responding
curl -s "https://tools.govcongiants.org/api/cron/health-check?password=$ADMIN_PASSWORD" | jq '.samApi'
# Expected: "healthy"

# 4. Correct users receive alerts
# Query: SELECT COUNT(*) FROM user_notification_settings WHERE alerts_enabled = true
# Compare to: Emails sent count
```

#### Quality Tests (Run Weekly)
| Test | Method | Pass Criteria |
|------|--------|---------------|
| NAICS matching accuracy | Manual review of 50 random alerts | >95% relevant to user's NAICS |
| Set-aside filtering | Check 8(a) users get 8(a) opps | 100% correct filtering |
| Deduplication | Check no user gets same opp twice in 7 days | 0 duplicates |
| Timezone accuracy | Users receive at ~6 AM local | 90% within 1 hour window |

#### User Experience Tests
| Test | Method | Pass Criteria |
|------|--------|---------------|
| Email renders correctly | Test on Gmail, Outlook, Apple Mail | No broken layouts |
| Links work | Click every link in test email | 100% valid |
| Unsubscribe works | Test unsubscribe flow | Immediate effect |
| Mobile rendering | Test on iPhone, Android | Readable without zoom |

### Daily Briefings (Moat 2) - 30 Day Test

#### Functional Tests
| Test | Method | Pass Criteria |
|------|--------|---------------|
| Briefing generation | Cron completes without error | 100% success rate |
| Win probability scoring | Verify scores are calculated | All opps have scores |
| Agency data included | Check pain points/SBLO in email | Data present |
| Personalization | User's NAICS/state in briefing | Matches profile |

#### Quality Tests
| Test | Method | Pass Criteria |
|------|--------|---------------|
| Content relevance | User survey (1-5 rating) | Avg > 3.5 |
| Actionable insights | "Did this help you?" button | >50% yes |
| Information accuracy | Spot check 20 briefings/week | <2% errors |

---

## 3. Evaluation Criteria (Metrics Dashboard)

### Primary Metrics (Track Daily)

```sql
-- Create metrics tracking table
CREATE TABLE intelligence_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  metric_type TEXT NOT NULL,  -- 'alerts', 'briefings', 'unified'

  -- Volume
  emails_attempted INTEGER,
  emails_sent INTEGER,
  emails_failed INTEGER,

  -- Engagement
  emails_opened INTEGER,
  emails_clicked INTEGER,
  unsubscribes INTEGER,

  -- Quality
  opportunities_matched INTEGER,
  avg_match_score NUMERIC,
  user_feedback_positive INTEGER,
  user_feedback_negative INTEGER,

  -- Performance
  cron_duration_ms INTEGER,
  api_calls_made INTEGER,
  api_errors INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_metrics_date ON intelligence_metrics(date);
CREATE INDEX idx_metrics_type ON intelligence_metrics(metric_type);
```

### KPI Dashboard

| Metric | Baseline (Day 1) | Target (Day 30) | Red Flag |
|--------|------------------|-----------------|----------|
| **Delivery Rate** | Measure | >95% | <90% |
| **Open Rate** | Measure | >25% | <15% |
| **Click Rate** | Measure | >10% | <5% |
| **Unsubscribe Rate** | Measure | <2% | >5% |
| **User Complaints** | 0 | <5 total | >10 |
| **API Uptime** | 100% | >99% | <95% |
| **Cron Success** | 100% | >99% | <95% |

### Weekly Review Checklist

```markdown
## Week [N] Review

### Delivery
- [ ] Emails sent: ___
- [ ] Delivery rate: ___%
- [ ] Bounce rate: ___%
- [ ] Spam complaints: ___

### Engagement
- [ ] Open rate: ___%
- [ ] Click rate: ___%
- [ ] Unsubscribes: ___

### Quality
- [ ] User feedback collected: ___
- [ ] Positive/Negative ratio: ___
- [ ] Support tickets: ___

### Technical
- [ ] Cron failures: ___
- [ ] API errors: ___
- [ ] Average response time: ___ms

### Action Items
1. ___
2. ___
3. ___
```

---

## 4. Guardrails

### Pre-Send Guardrails

```typescript
// Before sending any email batch

async function validateBeforeSend(batch: EmailBatch): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Volume guardrail - don't send more than expected
  const expectedMax = await getExpectedUserCount() * 1.1; // 10% buffer
  if (batch.recipients.length > expectedMax) {
    errors.push(`Batch size ${batch.recipients.length} exceeds expected ${expectedMax}`);
  }

  // 2. Content guardrail - ensure emails have content
  for (const email of batch.emails) {
    if (!email.opportunities || email.opportunities.length === 0) {
      warnings.push(`Empty opportunities for ${email.recipient}`);
    }
    if (email.opportunities?.length > 50) {
      warnings.push(`Too many opps (${email.opportunities.length}) for ${email.recipient}`);
    }
  }

  // 3. Rate limit guardrail - don't exceed SMTP limits
  const smtpLimit = 500; // per hour
  if (batch.recipients.length > smtpLimit) {
    // Chunk into batches
    batch.chunked = true;
    batch.chunkSize = Math.floor(smtpLimit * 0.9);
  }

  // 4. Time guardrail - only send during appropriate hours
  const hour = new Date().getUTCHours();
  if (hour < 10 || hour > 22) { // UTC
    warnings.push('Sending outside normal hours');
  }

  // 5. Duplicate guardrail - check dedup cache
  const duplicates = await checkForDuplicates(batch.recipients);
  if (duplicates.length > 0) {
    errors.push(`${duplicates.length} users would receive duplicate emails`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    canProceed: errors.length === 0 && warnings.length < 10
  };
}
```

### Runtime Guardrails

```typescript
// During cron execution

const GUARDRAILS = {
  // Stop if too many failures
  maxConsecutiveFailures: 5,
  maxTotalFailures: 50,

  // Stop if API is down
  maxApiErrors: 10,

  // Stop if sending too slow
  maxDurationMinutes: 30,

  // Stop if unexpected results
  minMatchRate: 0.1, // At least 10% of users should have matches
  maxMatchRate: 0.99, // Suspiciously high
};

class GuardrailMonitor {
  private failures = 0;
  private consecutiveFailures = 0;
  private apiErrors = 0;
  private startTime = Date.now();

  check(): { continue: boolean; reason?: string } {
    if (this.consecutiveFailures >= GUARDRAILS.maxConsecutiveFailures) {
      return { continue: false, reason: 'Too many consecutive failures' };
    }
    if (this.failures >= GUARDRAILS.maxTotalFailures) {
      return { continue: false, reason: 'Too many total failures' };
    }
    if (this.apiErrors >= GUARDRAILS.maxApiErrors) {
      return { continue: false, reason: 'API appears to be down' };
    }
    const duration = (Date.now() - this.startTime) / 60000;
    if (duration >= GUARDRAILS.maxDurationMinutes) {
      return { continue: false, reason: 'Execution taking too long' };
    }
    return { continue: true };
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
  }

  recordFailure() {
    this.failures++;
    this.consecutiveFailures++;
  }

  recordApiError() {
    this.apiErrors++;
  }
}
```

### Post-Send Guardrails

```typescript
// After batch completes

async function postSendValidation(results: SendResults): Promise<void> {
  // 1. Alert on high failure rate
  const failureRate = results.failed / results.attempted;
  if (failureRate > 0.1) {
    await alertOps(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
  }

  // 2. Alert on unusual patterns
  if (results.sent === 0 && results.attempted > 0) {
    await alertOps('CRITICAL: Zero emails sent despite attempts');
  }

  // 3. Log metrics for dashboard
  await logMetrics({
    date: new Date().toISOString().split('T')[0],
    metric_type: 'alerts',
    emails_attempted: results.attempted,
    emails_sent: results.sent,
    emails_failed: results.failed,
    cron_duration_ms: results.duration,
  });

  // 4. Schedule retry for failures
  if (results.failedRecipients.length > 0) {
    await scheduleRetry(results.failedRecipients, { delay: '1h', maxRetries: 3 });
  }
}
```

### Circuit Breaker Pattern

```typescript
// Automatic disable if things go wrong

class IntelligenceCircuitBreaker {
  private static FAILURE_THRESHOLD = 0.2; // 20% failure rate
  private static WINDOW_SIZE = 100; // Last 100 attempts
  private static COOLDOWN_MINUTES = 30;

  private attempts: boolean[] = []; // true = success, false = failure
  private trippedAt: Date | null = null;

  isOpen(): boolean {
    if (this.trippedAt) {
      const cooldownExpired =
        Date.now() - this.trippedAt.getTime() > this.COOLDOWN_MINUTES * 60000;
      if (cooldownExpired) {
        this.trippedAt = null; // Reset
        return false;
      }
      return true; // Still in cooldown
    }
    return false;
  }

  record(success: boolean) {
    this.attempts.push(success);
    if (this.attempts.length > IntelligenceCircuitBreaker.WINDOW_SIZE) {
      this.attempts.shift();
    }

    // Check if we should trip
    const failures = this.attempts.filter(a => !a).length;
    const failureRate = failures / this.attempts.length;

    if (failureRate >= IntelligenceCircuitBreaker.FAILURE_THRESHOLD) {
      this.trip();
    }
  }

  private trip() {
    this.trippedAt = new Date();
    console.error('[Circuit Breaker] TRIPPED - Intelligence delivery paused');
    // Alert ops team
    alertOps('Circuit breaker tripped - intelligence delivery paused for 30 minutes');
  }
}
```

---

## 5. Required Agents/Tools/Skills Before Building

### A. MCP Tools Needed

| Tool | Purpose | Status | Build First? |
|------|---------|--------|--------------|
| `mcp__samgov__*` | SAM.gov opportunity search | ✅ Built | No |
| `mcp__samgov__get_forecast` | Acquisition forecasts | ✅ Built | No |
| `mcp__stripe__*` | Payment/subscription checks | ✅ Built | No |
| `mcp__grants__search` | Grants.gov search | ⏳ API under maintenance | Wait |
| `mcp__usaspending__awards` | Contract awards lookup | ❌ Not built | Nice to have |

### B. Background Cron Jobs Needed

| Cron | Purpose | Status | Build First? |
|------|---------|--------|--------------|
| `daily-alerts` | Send daily opportunity alerts | ✅ Built | No |
| `weekly-alerts` | Send weekly digest | ✅ Built | No |
| `send-briefings` | Send daily briefings | ✅ Built | No |
| `health-check` | Monitor API health | ✅ Built | No |
| `metrics-collector` | Collect daily metrics | ❌ Not built | **YES** |
| `recompete-intel` | Expiring contract alerts | ❌ Not built | Phase 2 |
| `teaming-intel` | New contractor alerts | ❌ Not built | Phase 2 |

### C. Admin Endpoints Needed

| Endpoint | Purpose | Status | Build First? |
|----------|---------|--------|--------------|
| `/api/admin/trigger-alerts` | Manual alert trigger | ✅ Built | No |
| `/api/admin/metrics-dashboard` | View KPI metrics | ❌ Not built | **YES** |
| `/api/admin/guardrail-status` | Check circuit breaker | ❌ Not built | **YES** |
| `/api/admin/user-feedback` | View feedback | ❌ Not built | **YES** |
| `/api/cron/health-check` | API health status | ✅ Built | No |

### D. Database Tables Needed

| Table | Purpose | Status | Build First? |
|-------|---------|--------|--------------|
| `user_notification_settings` | Alert preferences | ✅ Exists | No |
| `user_profiles` | Access flags | ✅ Exists | No |
| `intelligence_metrics` | KPI tracking | ❌ Not built | **YES** |
| `intelligence_log` | Delivery tracking | ❌ Not built | **YES** |
| `user_feedback` | Feedback collection | ❌ Not built | **YES** |
| `govcon_profiles` | Unified profile | ❌ Not built | Phase 2 |

### E. Email Templates Needed

| Template | Purpose | Status | Build First? |
|----------|---------|--------|--------------|
| Daily alerts email | Opportunity alerts | ✅ Built | No |
| Weekly digest email | Weekly summary | ✅ Built | No |
| Daily briefing email | Intelligence briefing | ✅ Built | No |
| Feedback request email | Collect user feedback | ❌ Not built | **YES** |
| Unified briefing email | Combined intel | ❌ Not built | Phase 2 |

### F. Slash Commands/Skills Needed

| Command | Purpose | Status | Build First? |
|---------|---------|--------|--------------|
| `/daily-ops` | Morning health check | ✅ Built | No |
| `/deploy` | Deploy with tests | ✅ Built | No |
| `/metrics [days]` | View intelligence metrics | ❌ Not built | Nice to have |
| `/circuit-status` | Check guardrail status | ❌ Not built | Nice to have |

---

## 6. Build Order (Pre-Implementation)

### Must Build BEFORE 30-Day Test Continues:

```
Week 1: Measurement Infrastructure
├── Day 1-2: Create intelligence_metrics table
├── Day 3: Create intelligence_log table
├── Day 4: Create user_feedback table
├── Day 5: Build /api/admin/metrics-dashboard
├── Day 6: Build /api/admin/guardrail-status
└── Day 7: Add metrics collection to existing crons

Week 2: Guardrails & Monitoring
├── Day 1-2: Implement GuardrailMonitor class
├── Day 3: Implement CircuitBreaker class
├── Day 4: Add pre-send validation to daily-alerts
├── Day 5: Add post-send validation to daily-alerts
├── Day 6: Build feedback email template
└── Day 7: Add feedback request to weekly digest
```

### Can Build AFTER 30-Day Test (Phase 2):

```
- govcon_profiles table (unified profile)
- recompete-intel cron
- teaming-intel cron
- content-prompts cron
- unified-briefing cron
- /start page deployment
- 8,000 lead conversion campaign
```

---

## 7. Testing Checklist (Run Before Declaring Success)

### Week 1 Checkpoint
- [ ] Metrics table created and receiving data
- [ ] Guardrails implemented and tested
- [ ] Health check passing daily
- [ ] Zero unhandled errors in logs
- [ ] At least 1 user feedback received

### Week 2 Checkpoint
- [ ] Delivery rate > 95%
- [ ] No circuit breaker trips
- [ ] Open rate baseline established
- [ ] No user complaints
- [ ] Metrics dashboard showing data

### Week 3 Checkpoint
- [ ] Open rate trending up or stable
- [ ] Click rate > 5%
- [ ] Unsubscribe rate < 2%
- [ ] User feedback > 50% positive
- [ ] No major bugs reported

### Week 4 (Final) Checkpoint
- [ ] All KPI targets met
- [ ] User survey sent and analyzed
- [ ] Technical debt documented
- [ ] Phase 2 plan finalized
- [ ] Go/No-Go decision documented

---

## Summary

**What's missing:** Metrics, guardrails, feedback loops, testing criteria

**What to build first:**
1. `intelligence_metrics` table
2. `intelligence_log` table
3. `user_feedback` table
4. `/api/admin/metrics-dashboard`
5. `/api/admin/guardrail-status`
6. GuardrailMonitor + CircuitBreaker classes
7. Feedback email template

**Timeline:** 2 weeks to build measurement infrastructure, then continue 30-day test with proper visibility.
