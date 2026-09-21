# PRD — My Clients Access & Pricing Model

**Status:** Implemented June 11, 2026  
**Related:** `PRD-public-tier-naming.md`, `PRD-coach-mode-apex.md`, `MI-SAAS-PRICING-STRATEGY.md`

---

## 1. Who gets My Clients?

| Audience | Access | Reason code |
|----------|--------|-------------|
| **Teams** (`team` tier) | ✅ Full | `team` |
| **Enterprise** (`enterprise` tier) | ✅ Full | `enterprise` |
| **GovCon Giants staff** | ✅ Full (no cap) | `staff` |
| **Existing org members** (grandfather) | ✅ Read + add (10 client cap) | `org_member` |
| **Solopreneur** (`pro`) — new users | ❌ Upgrade to Teams | `denied` |
| **Mindy** (`free`) | ❌ Upgrade to Teams | `denied` |

**Solopreneur is one business.** My Clients is a **Teams+** capability per the public tier ladder.

**Grandfather rule:** Users who already have an `org_members` row (coach or org_admin) keep access even on Pro — e.g. Eric's solo-consultant org with Drone Monster. Cap matches Teams solo consultant: **10 active clients**.

Implementation: `src/lib/mindy/coach-access.ts` → `resolveCoachAccess()`.

---

## 2. How we sell it — seat vs license vs both

### Recommended model: **both**, tier-dependent

| Buyer shape | Product | Pricing model | My Clients included? |
|-------------|---------|---------------|----------------------|
| **Solo consultant / coach** | Mindy **Teams** ($499/mo) | **1 seat license** includes My Clients for up to **10 client workspaces** | ✅ Built-in |
| **Small BD shop (employees)** | Mindy **Teams** ($499/mo) | **5-seat bundle** — shared company pipeline; My Clients optional if they also consult | ✅ Same SKU |
| **APEX / SBDC / USHCC** | Mindy **Enterprise** | **Org license** — annual contract, N coach seats + M member seats | ✅ Org-wide |
| **Solopreneur who only wants 1–2 clients** | Future add-on (not shipped) | `$49/mo` My Clients add-on on Pro | 🔜 Roadmap only |

### Why both models?

- **Seat (Teams):** A consultant buys one Teams seat → manages up to 10 clients. Simple self-serve Stripe checkout (`NEXT_PUBLIC_TEAM_CHECKOUT_URL`). Aligns with "consultant = fractional BD for many businesses."
- **License (Enterprise):** National orgs (APEX, chambers) need **org provisioning**, white-label tab, multi-coach assignment, reporting — sold as annual org license, not per-seat self-serve.
- **Not both on Pro today:** Letting every $149/mo Solopreneur spin up unlimited client orgs undercuts Teams and confuses the who-buys ladder.

### Client workspace limits

| Tier / reason | Max active clients |
|---------------|-------------------|
| Teams | 10 |
| Grandfather (Pro + existing org) | 10 |
| Enterprise | No practical cap |
| Staff | No cap |

Additional clients beyond cap → upgrade conversation (Enterprise or custom).

---

## 3. Gating surfaces

| Surface | Behavior |
|---------|----------|
| Sidebar **My Clients** | Locked for free/pro without grandfather; Teams badge |
| `/api/app/coach` GET/POST | `resolveCoachAccess()` — blocks auto-org creation for Pro |
| `CoachPanel` | Upgrade CTA when `coachAccess.allowed === false` |
| `ClientWorkspaceBanner` | Hidden when no coach access |
| `/api/access/check` | Returns `coachMode` object for client gating |

---

## 4. Upgrade path

Pro/free user clicks **My Clients** → **Teams upgrade modal** ($499/mo, 5 seats + My Clients) → Stripe Team checkout → webhook grants `access_team` → coach mode unlocks.

Staff and grandfathered org members bypass the paywall.

---

## 5. Decisions & open questions

### Coach Mode add-on — BUILT July 6, 2026
- **Price: `$99/mo`** (raised from the originally-approved $49 — $49 undercut Teams at
  ~$16/client vs Teams' per-client; $99 anchors better and protects the Teams tier).
- **Cap: 3 client workspaces, HARD BLOCK** at the cap (Eric's call — not a soft warning).
  4th client → "Upgrade to Mindy Teams" CTA.
- **Teams cap lowered 10 → 5** (Eric, same session) so the ladder is tight: add-on 3 →
  Teams 5 → Enterprise unlimited. Verified no real Teams org has >5 active clients (only
  NCMBC at 60, which is `enterprise` tier = unlimited, unaffected).
- **Entitlement:** `user_profiles.access_coach_addon` (migration
  `20260706_coach_addon_access.sql`). The user stays `pro` — the add-on grants coach
  access WITHOUT a tier change. Set by the Stripe webhook on the $99 purchase (matched by
  "Coach Mode" description or the $99/mo amount).
- **Checkout:** `NEXT_PUBLIC_COACH_ADDON_CHECKOUT_URL` (Stripe payment link TBD — button
  routes to `/market-intelligence#coach-addon` until set; fails safe, no charge).
- **Files:** `coach-access.ts` (reason `coach_addon`, `COACH_CLIENT_LIMITS.coachAddon=3`,
  `team=5`), `stripe-webhook/route.ts`, `products.ts` (`COACH_ADDON`),
  `CoachPanel.tsx` (add-on-first upgrade UI), `coach/route.ts` (cap → Teams CTA).

### Eric to decide (still open)
1. **USHCC Atlanta pilot** — see pricing options below (director-only vs 20-member license).

---

*Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>*
