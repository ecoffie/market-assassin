# INCIDENT — $497 Contractor Database checkout is live and does not fulfil — 2026-09-23

**Status: OPEN. Read-only investigation; nothing changed.** No KV write, grant, Stripe change or
customer message has been made. Customer identities are masked here; the unmasked working file is in
the session scratchpad only and is not committed.

## 1. The checkout is still live

| Field | Value (Stripe API, read-only, 2026-09-23) |
|---|---|
| Payment link | `plink_1SlcMfK5zyiZ50PBVn60ByyO` |
| Price | `price_1SlcMaK5zyiZ50PBKXhlEuHN` — Federal Contractor Database, $497 one-time |
| `active` | **true** |
| `after_completion` | hosted confirmation (no redirect) |
| Paid checkouts | 5 (latest 2026-07-21) |

Nothing on getmindy.ai links to it after #1671, but the URL still takes money for anyone who has it
(old emails, bookmarks, affiliate pages).

## 2. The fulfilment path

- The access gate is **`dbaccess:{email}`** in KV. `/contractor-database` and `/api/verify-db-password`
  both read that key and nothing else.
- The getmindy.ai webhook (`/api/stripe-webhook`, `checkout.session.completed`, tier `contractor_db`)
  **only** sends the access email and sets Supabase flags. **It writes no `dbaccess:` KV.** The emailed
  link (`/contractor-database?email=`) therefore lands on a locked page.
- The four older buyers do hold `dbaccess:` with a `{token, createdAt}` value, which is the shape
  written by `createDatabaseToken()`. That means they were granted by a different path: the admin
  endpoint, or one of the other two enabled `checkout.session.completed` endpoints (shop and
  govcongiants.com). All of these share KV. **Which one wrote each grant is not established.**

## 3. Reconciliation of all five payments against actual access

Every buyer has Mindy Pro through at least one grant, so none is locked out of Mindy. The question is
the purchased **Contractor Database** itself.

| # | Checkout (date) | Amount | Buyer (masked) | `dbaccess:` KV | DB token | Mindy Pro | Contractor DB access? |
|---|---|---|---|---|---|---|---|
| 1 | `cs_live_a169F8…` (2026-01-12) | $497 | a***n@durhambrandco.com | yes | yes | yes | **Yes** |
| 2 | `cs_live_a16RAj…` (2026-01-23) | $497 | c***s@gmail.com | yes | yes | yes | **Yes** |
| 3 | `cs_live_a1kXdd…` (2026-01-25) | $497 | j***l@diamondscaffold.com | yes | yes | yes | **Yes** |
| 4 | `cs_live_a1FG2W…` (2026-05-02) | $497 | c***g@familylifeenhancement.com | yes | yes | yes | **Yes** (Supabase flag false; KV is the gate) |
| 5 | `cs_live_a1rV8O…` (2026-07-21) | **$894** (DB $497 + Recompete Contracts Tracker $397), metadata `tier: contractor_db` | w***e@gmail.com | **no** | **no** | yes (separate $149 Mindy Pro, 2026-07-11) | **NO.** Paid for a product the gate refuses. `recompete:` is also absent, but Recompetes is a Pro panel they can already open. |

**Result: one buyer (#5) paid and has no Contractor Database access. The other four are intact.**

## 4. Exact proposed actions (each needs explicit approval)

**A. Stop new sales (Stripe).**
```
curl https://api.stripe.com/v1/payment_links/plink_1SlcMfK5zyiZ50PBVn60ByyO \
  -u "$STRIPE_SECRET_KEY:" -d active=false
```
Verify by re-reading the link via the API (`active: false`) and loading the buy URL, which should show
Stripe's deactivated page. Code follow-up in a later PR: remove the `stripeUrl` for
`CONTRACTOR_DATABASE` in `src/lib/products.ts`.

**B. Repair buyer #5's access.** Choose one:
- **B1 — no customer email.** Write the token directly with the same helper the admin route uses,
  from a reviewed one-off script: `createDatabaseToken('<buyer #5 email>')`. It writes
  `dbtoken:<token>`, `dbaccess:{email}` and a `db:all` list entry, and sends nothing. Then read `dbaccess:{email}` back.
- **B2 — with email.** `POST /api/admin/grant-database-access {email, name, adminPassword}`. ⚠️ This
  **always emails the customer** (`sendDatabaseAccessEmail`), so it is a customer message and needs
  that approval too.

In either case, **do not** grant `recompete:`. The Recompete Tracker is discontinued, and the buyer
already has the Recompetes panel through Mindy Pro. Whether to refund the $397 Recompete line is
Eric's decision.

**C. Fix the fulfilment defect (code, separate PR).** Only if the link stays active; if A is approved
the branch becomes dead code. In the `contractor_db` webhook branch, call `createDatabaseToken` before
sending the email. Grants must run unconditionally, per Bug Prevention Rule #1.

**D. Longer term.** The Contractor Database moves into the Mindy Contractors panel (see proposals §E),
after which `dbaccess:` stays only as an entitlement marker.
