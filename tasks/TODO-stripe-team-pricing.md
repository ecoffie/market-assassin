# TODO: Stripe Team Product + Checkout Wiring

**Status:** Captured 2026-05-22, blocked on Stripe Dashboard action
**Trigger:** Eric — "we need to make the team pricing in stripe"
**Related:**
- [`src/app/market-intelligence/page.tsx`](../src/app/market-intelligence/page.tsx) — Compare Plans table
- [`src/lib/products.ts`](../src/lib/products.ts) — product config (source of truth)
- [`src/app/api/stripe-webhook/route.ts`](../src/app/api/stripe-webhook/route.ts) — triple-write handler

---

## Why this matters

Today: the upgrade page Compare Plans table lists three tiers:
- **Pro** $149/mo → live Stripe checkout ✅
- **Team** $499/mo → "Contact Sales" mailto fallback ⏳ THIS WORK
- **Enterprise** Custom → "Talk to Sales" mailto ✅ (intentional — enterprise needs SOC2 review etc.)

The Team tier sits in a frustrating middle: not enterprise enough to need a sales call, but expensive enough that the friction of "email us" loses 60-80% of would-be buyers. Self-serve Stripe checkout for Team unblocks the "5 seats, want to buy now" segment.

---

## Step-by-step

### Step 1 — Create the Stripe Product (Stripe Dashboard)

You need to do this in the Stripe Dashboard since I don't have your live key.

1. Log into **dashboard.stripe.com** → **Products** → **+ Add product**
2. **Product info:**
   - Name: `Mindy AI Team`
   - Description: `5 seats — Mindy AI Pro + team admin dashboard + shared pipeline + priority support`
3. **Pricing — add TWO prices:**

   **Monthly:**
   - Pricing model: Standard
   - Price: `$499.00 USD`
   - Billing period: `Monthly`
   - Save → copy the Price ID (looks like `price_1A2B3C...`)

   **Annual** (matching the 17% discount we offer Pro):
   - Click "Add another price"
   - Price: `$4,990.00 USD`  (= $499 × 12 × 0.833 ≈ 2 months free, same logic as Pro)
   - Billing period: `Yearly`
   - Save → copy this Price ID too

4. **Generate Payment Links** for each price:
   - Stripe Dashboard → **Payment Links** → **+ New**
   - Select the Team Monthly price → enable promo codes optional → create
   - Copy the URL (looks like `https://buy.stripe.com/...`)
   - Repeat for Team Annual
   - Save both URLs — we'll paste them into `src/app/market-intelligence/page.tsx`

### Step 2 — Wire the checkout URLs (code change)

In `src/app/market-intelligence/page.tsx`:

```typescript
// Around line 9 where CHECKOUT_MONTHLY / CHECKOUT_ANNUAL live
const CHECKOUT_MONTHLY      = 'https://buy.stripe.com/dRmfZi9UO3MS20RdpefnO0C';  // Pro $149/mo
const CHECKOUT_ANNUAL       = 'https://buy.stripe.com/eVqfZi5Eydns0WNgBqfnO0D';  // Pro $1,490/yr
const CHECKOUT_TEAM_MONTHLY = 'https://buy.stripe.com/<NEW_TEAM_MONTHLY>';        // Team $499/mo
const CHECKOUT_TEAM_ANNUAL  = 'https://buy.stripe.com/<NEW_TEAM_ANNUAL>';         // Team $4,990/yr
```

### Step 3 — Replace "Contact Sales" mailto with checkout link

The Compare Plans table tfoot has:

```typescript
// Find this and replace
<a href="mailto:hello@govcongiants.com?subject=MI%20Team%20Inquiry"
   className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors text-xs">
  Contact Sales
</a>
```

Replace with:

```typescript
<a href={CHECKOUT_TEAM_MONTHLY}
   className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors text-xs">
  Start Team — $499/mo
</a>
```

Keep Enterprise as "Talk to Sales" — that one stays gated.

