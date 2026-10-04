# R1 re-scope against current main (2026-10-04)

**Old R1 = PR #1750** (`b9b9de05`): 89 commits behind main, and it conflicts with main. **Not merged and not resurrected.** This record compares old R1's intended invariants with current main (`13d19cf1`). It classifies every old R1 change, then lists the smallest current patch: branch `fix/r1-weak-auth-removal`.

**Invariants:**
1. No request is authorized by the plaintext `ma_access_email` cookie.
2. No request is authorized by a claimed staff-domain email without proof.
3. Every Pro gate derives its tier from a VERIFIED identity (Mindy session, Supabase session or signed link), never from a client-supplied email.

## Classification of every old-R1 change

| Old R1 change | Class | Why / what current R1 does |
|---|---|---|
| `verifyUserOwnsEmail`: remove Method 3 (cookie) | **STILL REQUIRED** | Still live on main. R0 (7 days): its only legitimate dependency was legacy `/briefings`, migrated by **#1801** (production-proven; 0 successful cookie briefing reads since 2026-10-03T21:47:37Z). **Done in this patch.** |
| `verifyUserOwnsEmail`: remove Method 4 (staff claim) | **STILL REQUIRED** | Still live on main. R0: 29 calls, all from 1 internal address on `/api/app/me`. Staff sign in like everyone else. **Done in this patch.** |
| New `getVerifiedIdentity` / `verifyClaimedIdentity` / `identityFailureResponse` helpers | **OBSOLETE (design)** | Main already has one canonical strong path: `verifyUserOwnsEmail(…, { requireStrongAuth: true })`, used by #1747, #1748 and #1801. A parallel identity resolver would be a second source of truth. This patch adds only a 6-line wrapper, `verifiedClaimedEmail`, on top of the canonical path |
| `competitor-awards`, `market-dossier`, `market-narrative`, `pricing-intel`: verify before the tier read; 401 otherwise | **STILL REQUIRED** | All four took `?email=` / body email and called `verifyMIAccess(email)` with no proof; R0 only observed them. **Done**: 401 `auth_required` when unverified; tier from the verified email; dossier and narrative key every read and write by it |
| `target-market-research`, `market-overview`: unverified → Free view | **STILL REQUIRED** | Same defect. **Done**: an unverified claim gets the Free result. R0: all 17 `market-overview` claimants without identity were Free/none, so this costs nobody anything |
| `generate-all`: identity from the verified session | **STILL REQUIRED** | `getEmailFromRequest` read the plaintext cookie FIRST, making it an access key for paid reports. **Done**: the cookie is no longer read; the claim must be verified. |
| `generate-all`: anonymous → Free report set | **OBSOLETE (not ported)** | On current main, a caller with no email gets 403 "Please sign in". Giving anonymous callers the Free set would be NEW access. An unverified claim is now treated exactly like no email. R0: all 12 `generate-all` calls in the window were verified; no cookie-only callers |
| `generate-all`: remove the server-to-server `/api/alerts/save-profile` call | **ALREADY FIXED (dead), cleaned up** | Since **#1747**, save-profile requires a verified identity, so this email-only fetch was refused on every call. Removed as dead code that would otherwise replace a user's alert NAICS on a claim |
| `teaming/suggest`: require identity, cap `limit` at 50 | **STILL REQUIRED** | Unauthenticated on main; returns Contractor-DB SBLO names, emails and phones. **Done.** R0: 1 call in 7 days; no in-repo caller |
| Client callers send the session (`PricingIntelPanel`, onboarding + `MarketDataMap` → market-overview, `federal-market-assassin` → generate-all) | **STILL REQUIRED** | Done. Already sending: `MarketResearchPanel` (TMR, narrative, competitor-awards, generate-all) and `MarketDossierPanel`. `/access/[code]` sends nothing, so it stays anonymous and gets 403 as on main. |
| `auth-observability.unit.test.ts` pins | **STILL REQUIRED** | The R0 hash pin of the pre-R0 decision body is replaced by a pin of the R1 body. The Method 3 and Method 4 cases now assert refusal |
| Migration note (`tasks/auth-r1-migration-note-2026-09-26.md`) | **SUPERSEDED** | Its decision rule ("migrate `/briefings` first, wait for cookie calls to drain") is carried out by #1801 and this record |
| Save-profile identity (SEC-5) · search-capture (SEC-4) · briefings/preferences allowlist (SEC-3) · partner-referral claim (SEC-5d) · `/briefings` session (#1801) | **ALREADY FIXED** | #1747, #1748, #1738, #1787, #1801. All on the strong path; untouched here |

## Exact remaining weak-auth surface after this patch

| # | Surface | Weakness | Class | Note |
|---|---|---|---|---|
| 1 | **`src/proxy.ts` → `/database.html` (+ `/contractor-database` redirect)** | Unlocks on the **presence** of a `db_access_email` cookie, any value. **Verified live 2026-10-04 (read-only GET):** `Cookie: db_access_email=forged` → **200, 2,297,191 bytes**, the full Contractor Database page (3,506 SBLO records); without it → 307 | **NEEDS TRANSITION** | Highest remaining risk. A paid product ($497) served on a forgeable cookie. Needs a signed session for real DB buyers, or a decision in the legacy-retirement track (Contractor DB is next there). Not fixed here, to keep R1 narrow |
| 2 | `src/proxy.ts` → `/federal-market-assassin` page shell | Unlocks on the presence of `ma_access_email` | **NEEDS TRANSITION (low)** | The page's data now comes only from `generate-all`, which this patch verifies. A forged cookie shows the empty tool, not reports. Legacy MA buyers with no Mindy session get 403 "Please sign in" on report generation; R0 shows none in 7 days |
| 3 | `/api/verify-ma-password` | Sets `ma_access_email=authorized-user` from a shared password | **NEEDS TRANSITION (low)** | Only reaches surface #2 after this patch |
| 4 | `/api/app/me` residual cookie calls (3 in the R0 window) | On main they authenticated when the MI token failed but the cookie matched | **RESOLVED by this patch** | They now get 401. The Map account menu already keeps initials and skips the photo on a non-200. No transition needed |
| 5 | `/api/welcome/choice` (P1-C) | Writes an engagement event attributed to a body email | **STILL REQUIRED (separate, telemetry only)** | No access is granted. It pollutes attribution. Own PR |
| 6 | Staff bypass in `verifyMIAccess(email, identityVerified)` | No caller passes `identityVerified=true`, so verified staff get no bypass | **R2/R3 (by decision)** | Reviving staff access belongs to the R2 `internal_staff` source, not R1. No entitlement change here |
| 7 | `/briefings/lindy-setup` email-only API instructions | Stale. Never worked without the cookie | **Documented, not restored** | A machine integration needs a real authenticated mechanism |

## Tests

New: `src/lib/auth-r1-weak-methods.unit.test.ts`. 21 cases, run against the real `verifyUserOwnsEmail`, real signed tokens and real route handlers. **15 fail on origin/main.**
- Refused:
  - a cookie equal to the claim;
  - a claimed staff email;
  - a staff email plus a matching cookie;
  - a session for another account;
  - a tampered session.
- Accepted:
  - a Mindy session;
  - a Supabase session;
  - a signed link, for the email it signs only.
- `getEmailFromRequest` no longer reads the cookie.
- `verifiedClaimedEmail` returns the email only when the claim is proven.
- `pricing-intel` with only `?email=` of a paying customer → 401, and the tier is never read. A verified session → 200, with the tier read for the verified email.
- `teaming/suggest`: anonymous or cookie-only → 401; verified → 200 with `limit` capped at 50.
- Source contract: all 8 Pro routes verify before any tier read and never pass the raw claim to `verifyMIAccess`.

Full suite: **9,191 passed**, 0 failed. `tsc` clean. The one ESLint error (`MarketDataMap.tsx` set-state-in-effect) is unchanged from main.
