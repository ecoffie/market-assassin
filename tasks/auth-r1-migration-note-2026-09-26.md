# R1 migration note — who could be hurt by removing weak auth, and the transition path

Source: `tasks/mindy-entitlement-audit-2026-09-26.md` §12 E1, §14 R1. R1 is **blocked on R0 data** (PR #1722).
Read the R0 tables after ~7 days; each row below says which readout query decides it.

| Population that may depend on a weak method | How R0 shows it | What R1 does to them | Transition path if R0 shows real users |
|---|---|---|---|
| **Legacy Market Assassin buyers** on `/federal-market-assassin` (gated by `proxy.ts` on the `ma_access_email` cookie set by `/api/verify-ma-access`, `/api/ma-access/[token]`, `/api/verify-ma-tier`) | `pro_gate` rows for `/api/reports/generate-all` with `method='cookie'`, and `auth_observation_emails` for that route (queries 4–5) | `generate-all` treats them as anonymous → **Free report set** (4 standard), IP rate limit. The page now also sends the Mindy session headers, so buyers who are ALSO signed in to Mindy in that browser keep their tier. | Make the magic-link routes set a **signed, httpOnly** session cookie (`createMIAuthSessionToken`) next to `ma_access_email`, and accept that signed cookie in `getVerifiedIdentity`. Signed ≠ plaintext: it cannot be forged. Then the page keeps working with no user action. |
| **`/access/[code]` access-code users** (plain `fetch` to `generate-all`, no email, no session) | `pro_gate` `/api/reports/generate-all` with `verified='no'`, no email | Already anonymous before R1 unless the cookie was set; now always the Free set | Same signed-cookie fix, set when `/api/access-codes` validates the code. |
| **Cookie-only callers of `verifyUserOwnsEmail` routes** (old MA tools, `/briefings` when the MI token is missing, `/agency`, usage routes) | Queries 1–3, `method='cookie'` | **401** on those routes | Same signed cookie. For `/briefings`, route the page through `authedFetch` (it already mints/refreshes the MI token). |
| **Staff using a staff address with no session** (scripts, curl, server-to-server fetches carrying only an email) | Queries 2–3, `method='staff_claim'` | **401** | Staff sign in (MI session) like everyone else; server-to-server callers sign with `generateEmailToken` (`?token=&ts=`) or call the lib directly. The `verifyMIAccess(identityVerified)` staff bypass stays dead — reviving it is R2/R3 (`internal_staff` source), not R1. |
| **Pro-gate callers without a session** (plain `fetch` with `?email=`) | Query 5 | pricing-intel / competitor-awards / market-narrative / market-dossier → **401**; TMR / generate-all / market-overview → **Free result** | The in-app callers were moved to `authedFetch` / `getMIApiHeaders` in this PR (PricingIntelPanel, MarketDataMap, onboarding, federal-market-assassin). Anything else that shows up in query 5 gets the same one-line change. |
| **`teaming/suggest` callers** | `pro_gate` `/api/teaming/suggest` | **401** without a session; `limit` capped at 50 | No in-repo caller exists. If query 5 shows one, it must send the MI session. |
| **`generate-all` → `/api/alerts/save-profile`** | — | Call **removed** | It authenticated only through the staff claim (every customer call already 401'd silently) and would REPLACE a user's alert NAICS. Re-adding needs a signed call + a product ruling. |

**Decision rule:** if queries 2, 3 and 5 are empty (or only staff/test accounts), R1 can merge as-is.
Otherwise ship the signed-cookie transition first (one small PR), wait for the weak-method counts in
R0 to drain to zero, then merge R1.
