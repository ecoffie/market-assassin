# Account ID migration — inventory + plan (2026-09-14)

**Status:** In progress (P1 hot path) · **Canonical PRD:** [`PRD-identity-model.md`](../PRD-identity-model.md)  
**Trigger:** Ereck Harrison — Stripe billed `ereck@harrisonplus.com`, MCP used `ereck@serviceopsgroup.com`; customer-specific remaps are banned going forward.

---

## 1. Inventory (email still owns the row)

| Domain | Primary key today | Stable anchor already present | Email-change / buy≠login failure |
|--------|-------------------|-------------------------------|----------------------------------|
| Auth / MI session | Email inside HMAC token | `auth.users.id` | Token bound to old email until re-mint |
| `user_profiles` | `email` | `user_id` (= auth id) | Reads still `.eq('email')` |
| Stripe webhook / portal | `customer.email` | `cus_*`; metadata sometimes has `user_id` | Credits/entitlements land on billing inbox |
| MCP balance / ledger / keys | `user_email` PK | None until this migration | Orphan balance; `pro:<email>:YYYY-MM` double-grant on rename |
| Monthly Pro grant cron | Stripe `customer.email` | — | Wrong inbox; Team seats not pooled |
| Alerts / `user_notification_settings` | `user_email` | Row UUID only | Delivery + opt-out stuck on old address |
| `saved_searches` | `user_email` | `id` UUID | **Outside** re-key list → alerts keep firing to old email |
| KV entitlements | `briefings:{email}` etc. | — | Lost Pro if incomplete re-key |
| Change-email today | String sweep `reKeyAccountEmail` | Auth `updateUserById` keeps same id | MCP + saved_searches not in sweep |

**Alias / remap:** linked emails help **billing visibility only**. Advocate lists are hardcoded working emails. **No customer-specific billing remap table will be added** — that is a support scar, not a model.

**Re-key gap (measured):** `reKeyAccountEmail` / `USER_EMAIL_TABLES` omit MCP credit tables and `saved_searches` (among others).

---

## 2. Target model (unchanged from PRD)

- **`account_id` = `auth.users.id`** (already on `user_profiles.user_id`). Do not invent a parallel ID.
- **Email = mutable attribute** (+ linked emails for proven aliases).
- **Stripe** carries `metadata.account_id`; grants resolve customer → account_id.
- **MCP monthly idempotency key** = `pro:acct:<account_id>:<YYYY-MM>` (legacy `pro:<email>:<YYYY-MM>` passed in the same key set so retries / email changes cannot double-grant).
- **Saved-search delivery** eventually joins on `account_id`; email is delivery address attribute.

---

## 3. Migration that preserves balances, subs, opt-outs, ownership

Phased dual-write (never big-bang 345 sites):

| Step | What | Preserves |
|------|------|-----------|
| **A. Schema** | Add nullable `account_id` to MCP credit tables (+ later saved_searches, notification settings) | No behavior change |
| **B. Backfill** | `email → user_profiles.user_id`; dry-run then execute | Existing balances stay on same row; account_id stamped |
| **C. Dual-write** | All new grants/debits set `account_id`; monthly keys use `pro:acct:…` + legacy email keys | Stripe redelivery still exactly-once |
| **D. Read prefer account_id** | `getBalance` / debit: by account_id first, email fallback | Buy≠login fixed when both emails map to one account_id (consolidation) |
| **E. Change-email** | Auth email + profile attribute update; denorm `user_email` on MCP rows WHERE account_id=…; **do not move balance PK** | Balance/opt-in intact without string sweep of money tables |
| **F. Consolidation** | Absorb account B → keep A: sum MCP balances, repoint rows, Stripe metadata | Two signups → one owner |
| **G. Cut reads** | Hottest paths off email joins | Remaps deleted as a class |

**Explicit non-goals this slice:** workspace de-domain (P4); full 345-site cutover; paid=OAuth-only MFA (separate P0).

---

## 4. Proofs required before calling done

1. **Email change preserves access + data** — same `account_id`; MCP balance unchanged; Pro KV still resolves; notification row still owned.
2. **Stripe / monthly retry exactly once across email change** — first grant with keys `[pro:acct:UUID:YYYY-MM, pro:old@…:YYYY-MM]`; after email change, retry with `[pro:acct:UUID:YYYY-MM, pro:new@…:YYYY-MM]` → `applied=false`, balance unchanged.

---

## 5. Ban

Do **not** add `MCP_BILLING_EMAIL_ALIASES` or per-customer remaps. Fix ownership with `account_id` + verified change-email / consolidation only.
