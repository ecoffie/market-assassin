# PRD — Alert Delivery Email (separate from login / merge)

**Status:** Shipped (this pass) · **Author:** Eric (via Claude) · **Date:** 2026-09-14  
**Trigger:** Cassy — wants alerts at `cheneault@excellri.com` without changing login or moving credits.

**Related:** [`PRD-change-email-flow.md`](./PRD-change-email-flow.md) (login re-key) · [`PRD-identity-model.md`](./PRD-identity-model.md) (account merge = deferred P3)

---

## Three distinct actions (frozen)

| Customer wants… | Mindy does… | Status |
|---|---|---|
| Receive alerts elsewhere | Verify a delivery address → update notification prefs | **This PRD — shipped** |
| Change their login email | Verify the new email while preserving account identity (`reKeyAccountEmail`) | Already shipped — Settings → Change email |
| Combine two existing accounts | Verify ownership and reconcile access, credits, saved data | Deferred — identity PRD P3 |

Cassy’s intended flow: **add address → verify it → select it for alerts → keep existing watches.**

---

## Design (reuse, don’t invent)

1. **Verified pool** — `account_linked_emails` + OTP (`src/lib/mindy/linked-emails.ts`). Same surface Billing uses for “bought with one email, signed in with another.”
2. **Selected delivery** — `user_notification_settings.alert_recipient_email`. Daily + weekly already honored it; saved-search-alerts now does too.
3. **Watches stay on login** — `saved_searches.user_email` is ownership, not the SMTP `to:`.

Self-serve writes reject any address that is not the account email or a **verified** linked row. Coach Mode client rows remain an exception (synthetic `@clients.getmindy.ai` owners).

---

## Surfaces

- **Settings** — “Alert delivery email” card (separate from “Change email”).
- **MCP** — `manage_alert_delivery` (`list` | `request_verify` | `set` | `clear`). Schedule tools still refuse free-form recipients; `alert_destination` reports `account_email` | `delivery_email` from live prefs.
- **Crons** — daily-alerts, weekly-alerts, saved-search-alerts → `resolveAlertDeliveryEmail`.

## Non-goals

- Expanding delivery override to AI briefings / pursuit-change digests in this pass.
- Account merge or credit reconciliation.
- A new `verified_emails` table.
