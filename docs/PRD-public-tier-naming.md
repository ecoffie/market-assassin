# PRD — Public Tier Naming (Who-Buys Repositioning)

**Status:** EXECUTE AFTER MIGRATION (Eric, June 10, 2026). Public-facing rename only.
**Owner framing:** "Change the naming to describe WHO should buy. Public-facing it's
just **Mindy** (not 'Mindy Free' — that's internal code). Mindy or Mindy Pro."

---

## 1. The rename — an ADDITIVE ladder; names describe WHO buys

**Each tier INCLUDES everything below it and ADDS capability.** A tier is not a
separate audience — it's the prior tier + more. ("For Teams you ADD, not take away
the other classifications" — Eric.)

| Internal code (`MITier`) | **Public name** | Who it's for | = prior tier PLUS |
|---|---|---|---|
| `free` | **Mindy** | an individual **curious about GovCon** (exploring, not yet operating) | the entry point (never shown as "Mindy Free"; just "Mindy") |
| `pro` | **Solopreneur** | a **solo operator** running their own BD (just them) | Mindy **+** the full BD suite for one person |
| `team` | **Teams** | a **small business WITH employees** AND **consultants / coaches / agencies handling multiple clients** | Solopreneur **+** multiple users (employees) **+** multi-client / Coach mode |
| `enterprise` | **Enterprise** | **national orgs** (APEX, USHCC) AND **mid/large businesses with 5+ BD staff** who need shared access | Teams **+** org-scale user management & controls (below) |

> **CRITICAL:** "Mindy Free" is **internal code only** (the `free` tier). Public copy
> says **"Mindy"** for the base and **"Mindy Pro" / "Solopreneur"** for paid. Admin/
> internal dashboards (Command Center) keep "Mindy Free/Mindy Pro" — those aren't
> public.

---

## 2. What each tier IS (additive value prop)

### 🟢 Mindy (`free`) — the curious individual
The explorer entry point for someone **curious about GovCon** — daily alerts + a
taste of market research, before they're operating. Public name is simply **Mindy**.

### 🔵 Solopreneur (`pro`, $149/mo) — the solo operator
**Everything in Mindy, plus** the full BD suite for one person running their own
shop: full market research, AI briefings, forecasts, pipeline, CRM, Proposal Assist.
*"Mindy Pro"* and *"Solopreneur"* are the same tier — lead with whichever converts.

### 🟣 Teams — multi-user (small businesses + consultants/agencies)
**Everything in Solopreneur, plus multiple users.** Serves TWO shapes of "more than
one person" with the same capability set:
1. A **small business with employees** — several people collaborating in one company.
2. A **consultant / coach / agency** managing **multiple clients** — built on the
   existing **multi-client / Coach mode** (isolated workspace per client, switch in
   one click, onboard a client from their capability statement).

The pitch: *"Mindy for your whole team — your employees, or every client you manage."*

### 🟠 Enterprise — orgs that need org-scale shared access
**Everything in Teams, plus org-scale management.** TWO audiences:
1. **National organizations** — APEX Accelerators, USHCC, etc. (serving many members).
2. **Mid / large businesses with 5+ BD staff** — a real company whose BD team has
   grown past a handful and needs **shared access** across its people.

Both need the org-scale capabilities:
- **Full user management** — provision/deprovision dozens of user profiles
- **Access controls** — roles/permissions across the org
- **User tracking + reporting** — see activity/outcomes across all users
- **Cross-user sharing** — share opportunities/intel/lists across the org
- **Group alerts** — send alerts to user groups
- **Calendar invites** — coordinate the org around events/deadlines
- Org-level admin dashboard

*(Enterprise's org capabilities are the main NET-NEW build — user-management, RBAC,
cross-user sharing, group messaging. Mindy/Solopreneur exist; Teams' multi-client
mode exists; the rename is public-surface, but Enterprise org features are a real
v2.0+ build — scope separately.)*

---

## 3. What to change (public surfaces only)
- `src/components/UnifiedSidebar.tsx` `tierInfo` → public display names (`free` →
  "Mindy", `pro` → "Solopreneur"/"Mindy Pro", `team` → "Teams", `enterprise` →
  "Enterprise"). **Keep the `MITier` keys (`free/pro/team/enterprise`) — code only.**
- `src/app/pricing/page.tsx` + `src/app/market-intelligence/page.tsx` — the public
  pricing/checkout copy.
- `src/lib/products.ts` — product display `name` (currently "Mindy Pro").
- Marketing literature `docs/MARKETING-FEATURE-LITERATURE.md` — positioning + the
  who-buys framing per tier.
- Signup / onboarding tier copy.

**Do NOT change:** the `MITier` type values, KV keys (`briefings:`), Stripe product
IDs, `MI_PRO`/`mi-pro` internal IDs, the `'MI Pro Upgrade'` admin segment key, or
admin-internal Command Center labels (not public).

## 4. Sequence
**Execute AFTER the mi→getmindy migration** (Eric). Order: migrate domain → settle
the trial/paid access (`PRD-trial-vs-paid-access.md`) → THEN the public rename
(Mindy / Solopreneur / Teams / Enterprise). Enterprise *capabilities* (user mgmt,
RBAC, sharing, group alerts) are a separate v2.0+ build, not part of the rename.

## 4b. Checkout / Stripe cleanup (found June 10 during migration QA)
The Stripe payment links work and are host-independent (migration-safe), but the
**public checkout copy needs the rename + a branding fix**:
- The **public Pro price is $149/mo** (link `dRmfZi9UO3MS20RdpefnO0C`). The **$49/mo
  link** (`00wfZigjc97ceND3OEfnO0z`) is **legacy/loyalty only — NOT promoted**
  (correctly commented out in `market-intelligence/page.tsx`). Make sure no public
  surface links the $49 loyalty checkout.
- The $49 checkout page still shows **"GovconEDU, LLC"** and **"Mindy Ai"** as the
  business/product name. Per the exit-strategy memory (no personal/legacy brand in
  product), update the Stripe product display name to **"Mindy"** / the new tier
  names ("Solopreneur" / "Mindy Pro") in the Stripe dashboard.
- Apply the tier rename to `src/lib/products.ts` display names + `pricing/page.tsx` +
  `market-intelligence/page.tsx` so checkout reflects Mindy / Solopreneur / Teams /
  Enterprise.

## 5. Open decisions
- **Spelling:** "Solopreneur" (confirmed — was a typo as "Soloprenuer").
- **"Mindy Pro" vs "Solopreneur":** are these the SAME tier with two names (lead with
  one), or is "Mindy Pro" retired in favor of "Solopreneur"? Confirm.
- **Teams price** (sidebar shows $499/mo today) — confirm public price.
- **Enterprise:** rename now (positioning) but gate the org capabilities as "contact
  sales / coming" until the user-management build ships?

*Related: `docs/ROADMAP.md`, `docs/PRD-trial-vs-paid-access.md`,
`tasks/mi-to-getmindy-cutover-runbook.md`. Tier code: `MITier` in UnifiedSidebar.tsx.*
