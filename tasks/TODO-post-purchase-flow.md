# TODO: Post-Purchase Direct-Access Flow

**Status:** Captured 2026-05-22, deferred until after Stripe Team + Mindy AI rebrand stabilize
**Trigger:** Eric — "lets discuss the upgrade flow, what happens after the upgrade. The user wants direct access. after we finish stripe and everything else."

**Related:**
- [`tasks/TODO-stripe-team-pricing.md`](./TODO-stripe-team-pricing.md) — blocks this work (need Team product live first)
- [`tasks/PRD-onboarding-tour.md`](./PRD-onboarding-tour.md) — fires AFTER /welcome, when user enters /app
- [`src/app/api/stripe-webhook/route.ts`](../src/app/api/stripe-webhook/route.ts) — current webhook handler
- [`src/lib/send-email.ts`](../src/lib/send-email.ts) — `sendMarketIntelligenceWelcomeEmail()`

---

## North star

**User pays → lands signed-in on `/app` dashboard with Pro features active in <10 seconds.**

No magic-link email round-trip. No manual sign-in. No "switch to inbox, find welcome email, click link" friction at the moment of peak engagement.

Per Eric's vision: **direct dashboard access.**

---

## Current flow (the friction we're killing)

```
1. /market-intelligence → "Upgrade to Pro" button
   ↓
2. Stripe Checkout (Payment Link: https://buy.stripe.com/...)
   ↓
3. Pays. Stripe shows its default "Thank you for your purchase" screen.
   ↓
4. Webhook fires → /api/stripe-webhook:
   - Writes Vercel KV: briefings:{email} = true
   - Writes Supabase user_profiles.briefings_active = true
   - Sends sendMarketIntelligenceWelcomeEmail() to inbox
   ↓
5. User sees Stripe's success screen (no link back to Mindy).
   ↓
6. User must EITHER:
   (a) Switch to inbox, find welcome email, click "Open Mindy AI"
   (b) Manually type getmindy.ai/app in URL bar
   ↓
7. THEN sign in (Pro tier picked up via cookie/session)
   ↓
8. Lands on dashboard ~30-90 seconds after paying
```

Estimated drop-off at step 5-7: 30-50% never come back same-session. Activation lost.

---

## Target flow (direct access)

```
1. /market-intelligence → "Upgrade to Pro" button
   ↓
2. Stripe Checkout
   ↓
3. Pays → Stripe IMMEDIATELY redirects to:
   https://getmindy.ai/welcome?session_id={CHECKOUT_SESSION_ID}
   ↓
4. /welcome page (server-rendered):
   - Calls Stripe API with session_id to confirm payment_status === 'paid'
   - Detects whether user is signed in:
     A. SIGNED IN (came from in-app upgrade CTA):
        → Webhook has already written Pro flag
        → Their cookie session is still valid
        → /welcome shows celebration + auto-redirects to /app in 3s
        → Total time: ~5 seconds from "Pay" click to dashboard
     B. NOT SIGNED IN (came from email, marketing, search):
        → Server issues a one-click sign-in token tied to the email
          on the Stripe session
        → Renders the celebration page with that token embedded in
          the "Open Mindy AI →" button
        → Click → /api/auth/one-click?token=X → sets cookie → /app
        → Total time: ~10 seconds, no inbox round-trip
   ↓
5. Lands on /app dashboard, Pro features lit up.
   Onboarding tour (PRD-onboarding-tour.md) fires on first visit.
```

---

## Build plan (3 phases)

### Phase 1 — /welcome page + Stripe success URL config

**Effort:** ~1 day focused work

#### 1a. New page: `src/app/welcome/page.tsx`

Server component (Next.js App Router):

```typescript
import { stripe } from '@/lib/stripe';
import { getOrCreateOneClickToken } from '@/lib/auth/one-click';
import { getServerSession } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

export default async function WelcomePage({
  searchParams,
}: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  if (!session_id) redirect('/');

  // 1. Confirm payment with Stripe
  const session = await stripe.checkout.sessions.retrieve(session_id, {
    expand: ['customer', 'subscription'],
  });
  if (session.payment_status !== 'paid') {
    return <PaymentPendingView session={session} />;
  }

  const email = session.customer_details?.email?.toLowerCase();
  if (!email) return <ErrorView reason="missing-email" />;

  // 2. Are they already signed in?
  const currentSession = await getServerSession();
  const isAlreadySignedIn = currentSession?.email?.toLowerCase() === email;

  // 3. Generate one-click token if needed
  const oneClickToken = isAlreadySignedIn ? null : await getOrCreateOneClickToken(email);

  return (
    <CelebrationView
      email={email}
      tier={extractTier(session)}
      oneClickToken={oneClickToken}
      isAlreadySignedIn={isAlreadySignedIn}
    />
  );
}
```

The `<CelebrationView>` client component renders:
- 🎉 emoji + "You're in. Welcome to Mindy AI Pro."
- Brief celebration animation (~1 sec)
- Three "what to do first" tiles:
  - "Build your first market map" → /app/market-research
  - "Set up daily briefings" → /app/settings
  - "Save your first target" → /app/market-research?action=tour