### Step 4 — Add Team to the pricing toggle (optional v2)

Right now the toggle card is Mindy Pro only. If you want Team purchasable from the toggle too, the cleanest UX is a second toggle row:

```
[ Solo / Team ]  ← new top toggle
[ Monthly / Annual ]  ← existing toggle
```

Two state variables: `tier: 'pro' | 'team'` + existing `billingPeriod`. The card price + CTA + feature list adapt based on both.

Deferred decision — for v1, just wiring the Compare Plans tfoot button is enough.

### Step 5 — Update Stripe webhook handler

`src/app/api/stripe-webhook/route.ts` writes to Vercel KV + Supabase `user_profiles` based on Stripe metadata. The Team product needs a tier identifier:

1. In Stripe Dashboard → Team product → **Metadata** → add:
   - `tier`: `mi_team`
   - `seats`: `5`

2. In the webhook handler, look at where it reads `metadata.tier` (e.g. `tier: briefings` for MI Pro). Add a branch for `tier: mi_team`:

```typescript
if (metadata.tier === 'mi_team') {
  // Grant team-tier access in KV + Supabase
  await kv.set(`briefings:${email}`, 'team', { ex: ... });
  await supabase.from('user_profiles').upsert({
    email,
    mi_team: true,
    mi_pro: true,  // team includes pro features
    seats_purchased: 5,
  });
}
```

3. **MITier type update** in `src/components/UnifiedSidebar.tsx`:

```typescript
// Current
export type MITier = 'free' | 'pro';
// Add team
export type MITier = 'free' | 'pro' | 'team';
```

4. Add `hasTeamAccess(userTier)` helper alongside the existing `hasProAccess()`.

### Step 6 — Team seat management (Phase 2)

When Team is purchased, the buyer gets 5 seats. They need a way to invite teammates. This is a separate workstream:

- `team_invitations` table (email, status, invited_by, invited_at)
- `/app/team` admin panel for the buyer
- Invite email flow
- Per-seat access check in `verifyMIAccess()`

Don't build this in the same session as the checkout wiring — ship checkout first, then invite flow after first paying team customer.

---

## Pricing math reference

| Tier | Monthly | Annual | Effective monthly | Discount |
|---|---|---|---|---|
| Pro | $149/mo | $1,490/yr | $124/mo | 17% (2 mo free) |
| **Team** | **$499/mo** | **$4,990/yr** | **$416/mo** | **17% (2 mo free)** |
| Enterprise | Custom | Custom | — | — |

Team monthly is **3.35× Pro monthly** for 5 seats — implying ~$100/seat vs Pro's $149/seat. Industry standard discount for team plans. Could push higher ($599/mo = 4×) but $499/mo is the typical "5-seat starter team" anchor.

---

## What you should do NOW

1. **Stripe Dashboard work** (Step 1) — create Team product + 2 prices + 2 payment links. 10 minutes.
2. **Paste the payment links** into a Slack/note for the next session. I'll wire Steps 2-5 in one commit when you hand me the URLs.

The Stripe Dashboard part is the unblocking step. Code work is ~30 min once URLs exist.

---

## Why captured, not built today

Eric is mid-session shipping the upgrade page rebuild. Stripe Dashboard work requires switching tools + careful product setup. Better to batch it: do all Stripe work in one focused 10-min sitting, then I wire all the code in one focused 30-min commit. Don't interleave.

---

## Test plan when shipped

1. Open the upgrade page → "Compare Plans" → "Start Team" tfoot button → confirm Stripe checkout opens with `Mindy AI Team — $499/mo`
2. Test purchase with Stripe test card `4242 4242 4242 4242`
3. Confirm webhook fires + writes `mi_team: true` in `user_profiles`
4. Sign in as the test buyer → confirm sidebar shows team-tier features (placeholder until Step 6 / invite flow)
5. Verify Pro pricing toggle still works unchanged (don't regress Pro checkout)
