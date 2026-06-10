# PRD — Public Tier Naming (Who-Buys Repositioning)

**Status:** EXECUTE AFTER MIGRATION (Eric, June 10, 2026). Public-facing rename only.
**Owner framing:** "Change the naming to describe WHO should buy. Public-facing it's
just **Mindy** (not 'Mindy Free' — that's internal code). Mindy or Mindy Pro."

---

## 1. The rename — names describe the buyer, not the feature set

| Internal code (`MITier`) | **Public name** | Who it's for | What's distinctive |
|---|---|---|---|
| `free` | **Mindy** | individual contractors — the entry product | (never shown as "Mindy Free"; just "Mindy") |
| `pro` | **Solopreneur** | a solo contractor running their own BD | full Mindy for one operator |
| `team` | **Teams** | **Consultants / Agencies** handling multiple clients | multi-client workspaces (the Coach/multi-client mode) |
| `enterprise` | **Enterprise** | **National orgs** — APEX Accelerators, USHCC, etc. | many accounts + the org capabilities below |

> **CRITICAL:** "Mindy Free" is **internal code only** (the `free` tier). Public copy
> says **"Mindy"** for the base and **"Mindy Pro" / "Solopreneur"** for paid. Admin/
> internal dashboards (Command Center) keep "Mindy Free/Mindy Pro" — those aren't
> public.

---

## 2. What each tier IS (the value prop, by audience)

### 🟢 Mindy (`free`) — the individual contractor
Entry product. The full daily-alerts + market-research starting point. Public name is
simply **Mindy** — no "Free" suffix.

### 🔵 Solopreneur (`pro`, $149/mo) — the solo operator
Everything for one contractor running their own BD: full market research, AI
briefings, forecasts, pipeline, CRM, Proposal Assist. *"Mindy Pro"* and
*"Solopreneur"* are the same tier — lead with whichever converts.

### 🟣 Teams — Consultants & Agencies (multiple clients)
For a consultant or agency that **manages BD for several client businesses**. Built
on the existing **multi-client / Coach mode** (isolated workspace per client, switch
in one click, onboard a client from their capability statement). The pitch:
*"Run BD for every client you manage, from one place."*

### 🟠 Enterprise — National organizations (many users)
For organizations that need **many accounts / user profiles** — national orgs like
**APEX Accelerators, USHCC**, etc. Distinctive capabilities (the reason it's a
separate tier):
- **Full user management** — provision/deprovision dozens of user profiles
- **Access controls** — roles/permissions across the org
- **User tracking + reporting** — see activity/outcomes across all users
- **Cross-user sharing** — share opportunities/intel/lists across the org
- **Group alerts** — send alerts to user groups
- **Calendar invites** — coordinate the org around events/deadlines
- Org-level admin dashboard

*(Enterprise is the only tier that needs NET-NEW build — user-management, RBAC,
cross-user sharing, group messaging. The other three already exist; this is a
rename + positioning. Enterprise is a real v2.0+ build, scope separately.)*

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

## 5. Open decisions
- **Spelling:** "Solopreneur" (confirmed — was a typo as "Soloprenuer").
- **"Mindy Pro" vs "Solopreneur":** are these the SAME tier with two names (lead with
  one), or is "Mindy Pro" retired in favor of "Solopreneur"? Confirm.
- **Teams price** (sidebar shows $499/mo today) — confirm public price.
- **Enterprise:** rename now (positioning) but gate the org capabilities as "contact
  sales / coming" until the user-management build ships?

*Related: `docs/ROADMAP.md`, `docs/PRD-trial-vs-paid-access.md`,
`tasks/mi-to-getmindy-cutover-runbook.md`. Tier code: `MITier` in UnifiedSidebar.tsx.*
