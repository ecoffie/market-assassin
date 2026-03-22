# Market Assassin - Troubleshooting Guide

Common issues and solutions for the Market Assassin platform.

---

## Authentication & Access Issues

### User reports "Access Denied" but they purchased

**Diagnosis:**
```bash
# Check access in admin panel
curl "https://tools.govcongiants.org/api/admin/check-access?email=user@example.com&password=galata-assassin-2026"
```

**Common causes:**
1. **KV not set** - Webhook may have failed silently
2. **Email mismatch** - User used different email at checkout
3. **Supabase flags not updated** - Triple-write partial failure

**Fix:**
```bash
# Grant access via admin endpoint
curl -X POST "https://tools.govcongiants.org/api/admin/grant-ma-access?password=galata-assassin-2026" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "tier": "assassin_premium"}'
```

---

### Stripe webhook not triggering

**Symptoms:**
- Purchase completes but no email sent
- Access not granted

**Diagnosis:**
```bash
# Check Stripe webhook logs in dashboard
# Or check Vercel function logs
vercel logs --project=market-assassin | grep stripe-webhook
```

**Common causes:**
1. **Signature mismatch** - Check `STRIPE_WEBHOOK_SECRET` in Vercel env
2. **Wrong endpoint configured** - Verify webhook URL in Stripe dashboard
3. **Metadata missing** - Check Stripe payment link has `tier` metadata

**Fix:**
1. Verify webhook secret matches Stripe dashboard
2. Re-trigger event from Stripe dashboard
3. Or manually grant access via admin endpoint

---

## API Errors

### "Too many requests" / Rate limited (429)

**Rate limits:**
| Scope | Limit | Window |
|-------|-------|--------|
| Report generation | 50 | 24 hours |
| Content generation | 10 | 24 hours |
| Authenticated IP | 30 | 1 hour |
| Unauthenticated IP | 5 | 1 hour |
| Admin endpoints | 30 | 1 minute |

**Check usage:**
```bash
curl "https://tools.govcongiants.org/api/usage?email=user@example.com"
```

**Clear rate limit (KV):**
```javascript
// In Vercel KV dashboard
kv.del(`rl:report:user@example.com`)
kv.del(`rl:content:user@example.com`)
```

---

### "Account suspended due to unusual activity" (403)

**Cause:** User hit abuse detection threshold (500+ generations)

**Check status:**
```bash
curl "https://tools.govcongiants.org/api/admin/abuse-report?email=user@example.com&password=galata-assassin-2026"
```

**Clear abuse flag:**
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/abuse-report" \
  -H "Content-Type: application/json" \
  -d '{"password": "galata-assassin-2026", "action": "clear", "email": "user@example.com"}'
```

---

### SAM.gov API returning empty results

**Common causes:**
1. **Multiple NAICS codes** - SAM.gov doesn't support comma-separated codes
2. **Invalid NAICS format** - Must be 6-digit numeric
3. **API key expired** - Check `SAM_API_KEY` env var

**Fix for multiple NAICS:**
Make parallel requests for each NAICS code and merge results. See `src/lib/briefings/pipelines/sam-gov.ts` for implementation.

---

### USASpending API errors

**"Request timed out"**
- USASpending API can be slow
- Increase timeout or implement retry logic

**"No data found"**
- Check fiscal year (FY2025, FY2026)
- Verify agency name matches exactly
- Try broader search criteria

---

## Content Reaper Issues

### "API_BASE must be empty string"

**Rule:** In all `public/content-generator/*.html` files, `API_BASE` must be `''` (empty string).

**Wrong:**
```javascript
const API_BASE = 'https://tools.govcongiants.org';
```

**Correct:**
```javascript
const API_BASE = '';
```

---

### Generated posts showing [object Object]

**Cause:** Array interpolation without `.join()`

**Fix:** Use `.join(' ')` for arrays in templates:
```javascript
// Wrong
const text = `Using ${agencies}`;
// Right
const text = `Using ${agencies.join(', ')}`;
```

---

## Briefings Issues

### Briefings not sending

**Check cron status:**
```bash
# View cron logs
vercel logs --project=market-assassin | grep "send-briefings"
```

**Manual trigger:**
```bash
curl "https://tools.govcongiants.org/api/admin/trigger-briefings?password=galata-assassin-2026"
```

**Check user profile:**
```bash
curl "https://tools.govcongiants.org/api/briefings/preferences?email=user@example.com"
```

---

### "No opportunities in briefing"

**Causes:**
1. User has no NAICS codes in profile
2. SAM.gov returned empty for all NAICS
3. Profile aggregation hasn't run

**Fix:**
```bash
# Manually aggregate profile
curl -X POST "https://tools.govcongiants.org/api/cron/aggregate-profiles?password=galata-assassin-2026" \
  -d '{"email": "user@example.com"}'
```

---

## Database Issues

### Supabase query returning null

**Check RLS policies:**
- Ensure using service role key for admin operations
- Check `SUPABASE_SERVICE_ROLE_KEY` is set

**Test connection:**
```javascript
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const { data, error } = await supabase.from('user_profiles').select('*').limit(1);
console.log({ data, error });
```

---

### KV operations failing

**Check KV connection:**
```bash
# In Vercel dashboard → Storage → KV
# Or via API
curl "https://tools.govcongiants.org/api/admin/kv?key=ma:test@example.com&password=galata-assassin-2026"
```

**Common issues:**
1. `KV_REST_API_URL` or `KV_REST_API_TOKEN` not set
2. KV store not linked to project in Vercel

---

## Deployment Issues

### Build failing

**TypeScript errors:**
```bash
npx tsc --noEmit
```

**Missing dependencies:**
```bash
npm install
```

**Check for circular imports:**
```bash
npx madge --circular src/
```

---

### Vercel deployment not updating

**Force redeploy:**
```bash
vercel --prod --force
```

**Clear cache:**
```bash
vercel build --prod
```

---

### Environment variables not loading

**Check in Vercel dashboard:**
1. Settings → Environment Variables
2. Ensure variables are set for Production/Preview/Development

**Local development:**
```bash
# Copy from .env.example
cp .env.example .env.local
# Fill in values
```

---

## Health Check

Run the automated health check to verify all systems:

```bash
curl "https://tools.govcongiants.org/api/cron/health-check" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

This tests 15+ endpoints including:
- API connectivity
- Database connections
- KV store access
- External API availability (SAM.gov, USASpending)
- Email delivery (optional)

---

## Emergency Contacts

- **Supabase issues:** Check status.supabase.com
- **Vercel issues:** Check vercel.com/status
- **Stripe issues:** Check status.stripe.com
- **Support email:** service@govcongiants.com

---

*Last Updated: March 20, 2026*
