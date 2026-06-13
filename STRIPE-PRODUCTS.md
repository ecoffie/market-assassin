# Market Assassin - Stripe Products Reference

Complete reference for Stripe products, prices, and payment links.

---

## Product Configuration

Source of truth: `src/lib/products.ts`

---

## Individual Products

| Product | Price | Stripe Payment Link | KV Key | Tier Metadata |
|---------|-------|---------------------|--------|---------------|
| Opportunity Hunter Pro | $49 | `buy.stripe.com/00wcN60ke97c5d384UfnO0i` | `ospro:{email}` | `hunter_pro` |
| Content Reaper (Engine) | $197 | `buy.stripe.com/dRmcN64Au6Z4axn84UfnO0m` | `contentgen:{email}` | `content_standard` |
| Market Assassin Standard | $297 | `buy.stripe.com/3cI3cw9UOdns34V84UfnO0j` | `ma:{email}` | `assassin_standard` |
| Content Reaper (Full Fix) | $397 | `buy.stripe.com/aFa9AU4Au1EKaxn5WMfnO0n` | `contentgen:{email}` | `content_full_fix` |
| Recompete Tracker | $397 | `buy.stripe.com/7sYfZi9UOdnsaxnbh6fnO0k` | `recompete:{email}` | `recompete` |
| Federal Contractor Database | $497 | `buy.stripe.com/4gMaEY3wqcjo6h70CsfnO0g` | `dbaccess:{email}` | `contractor_db` |
| Market Assassin Premium | $497 | `buy.stripe.com/5kQdRaeb497cfRHdpefnO0f` | `ma:{email}` | `assassin_premium` |

---

## Upgrade Products

| Product | Price | Stripe Payment Link | Description |
|---------|-------|---------------------|-------------|
| Content Reaper Full Fix Upgrade | $200 | `buy.stripe.com/9B6cN62sm2IO7lb4SIfnO0o` | Engine → Full Fix |
| Market Assassin Premium Upgrade | $200 | `buy.stripe.com/5kQ8wQ9UObfk34V3OEfnO0p` | Standard → Premium |

---

## Bundles

| Bundle | Price | Value | Stripe Payment Link | Includes |
|--------|-------|-------|---------------------|----------|
| GovCon Starter | $697 | $943 | `buy.stripe.com/6oU9AUeb46Z46h70CsfnO0s` | OH Pro ($49), Recompete ($397), Contractor DB ($497) |
| Pro Giant | $997 | $1,388 | `buy.stripe.com/dRm7sMaYS0AG0WN5WMfnO0q` | Contractor DB, Recompete, MA Standard, Content Reaper |
| Ultimate GovCon | $1,497 | $1,788 | `buy.stripe.com/6oU3cwff897ceND84UfnO0t` | Content Full Fix, Contractor DB, Recompete, MA Premium |

---

## Subscriptions

| Product | Price | Product ID | Description |
|---------|-------|------------|-------------|
| Alert Pro | $19/mo | `prod_U9rOClXY6MFcRu` | Daily SAM.gov alerts, includes OH Pro |
| Federal Help Center | $99/mo | `prod_TaiXlKb350EIQs` or `prod_TMUmxKTtooTx6C` | MA Standard + Alert Pro (revoked on cancel) |

---

## Mindy Pro (getmindy.ai)

| Product | Price | Checkout route | Stripe Payment Link | Tier metadata |
|---------|-------|----------------|---------------------|---------------|
| Mindy Pro Monthly | $149/mo | `/checkout/mindy-pro-monthly` | `buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C` | (subscription) |
| Mindy Pro Annual | $1,490/yr | `/checkout/mindy-pro-annual` | `buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D` | (subscription) |
| **Bootcamp Lifetime** | **$1,497 one-time** | `/checkout/bootcamp-lifetime` | `buy.stripe.com/6oU3cwff897ceND84UfnO0t` (legacy Ultimate link — update metadata) | `tier=briefings_lifetime` |
| **Founders Lifetime** | **$4,997 one-time** | `/checkout/founders-lifetime` | `buy.stripe.com/28E00k6IC5V0fRH5WMfnO0G` | `tier=briefings_lifetime` |

**Sales page:** `https://getmindy.ai/lifetime`

**1-1-1 model:** One product (Mindy Pro). Lifetime grants `briefings_lifetime` only — no separate legacy tool flags for new purchases. Ultimate Giant Bundle is retired as a offer; bootcamp uses $1,497 lifetime pricing.