- One primary button: "Open Mindy AI →"
  - If `isAlreadySignedIn`: `href="/app"` + auto-redirect after 3s
  - If not: `href="/api/auth/one-click?token=${oneClickToken}&redirect=/app"`

#### 1b. New endpoint: `/api/auth/one-click`

Takes a token, validates it (single-use, 24h TTL), sets the auth cookie, 302 to `redirect=` param.

Token table: `auth_one_click_tokens(token uuid, email text, expires_at timestamptz, used_at timestamptz)`. Migration needed.

#### 1c. Stripe Dashboard config

For each of the 4 payment links (Pro Monthly, Pro Annual, Team Monthly, Team Annual — Team blocked on TODO-stripe-team-pricing.md):

1. Stripe Dashboard → Payment Links → click the link → Edit
2. "After payment" → "Don't show confirmation page" → "Redirect to your own page"
3. URL: `https://getmindy.ai/welcome?session_id={CHECKOUT_SESSION_ID}`
4. Save

Stripe substitutes `{CHECKOUT_SESSION_ID}` with the actual ID at redirect time. Same syntax for both monthly + annual links.

### Phase 2 — Edge cases + polish (~half day)

| Edge case | Behavior |
|---|---|
| Webhook hasn't fired yet (race condition) | Show loading state for up to 10s; poll `/api/welcome/check-access?session_id=X` once per second until KV reflects Pro tier OR timeout → fallback to email instruction |
| Stripe redirect to `/welcome` fails / user closes tab | Welcome email STILL sends (existing behavior unchanged) — they fall back to inbox |
| Repeat purchase by existing user (upgrade Monthly → Annual) | /welcome detects existing Pro flag → shows "Upgraded to Annual ✓" instead of "Welcome!" |
| Team buyer | /welcome shows "5 seats unlocked" + "Invite teammates →" button → /app/team |
| Payment in dispute / pending | `payment_status !== 'paid'` → "We're processing your payment. You'll get an email when access is ready." |
| Network error calling Stripe API | Retry once, fallback gracefully to email-driven flow |

### Phase 3 — First-use onboarding tour

Already PRD'd at `tasks/PRD-onboarding-tour.md`. When the user lands on `/app` from `/welcome`, the react-joyride tour fires on first visit. This is the final piece — turns "I just paid for this" into "I just used this and got value."

---

## What I'd build in Phase 1 (concrete)

**Files:**

| File | Purpose |
|---|---|
| `supabase/migrations/20260???_auth_one_click_tokens.sql` | Token table for direct sign-in |
| `src/lib/auth/one-click.ts` | `getOrCreateOneClickToken()` + `validateOneClickToken()` |
| `src/app/api/auth/one-click/route.ts` | GET handler — validate token, set cookie, redirect |
| `src/app/welcome/page.tsx` | Server component — Stripe session lookup |
| `src/app/welcome/CelebrationView.tsx` | Client component — celebration UI + redirect timing |
| `src/app/api/welcome/check-access/route.ts` | Polling endpoint for webhook race |

**Stripe config:** 2-4 payment links updated to use `success_url` redirect.

**Total ~6-8 hours focused work.**

---

## Why deferred (per user)

Eric explicitly said "**after we finish stripe and everything else.**" Translation:
1. Stripe Team product needs to be created first (TODO-stripe-team-pricing.md)
2. The Mindy AI rebrand needs to settle (multiple commits today)
3. Then this work — which depends on Stripe Payment Links being final

Building /welcome before Team Stripe is wired means we'd ship it, then have to update it again when Team links come online. Not the end of the world but unnecessary churn.

Trigger to start: when both of the following are true:
- Stripe Team product is live with payment links
- No new pricing-page changes have shipped for 24 hours (rebrand is stable)

Then a focused session: build /welcome + one-click auth + edge cases in one push.

---

## What "direct access" specifically means

The user's quote: "**The user wants direct access.**"

What this rules out:
- Sending them to inbox to click a link (current flow)
- Requiring them to type their email + password
- A "Set up your account" wizard before they can see the dashboard
- Any "Verifying your account..." loading screen longer than 3 seconds

What this allows:
- A 2-3 second celebration page before /app
- The onboarding tour (it's overlaid on /app, doesn't block access)
- A "Welcome back" toast when they next visit

The mental model: **paying customers expect to walk into a working store, not fill out a clipboard at the door.**

---

## Test plan (when shipped)

1. **Happy path:** Pay with Stripe test card 4242 4242 4242 4242 → land on /welcome → 3s celebration → /app dashboard with Pro features lit up
2. **Already signed in:** Sign in first → upgrade → /welcome detects existing session → auto-redirects to /app in 3s
3. **Not signed in:** Buy from incognito → /welcome shows one-click button → click → cookie set → /app
4. **Repeat purchase:** Existing Pro user buys annual → /welcome shows "Upgraded ✓"
5. **Webhook race:** Manually delay webhook in test env → /welcome polls until KV updates
6. **Payment pending:** Use a Stripe test card that triggers SCA → /welcome shows pending state
7. **Tampered session_id:** Random session ID → /welcome shows 404-style error, doesn't crash
8. **Email mismatch:** User signed in as A, pays with email B → /welcome trusts the Stripe email, issues one-click for B
