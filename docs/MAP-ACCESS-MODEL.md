# Map Access Model — audited, not assumed

**Read-only audit, 2026-08-23. No code was changed.** Every row below was traced to the
**actual auth/subscription check** and then confirmed against **production**, because the
label, the comment and the enforcement disagree in several places.

**This must be settled before `/today` becomes the homepage.** Header states that don't match
real gates will either promise access the backend refuses, or ask for payment the backend
doesn't require.

---

## The headline: there is almost no PAID tier on the Map today

Only **three** endpoints in the entire Map surface return `403 pro_required`:
`app/chat` (Ask Mindy), `app/rag-doc`, `app/chat-sessions`.

Everything else is either **public** or **free-login**. In particular — verified in prod —
**Proposal draft/export/compliance and Vault enforce login but NOT payment.**

> So the conceptual table we sketched (Proposal generation = Paid only) is **not** what
> production enforces. That gap is the decision to make, not a bug to quietly fix.

---

## Gate matrix

Legend — **PUBLIC** anonymous may use · **LOGIN** free account required at intent ·
**PAID** active subscription required.

| Surface / action | Anon | Free | Paid | Current enforcement (traced) | Prod result (anon) | Conflict? |
|---|:--:|:--:|:--:|---|---|---|
| `/opportunity-map` page | ✓ | ✓ | ✓ | none — route handler has no auth | serves | — |
| Today's Intel (`/today`) | ✓ | ✓ | ✓ | none | serves | — |
| Opportunity pins (`app/opportunity-map`) | ✓ | ✓ | ✓ | none | **200** | — |
| Forecast pins (`app/forecast-map`) | ✓ | ✓ | ✓ | none | **200** | — |
| Recompete pins (`app/recompete-map`) | ✓ | ✓ | ✓ | none | **200** | — |
| Grants pins (`app/grants-map`) | ✓ | ✓ | ✓ | none | **200** | — |
| Listing drawer (`app/opportunity-detail`) | ✓ | ✓ | ✓ | none | 400 w/o id | — |
| Comparable awards (`app/related-awards`) | ✓ | ✓ | ✓ | none | **200** | — |
| M-Win / win-probability | ✓ | ✓ | ✓ | `verifyUserOwnsEmail` present but **not reached anonymously** | **200** | ⚠️ code implies gate, prod serves |
| Search / filters / Today's Lens | ✓ | ✓ | ✓ | client-side over public pin APIs | serves | — |
| **Players** (`app/contacts-map`) | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — (matches decision) |
| Company detail | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — |
| Buyer detail | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — |
| Contacts (`app/federal-contacts`) | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — |
| Save opportunity | ✗ | ✓ | ✓ | email + ownership | 400 (no email) | — |
| Saved searches / Watchlist | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — |
| Pursuits (`/api/pipeline`) | ✗ | ✓ | ✓ | `requireMIAuthSession` | **401** | — |
| Map alerts (saved-search alerts) | ✗ | ✓ | ✓ | same as saved searches | 401 | — |
| **Ask Mindy** (`app/chat`) | ✗ | ✗ | ✓ | `403 pro_required` | 401 | — (**the only real paid gate**) |
| RAG doc / chat sessions | ✗ | ✗ | ✓ | `403 pro_required` | 401 | — |
| **Proposal draft** | ✗ | ✓ | ✓ | login only — **no paid check** | — | ⚠️ **UI implies paid; backend does not** |
| **Proposal export** | ✗ | ✓ | ✓ | login only — **no paid check** | — | ⚠️ same |
| **Proposal compliance** | ✗ | ✓ | ✓ | login only — **no paid check** | — | ⚠️ same |
| **Vault** (`app/vault/prefill`) | ✗ | ✓ | ✓ | login only — **no paid check** | — | ⚠️ same |
| Markets / reports (`app/buying-agencies`) | ✓ | ✓ | ✓ | none | 200 | ⚠️ public, likely unintended |
| `app/map-home` (profile state) | ⚠️ | ✓ | ✓ | weak — see below | **200 + data** | ⚠️ **bypass** |

---

## Bypasses and mismatches found

**1. `app/map-home` answers an anonymous request for a KNOWN email.**
Measured: `?email=eric@govcongiants.com` with no cookie and no token returns
`{"success":true,"state":"AL"}`; an unknown email correctly returns `Unauthorized`. So the
endpoint leaks a profile field (and confirms account existence) to anyone who knows an
address. Small blast radius — it is not the map data — but it is the **weak-auth Method-4
pattern** already recorded in memory, and it is a genuine direct-URL bypass.

**2. Proposal Workspace and Vault are free-login, not paid.**
No `hasProAccess` / `pro_required` anywhere in draft, export, compliance or vault-prefill.
Anyone with a free account can currently generate and export a proposal.

**3. `app/win-probability` and `app/buying-agencies` serve anonymously** despite auth
machinery being imported nearby. M-Win is arguably fine as product proof; buying-agencies is
worth a decision.

**4. Players is correctly gated *and* correctly sequenced.** `__playersGate()` intercepts the
nav click **before** the mode switch (route.ts:2720), so an anonymous user never sees a
half-switched view with a stale count — the failure mode we explicitly designed against.

---

## What is genuinely settled

- Anonymous browsing of the **whole map** — pins, listings, comparable awards — is real and
  enforced by *absence* of gates, not by accident of routing.
- **Players / contacts / company / buyer** require a free login, enforced server-side.
- **Save / saved / pursuits / alerts** require a free login.
- **Ask Mindy is the only paid capability on the Map.**

## The decision this audit exists to enable

> **What does someone get for visiting, for creating an account, and what makes them pay?**

Today the honest answer is: visiting gets you nearly everything; an account gets you people,
saving and pursuits; paying gets you Ask Mindy. If Proposal generation is meant to be the paid
tier, **the backend does not currently enforce it** — and the header on `/today` should not
say "Upgrade" for something a free account can already do.

⚠️ **Do not hand the aspirational tier table to an implementer as truth.** Several rows in it
are conceptual; this document is what production enforces.
