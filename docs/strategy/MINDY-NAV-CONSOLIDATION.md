# Mindy Navigation Consolidation — Settings / Vault / Library

_Audit + decisions, Jun 25 2026. Trigger: Eric — "3 settings buttons, Vault confusion,
do we need My Library as its own tab?"_

## What the audit found (it's less sprawl than it looks)

**The "3 settings buttons" are 1 real panel + 1 shortcut + 1 different thing:**

| Surface | What it is | Backed by | Verdict |
|---|---|---|---|
| **Settings** (sidebar) | Personal: Profile (name/role/company/email freq) + Opportunity Matching (NAICS/PSC/keywords/agencies/states) + Billing | `mi_beta_user_settings` (display) + `user_notification_settings` (targeting = source of truth) | **Keep** — the real one |
| **Account menu → Settings** (footer drop-up) | Just a link to the Settings panel; exists so mobile users can reach sign-out | none (nav only) | **Not a surface** — intentional mobile shortcut |
| **Team Access → Workspace Settings** | Team-only org *defaults* (shared company/NAICS/agencies), admin-edit | `mi_beta_workspace_settings` | **Keep** — Team-tier, legitimately separate (org vs personal) |

**Vault vs Settings — the ONE real overlap:**
- **Settings** = *targeting* (what alerts match on). Source of truth: `user_notification_settings`.
- **Vault → Identity** = *company facts* (legal name, UEI, certifications, past performance — for proposals). Source of truth: `user_identity_profile`.
- These are legitimately different — **BUT NAICS lived in both** and the Vault→alerts sync was one-way + fired only once when the alert filter was empty. That's the "I put codes in Vault, why no alerts?" confusion.

**My Library** = read-only archive of AI outputs (drafts, briefings, capability statements). Pro+ only. `user_generated_archive`. Different lifespan from Vault (auto-generated vs user-curated).

## Decisions (Eric, Jun 25)

1. **Lightest consolidation** — clarify, don't move panels. No Library fold (yet).
2. **NAICS model:** Settings owns targeting (single source of truth alerts read);
   **Vault Identity NAICS sync INTO Settings, additively + visibly.**

## Shipped

- **Vault → alerts NAICS sync is now additive + visible.** `PUT /api/app/vault/identity`
  ADDs any Vault NAICS missing from `user_notification_settings.naics_codes` (never
  removes/overwrites tuned codes), and returns `alertNaicsAdded` / `alertNaicsTotal`.
  Vault UI now confirms "Added N NAICS to your alerts… fine-tune in Settings."
  (Was: silent one-time seed only when the alert filter was empty.)
- **Cross-links** so users stop hunting:
  - Settings already says "company profile (legal name, UEI, certs) lives in My Vault → Identity."
  - Vault Identity NAICS now says "the codes Mindy actively watches live in Settings →
    Opportunity Matching."

## Deferred / open (not done — decide later)

- **Fold My Library into Vault** as a "Generated" tab (removes a top-level nav item).
  Deferred per Eric's "lightest" choice; revisit if the sidebar feels heavy.
- **Retire `mi_beta_user_settings.naics_codes`** (legacy column, never written, only read
  for un-migrated profiles). Code already doesn't write it; the column lingering just
  confuses readers. Safe DROP candidate after verifying no live reads depend on it.
- **Account menu** is intentional (mobile reachability) — leave it.
