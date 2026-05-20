# OAuth Branding Runbook — `auth.getmindy.ai` custom domain

**Goal:** When users click "Continue with Google" or "Continue with Microsoft" on `getmindy.ai`, the consent screen should say **"Sign in to auth.getmindy.ai"** instead of the raw Supabase project subdomain (e.g. `kvpyefebckmnrmovh.supabase.co`).

**Why:** New users were seeing the Supabase subdomain in the Google consent UI, which looks like phishing/spam and erodes trust in the brand. Reported during May 20 2026 OAuth-on-landing rollout.

---

## Track A — Code is already correct, no app changes needed

The `signInWithOAuth` calls in `src/lib/supabase/auth.ts` only set the **post-OAuth redirect** (`/app/onboarding`). The "Sign in to X" line Google shows is driven by the **Supabase callback URL**, which lives at the Supabase project subdomain by default. To change it, we need to point Supabase auth through a Mindy-owned subdomain.

**No code changes are required for this rollout. Only Supabase, DNS, and Google/Microsoft console settings.**

---

## Track B — Supabase Custom Domain setup

> Requires **Supabase Pro** (Custom Domains is a Pro-tier feature, ~$25/month).
> Confirm the Mindy project is on Pro before starting — Settings → Subscription.

### 1. Add the custom domain in Supabase
1. Supabase Dashboard → Mindy project → **Project Settings → Custom Domains**
2. Click **"Add a new domain"**
3. Enter **`auth.getmindy.ai`**
4. Supabase will display:
   - A CNAME target like `xxxx.supabase.co` (copy this exact value — every project is different)
   - A TXT record for ownership verification

### 2. Add DNS records (wherever `getmindy.ai` DNS is managed — likely Vercel or Cloudflare)
- **CNAME** `auth.getmindy.ai` → `<value from Supabase>`
- **TXT** `_supabase.auth.getmindy.ai` → `<value from Supabase>` (only if Supabase asks)
- Propagation: usually 5–60 min. Use `dig auth.getmindy.ai CNAME` to verify.

### 3. Activate the domain in Supabase
1. Once DNS resolves, return to Supabase Custom Domains page
2. Click **"Verify"** → wait for green check
3. Click **"Activate"** — this is the cutover; allow ~2 min for the cert to provision

Once active, the Supabase project responds at **both**:
- `https://<project-id>.supabase.co` (old, still works)
- `https://auth.getmindy.ai` (new)

---

## Track C — Update OAuth provider settings

### 3a. Google Cloud Console
1. https://console.cloud.google.com → APIs & Services → **Credentials**
2. Find the OAuth 2.0 Client ID used for Mindy (it's the one referenced in Supabase Auth → Providers → Google)
3. **Authorized JavaScript origins** — add:
   - `https://auth.getmindy.ai`
   - `https://getmindy.ai`
4. **Authorized redirect URIs** — add (don't delete the old one yet, both should be valid during cutover):
   - `https://auth.getmindy.ai/auth/v1/callback`
5. Save

### 3b. Google OAuth Consent Screen (polish — separate from above)
While in Google Cloud Console:
1. APIs & Services → **OAuth consent screen**
2. **App name:** Mindy
3. **User support email:** hello@govconedu.com
4. **App logo:** upload Mindy logo (PNG, 120 × 120 px)
5. **Application home page:** https://getmindy.ai
6. **Application privacy policy:** https://getmindy.ai/privacy
7. **Application terms of service:** https://getmindy.ai/terms
8. **Authorized domains:** add `getmindy.ai`
9. Save

> Without filling these out, even after the custom domain is active, the consent screen will look unfinished.

### 3c. Microsoft / Azure
1. https://portal.azure.com → **Microsoft Entra ID → App registrations**
2. Find the Mindy app (referenced in Supabase Auth → Providers → Azure)
3. **Authentication** → Redirect URIs → add:
   - `https://auth.getmindy.ai/auth/v1/callback`
4. **Branding & properties:**
   - Publisher display name: GovCon Giants (or Mindy)
   - Home page URL: https://getmindy.ai
   - Logo: upload Mindy logo
5. Save

---

## Track D — Update Supabase Auth settings

1. Supabase → Mindy project → **Auth → URL Configuration**
2. **Site URL:** `https://getmindy.ai`
3. **Redirect URLs** — make sure these are all listed:
   - `https://getmindy.ai/app/onboarding`
   - `https://getmindy.ai/app/auth/callback`
   - `https://getmindy.ai/auth/callback`
   - `https://mi.govcongiants.com/app/onboarding` (legacy compatibility)
   - `https://mi.govcongiants.com/briefings`
   - `http://localhost:3000/**` (local dev)

If anything is missing, OAuth will throw "redirect_uri not allowed" after the custom-domain cutover.

---

## Track E — Verify end-to-end after cutover

1. Open a **fresh Incognito window**
2. Visit `https://getmindy.ai`
3. Click **Continue with Google** → consent screen should say **"Sign in to auth.getmindy.ai"** (or "Mindy" if Google has finished consent-screen verification — see Track F)
4. Approve → should land on `https://getmindy.ai/app/onboarding` signed in
5. Repeat with **Continue with Microsoft**
6. Visit `getmindy.ai/app` directly while signed in → should NOT be redirected back to landing

If anything fails, the Supabase project subdomain still works as a fallback — the old callback URL is still authorized in Google + Microsoft until step F.

---

## Track F (optional, slow — for full production polish)

1. **Submit Google OAuth for verification** — required if you'll exceed 100 users on the app. Takes 3–6 weeks. From OAuth consent screen → "Publish App" → submit for verification. Without it, users beyond the test list see "Google hasn't verified this app" with a yellow shield.
2. **Submit Microsoft for Publisher Verification** — similar process in Microsoft Partner Center. Takes 1–2 weeks. After verification, the consent screen shows the blue "verified" check.
3. Once both are verified, the consent screen says "Sign in to **Mindy**" (the App Name) with the verified badge, no scary warnings.

---

## Owner: Eric
**Estimated effort:**
- Tracks B–D: **30–60 min** of console work (assuming Supabase is already on Pro)
- DNS propagation: **5–60 min**
- Cutover + smoke test: **15 min**
- Track F (verification): **3–6 weeks of waiting** after submission

**Blocker check before starting:**
- [ ] Supabase Mindy project on Pro plan?
- [ ] Access to Google Cloud Console for the Mindy OAuth client?
- [ ] Access to Azure Portal for the Mindy app registration?
- [ ] Access to DNS for `getmindy.ai`?

If any are no, fix those first or hand the credentials to someone who has them.
