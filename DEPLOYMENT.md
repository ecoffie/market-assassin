# Market Assassin - Deployment Guide

Deployment configuration and procedures for the Market Assassin platform.

---

## Project Deployments

| Project | Live URL | Git Repo | Vercel Project |
|---------|----------|----------|----------------|
| Market Assassin | tools.govcongiants.org | market-assassin | market-assassin |
| GovCon Shop | shop.govcongiants.org | govcon-shop | govcon-shop |
| GovCon Funnels | govcongiants.org | govcon-funnels | govcon-funnels |

---

## Quick Deploy

```bash
# Deploy to production
vercel --prod

# Deploy preview
vercel

# Force redeploy (clears cache)
vercel --prod --force
```

---

## Environment Variables

### Required for Production

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `STRIPE_SECRET_KEY` | Stripe live secret key | Stripe Dashboard → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Stripe Dashboard → Webhooks |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Supabase Dashboard → Settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role | Supabase Dashboard → Settings |
| `OPENAI_API_KEY` | OpenAI API key | OpenAI Dashboard |
| `GROQ_API_KEY` | Groq API key | Groq Console |
| `SMTP_USER` | Email sender address | hello@govconedu.com |
| `SMTP_PASSWORD` | Email SMTP password | Email provider |
| `CRON_SECRET` | Cron job authentication | Generate: `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | Admin endpoint auth | Default: galata-assassin-2026 |
| `SAM_API_KEY` | SAM.gov API key | SAM.gov Developer Portal |

### Optional

| Variable | Description |
|----------|-------------|
| `STRIPE_TEST_SECRET_KEY` | Stripe test mode key |
| `STRIPE_TEST_WEBHOOK_SECRET` | Test webhook secret |
| `SERPER_API_KEY` | Serper search API (for web intelligence) |
| `TWILIO_ACCOUNT_SID` | Twilio SMS (for briefings) |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_PHONE_NUMBER` | Twilio sender number |

### Setting Environment Variables

```bash
# Via Vercel CLI
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_SECRET_KEY preview
vercel env add STRIPE_SECRET_KEY development

# Or in Vercel Dashboard
# Settings → Environment Variables
```

---

## Cron Jobs

Configured in `vercel.json`:

| Cron Job | Schedule (UTC) | Purpose |
|----------|----------------|---------|
| `/api/cron/aggregate-profiles` | 6:00 AM daily | Aggregate user search history |
| `/api/cron/snapshot-opportunities` | 7:00 AM daily | Snapshot SAM.gov opportunities |
| `/api/cron/snapshot-recompetes` | 7:15 AM daily | Snapshot recompete contracts |
| `/api/cron/snapshot-awards` | 7:30 AM daily | Snapshot award data |
| `/api/cron/snapshot-contractors` | 7:45 AM daily | Snapshot contractor data |
| `/api/cron/web-intelligence` | 8:00 AM daily | Gather web intelligence |
| `/api/cron/send-briefings` | 9:00 AM daily | Send daily briefings |
| `/api/cron/daily-alerts` | 11:00 AM daily | Send Alert Pro daily alerts |
| `/api/cron/health-check` | 12:00 PM daily | System health check + email |
| `/api/cron/weekly-alerts` | 11:00 PM Sunday | Send weekly opportunity alerts |
| `/api/planner/weekly-digest` | 2:00 PM Monday | Send planner weekly digest |

### Manual Cron Trigger

```bash
# Trigger with cron secret
curl "https://tools.govcongiants.org/api/cron/health-check" \
  -H "Authorization: Bearer ${CRON_SECRET}"

# Or via admin password
curl "https://tools.govcongiants.org/api/admin/trigger-briefings?password=galata-assassin-2026"
```

---

## Build Configuration

### next.config.js Key Settings

```javascript
// Turbopack enabled (Next.js 16)
// Static exports for public HTML files
// API routes use serverless functions
```

### Build Commands

```bash
# Local build test
npm run build

# Type check only
npx tsc --noEmit

# Lint
npm run lint
```

---

## Stripe Webhook Setup

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://tools.govcongiants.org/api/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### Test Webhooks Locally

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:3000/api/stripe-webhook

# Test checkout event
stripe trigger checkout.session.completed
```

---

## Vercel KV Setup

1. In Vercel Dashboard → Storage → Create KV Database
2. Link to project
3. Environment variables auto-added:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
   - `KV_URL`

### KV is shared between projects
Both `market-assassin` and `govcon-shop` connect to the same KV store via Vercel Storage integration.

---

## Supabase Setup

### Create Tables

Run SQL schemas in order:
1. `src/lib/supabase/user-profiles-schema.sql`
2. `src/lib/supabase/purchases-schema-v2.sql`
3. `src/lib/supabase/briefings-schema.sql`
4. `src/lib/supabase/alerts-schema.sql`
5. `src/lib/supabase/planner-schema.sql`

### Enable Realtime (Optional)

```sql
-- For tables needing realtime updates
ALTER PUBLICATION supabase_realtime ADD TABLE user_profiles;
```

---

## Domain Configuration

### Vercel Domains

1. Vercel Dashboard → Project → Settings → Domains
2. Add domain: `tools.govcongiants.org`
3. Configure DNS at registrar:
   - CNAME `tools` → `cname.vercel-dns.com`

### SSL

Automatic via Vercel (Let's Encrypt).

---

## Monitoring

### Health Check

Automated daily at 12:00 PM UTC:
```bash
curl "https://tools.govcongiants.org/api/cron/health-check?email=true" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Tests 15+ endpoints including:
- Database connectivity
- KV store access
- External APIs (SAM.gov, USASpending)
- Email delivery

### Vercel Logs

```bash
# Real-time logs
vercel logs --follow

# Filter by function
vercel logs | grep stripe-webhook

# Last 100 lines
vercel logs --limit 100
```

### Error Tracking

Check Vercel Dashboard → Deployments → Functions for:
- Invocation count
- Error rate
- Duration
- Cold starts

---

## Rollback

```bash
# List deployments
vercel ls

# Promote previous deployment
vercel promote [deployment-url]

# Or via Dashboard
# Deployments → Click deployment → Promote to Production
```

---

## Pre-Deployment Checklist

- [ ] All TypeScript errors resolved (`npx tsc --noEmit`)
- [ ] Tests passing (`npm test`)
- [ ] Environment variables set in Vercel
- [ ] Stripe webhook configured
- [ ] KV store linked
- [ ] Supabase schema up to date
- [ ] CRON_SECRET matches Vercel env

---

## Post-Deployment Verification

```bash
# Check deployment status
vercel inspect [deployment-url]

# Test key endpoints
curl -s -o /dev/null -w "%{http_code}" https://tools.govcongiants.org/
curl -s -o /dev/null -w "%{http_code}" https://tools.govcongiants.org/api/health

# Run health check
curl "https://tools.govcongiants.org/api/cron/health-check" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

---

*Last Updated: March 20, 2026*
