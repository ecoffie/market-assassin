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

### Approved (not yet built)
- **Pro add-on** — `$49/mo` My Clients on Solopreneur, **3 client workspaces** cap.
  Keeps Teams as the serious consultant path (10 clients + seats); captures
  Pro users who only need 1–3 clients. Stripe product TBD.

### Eric to decide
1. **USHCC Atlanta pilot** — see pricing options below (director-only vs 20-member license).
2. **Client over cap** — Hard block at 10 or soft warning + sales CTA?

---

*Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>*