**Partner attribution:** Share `getmindy.ai/checkout/founders-lifetime?ref=NCMBC` — never raw `buy.stripe.com` links.

### Stripe setup checklist (Eric)

**Founders Lifetime ($4,997):**
- [x] Create product "Mindy Founders Lifetime" — $4,997 USD one-time
- [x] Payment Link metadata: `tier=briefings_lifetime`
- [x] Payment link: `buy.stripe.com/28E00k6IC5V0fRH5WMfnO0G`
- [ ] After-payment redirect: `https://getmindy.ai/purchase/success?product=founders-lifetime`
- [x] Replace placeholder in `purchase-attribution.ts`

**Bootcamp Lifetime ($1,497):**
- [ ] Create new Payment Link OR update existing Ultimate link metadata to `tier=briefings_lifetime` only
- [ ] Update `bootcamp-lifetime.checkoutUrl` if new link created
- [ ] After-payment redirect: `https://getmindy.ai/purchase/success?product=bootcamp-lifetime`

**Verify:** Test purchase → `user_profiles.access_briefings=true`, welcome email sent.

**Deprecated:** $2,997 "standard lifetime" tier — removed. Founders = $4,997 capped at 100 seats.

---

## Webhook Configuration

**Endpoint (live):** `https://getmindy.ai/api/stripe-webhook`  
**Stripe endpoint ID:** `we_1SlciyK5zyiZ50PBzCmDeI2K`

### Webhook Secrets
- `STRIPE_WEBHOOK_SECRET` - Live webhook secret (must match endpoint above in Vercel)
- `STRIPE_TEST_WEBHOOK_SECRET` - Test webhook secret

### Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Triple-write (Supabase + KV + email) + **30% affiliate commission** (initial payment) |
| `invoice.paid` | **30% affiliate commission** on subscription renewals (skips `subscription_create` — checkout already counted) |
| `customer.subscription.deleted` | Revoke FHC/Alert Pro access |
| `customer.subscription.updated` | Check for cancellation/past_due |

### Affiliate payout tracking
- Ledger: Vercel KV (`mindy:affiliate:*`)
- Dashboard: Launch Command Center → Partner & Affiliate Programs
- API: `GET /api/admin/partner-referrals?password=...&code=NCMBC`
- Payouts: **manual** (no Stripe Connect / Rewardful yet)

### Triple-Write Flow

1. **Supabase `purchases` table** - Record transaction
2. **Supabase `user_profiles` table** - Update access flags
3. **Vercel KV** - Set access key
4. **Email** - Send product-specific welcome email

---

## Access Key Patterns (Vercel KV)

| Pattern | Product |
|---------|---------|
| `ma:{email}` | Market Assassin |
| `ospro:{email}` | Opportunity Hunter Pro |
| `alertpro:{email}` | Alert Pro subscription |
| `contentgen:{email}` | Content Reaper |
| `recompete:{email}` | Recompete Tracker |
| `dbaccess:{email}` | Federal Contractor Database |
| `briefings:{email}` | Daily Briefings |

---

## Email Templates by Tier

| Tier | Email Function |
|------|----------------|
| `hunter_pro` | `sendOpportunityHunterProEmail()` |
| `contractor_db` | `sendDatabaseAccessEmail()` |
| `assassin_standard`, `assassin_premium` | `sendAccessCodeEmail()` |
| `content_standard`, `content_full_fix` | `sendContentReaperEmail()` |
| `recompete` | `sendRecompeteEmail()` |
| `alert_pro` | `sendAlertProWelcomeEmail()` |
| `fhc_membership` | `sendFHCWelcomeEmail()` |
| Bundle purchases | `sendBundleEmail()` |

---

## FHC Membership Access Grants

When FHC subscription is active:
- Market Assassin Standard (`ma:{email}`)
- Alert Pro (`alertpro:{email}`)
- Opportunity Hunter Pro (`ospro:{email}`)
- Daily alert frequency set to `daily`

When FHC subscription is canceled:
- All above access revoked
- Alert frequency reverted to `weekly`

---

## Testing

### Test Mode
- Set `STRIPE_TEST_SECRET_KEY` in `.env.local`
- Set `STRIPE_TEST_WEBHOOK_SECRET` in `.env.local`
- Webhook handler tries live secret first, falls back to test

### Manual Testing
```bash
# Trigger Stripe CLI for local webhook testing
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

---

*Last Updated: June 13, 2026 — Founders Lifetime $4,997 + Bootcamp $1,497 (1-1-1 pricing)*
