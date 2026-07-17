# `mi_beta_email` — retire the second source of truth (scoped 2026-07-17)

## TL;DR

`localStorage.mi_beta_email` is a **redundant, unsigned copy of a fact that already lives inside the auth token**. It has now caused at least three production bugs, each one "the UI thinks you're someone you're not." The fix is mechanical but touches the sign-in path of the whole app, so it is **deliberately deferred until nothing is shipping**.

**Not a security hole** — every server route verifies the signed token and ignores the claimed email (audited 2026-07-17, see [Security](#security-audited-not-a-hole)). This is a correctness and maintenance problem, not an escalation one.

---

## Why it exists, and why it shouldn't

The real credential is **`mi_beta_auth_token`** (localStorage) — a signed MI session token with **the email baked into its payload**. `authHeaders.ts` already ships `tokenEmail(token)`, which decodes that email client-side.

So the email never needed its own key. `mi_beta_email` is a **parallel copy that can drift from the token** — and drift is exactly the bug, every time.

> Two sources of truth for one fact, and only one of them is signed.

## The three bugs it has already caused

1. **The console showed the wrong account's balance.** From `/api/mcp/session`'s docstring — the reason that endpoint exists:
   > *"The console must NOT trust the client-supplied `mi_beta_email` (a plaintext localStorage value that goes stale on account switch and made the dashboard show the WRONG account's zero balance while the credits sat on the real one)."*

2. **Onboarding couldn't find the session.** `app/page.tsx:296` still carries the scar comment about `mi_beta_email` being set ~20 lines too late.

3. **The entire MCP connect flow was dead** (#330, fixed 2026-07-17). The consent page gated on the key; it's written only by `/app` surfaces, so a user signed in via `/mcp/*` had a valid token and no key. The page showed "Sign in to continue" and **polled every 1.5s for a value that would never appear**. Observed live: 3× `/oauth/authorize`, 0× `/approve`, 0× `/token`, zero errors. Eric was signed in the whole time with 2,000 credits on screen.

   **It was self-concealing:** `/mcp/account` and `/mcp` *backfill* the key after resolving the session, so anyone who happened to load the account page first could connect and anyone who didn't never could. It read as flaky, not broken.

---

## The map — 26 references, 15 files

### Writers (delete these)
| file | line |
|---|---|
| `app/app/page.tsx` | 301, 327, 391 |
| `app/app/onboarding/page.tsx` | 408, 467 |
| `app/app/change-email/confirm/page.tsx` | 45 |
| `app/mcp/page.tsx` | 100 — *backfill* |
| `app/mcp/account/page.tsx` | 239 — *backfill* |

### Clearers (delete with the writers)
`app/app/page.tsx:27` · `app/app/reset-password/page.tsx:106` · `app/app/setup-password/page.tsx:94` · `app/mcp/account/page.tsx:217`

### Readers — the actual work
| file | line | replace with |
|---|---|---|
| `app/app/page.tsx` | 888 | `tokenEmail()` |
| `app/app/market-intel/page.tsx` | 183 | `tokenEmail()` |
| `app/app/onboarding/page.tsx` | 379, 393 | `tokenEmail()` |
| `app/agency/page.tsx` | 86 | `tokenEmail()` (keep the `ma_access_email` fallback) |
| `app/admin/members/page.tsx` | 25 | `tokenEmail()` — cosmetic gate only |
| `components/BackToAppHeader.tsx` | 45 | `tokenEmail()` |
| `components/MemberAwareCta.tsx` | 33 | `tokenEmail()` |
| `components/MeetMindyStrip.tsx` | 24 | `tokenEmail()` |

`app/oauth/authorize/page.tsx` — **already migrated** (#330). Its header carries a DO-NOT-DO-THIS-AGAIN note.

---

## The plan

1. **Add one helper** — `getSessionEmail()` in `components/app/authHeaders.ts`:
   - client/UI reads → `tokenEmail(localStorage.getItem('mi_beta_auth_token'))`
   - anything that gates real access → `await fetch('/api/mcp/session')` (server-verified, the console's pattern)
2. **Migrate the 8 readers** to it. This is where the risk is: `app/page.tsx`, `onboarding`, and `market-intel` are the core app.
3. **Delete the 8 writers + 4 clearers.** Removing the token still signs you out — the token is the credential; the email was only ever a cache.
4. **Add a lint rule / audit** banning `mi_beta_email`, the way #326 made "one fix = every surface" a gate. **A comment did not stop this recurring three times; a gate will.**
5. Grep for stragglers outside `src/` (scripts, other repos).

## Ordering note

Step 3 must not land before step 2 in the same deploy on a surface that still reads the key — a half-migrated read would see no key and bounce a signed-in user to sign-in. Same class as the bug being fixed. Migrate readers first, ship, then remove writers.

## Security — audited, NOT a hole

`admin/members/page.tsx:25` gates the admin UI on `localStorage.getItem('mi_beta_email')`, which anyone can set from a console. **The server does not care.** `/api/admin/members` → `requireStaff()`:

```js
const auth = requireMIAuthSession(request);   // verifies the SIGNED token
if (auth.ok) {
  const email = auth.session.email;            // email from the signed payload, NOT the header
  if (email && getStaffRole(email) !== 'none') return { ok: true, email };
}
// else admin password, else 403
```

Identity comes from the verified token payload; the client-claimed `x-user-email` is ignored for authorization. Forging the localStorage value renders a UI shell whose every call 403s.

## Why not today (2026-07-17)

The directory submission is hours away, the connect flow *just* started working, and this touches sign-in for the whole app. A regression here surfaces as "users randomly logged out" — the kind you learn about from a customer. Do it on a day when nothing is shipping.

**Effort:** ~1 focused session. Mechanical, but every read needs testing against a real signed-in session, not just a typecheck.
