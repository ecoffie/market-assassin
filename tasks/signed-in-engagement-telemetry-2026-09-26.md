# Signed-in engagement telemetry — root cause + fix (2026-09-26)

## Symptom (production, read-only, signed-in = `user_email NOT LIKE 'anon:%'`)

| event_source | 30d before 2026-08-22 | 2026-08-22 → 09-26 | last signed-in row |
|---|---:|---:|---|
| market_intel_dashboard | 773 | **0** | 2026-08-20 |
| pipeline | 157 | **0** | 2026-08-20 |
| forecasts | 55 | **0** | 2026-08-20 |
| settings | 27 | **0** | 2026-08-12 |
| grants | 18 | **0** | 2026-08-20 |
| market_research | 16 | **0** | 2026-08-20 |
| pricing_intel | 14 | **0** | 2026-08-03 |
| sidebar | 5 | **0** | 2026-08-10 |
| onboarding (from_step / completion / auto_extract) | 28 | **0** | — |
| source_feed, map-card events (`metadata ? 'kind'`) | ≈14,397 | **0** | — |
| opportunity_map (control) | 5,204 | 20,778 | live |
| todays_intel (control) | 323 | 888 | live |
| proposal / pursuits (controls) | 27 / 39 | 616 / 82 | live |

`mindy_insight` (624 → 0, last 08-12) is **not** this bug: the card was removed 2026-08-05.
`onboarding` rows after 08-22 are all `welcome_choice`, written server-side by `/api/welcome/choice`.

## First failing layer (reproduced)

`POST /api/mindy/engagement` (and `/api/app/engagement`) with a real email and no auth header,
i.e. exactly what a beacon sends, against production:

```
{"success":false,"error":"Strong authentication required — please sign in"}  HTTP 401
```

The request **reaches the route**. It fails in `verifyUserOwnsEmail(..., { requireStrongAuth: true })`
(added by #1232, 2026-08-21), which accepts only a Supabase Bearer, a signed email-action token,
or `x-mi-auth-token` / `x-mi-2fa-token`. The MI session token lives in **localStorage, not a
cookie**, so nothing the browser attaches automatically can satisfy it.

- `navigator.sendBeacon` cannot set headers → every signed-in beacon 401s.
- `sendBeacon` returns `true` once the request is **queued**, so the fetch fallback in
  `useAppTracker` / `__trackCard` never ran. The client never saw a status.
- Nothing logged a 401, so nothing anywhere said so.

Why the Map kept working: `_track` (map), proposal, pursuits and favorites all use
`fetch(..., {keepalive:true})` with `x-mi-auth-token`. `/app` page_views kept working only by
accident: `/app/page.tsx` installs a global `window.fetch` wrapper that injects the token; its
own `trackEngagement` fetch sets no header. The `/app` **unload** flush used `sendBeacon` and died.

## Producer inventory

| producer | route | transport before | auth | identity source | status before | after |
|---|---|---|---|---|---|---|
| `useAppTracker` (13 panels, onboarding, market-intel page) | /api/mindy/engagement | sendBeacon (fetch fallback never ran) | none | body email | **BROKEN** | keepalive fetch + x-mi-auth-token |
| `/app` page_view + panel switch flush | /api/mindy/engagement | fetch, no header (wrapper injects) | wrapper token | body email ⊂ token | working | shared transport |
| `/app` tab-hide / close flush | /api/mindy/engagement | sendBeacon | none | body email | **BROKEN** | shared transport on `visibilitychange→hidden` + `pagehide` |
| `/briefings` trackEngagement | /api/app/engagement | sendBeacon; fetch had no header | none | `email \|\| inputEmail` (unverified box) | **BROKEN** | shared transport, signed-in `email` only |
| Map `__trackCard` signed-in | /api/app/engagement | sendBeacon; fallback sent `x-user-email` (never authenticates) | none | token payload, else `briefings_access_email` | **BROKEN** | keepalive fetch + x-mi-auth-token; expired token → anonymous |
| Map `__trackCard` anonymous | /api/app/engagement | sendBeacon | n/a (anon:uuid) | anon id | working | unchanged |
| Map `_track` | /api/app/engagement | keepalive fetch + token | token | token payload | working | unchanged |
| proposal / pursuits / favorites routes | /api/app/engagement | keepalive fetch + token | token | token payload | working | unchanged |
| Today's Intel, Alerts, TargetingCard, SaveToPipeline | /api/mindy|app/engagement | fetch + `getMIApiHeaders` / `authedFetch` | token | body ⊂ token | working | unchanged |
| TryLanding (/try) | /api/app/engagement | fetch + token when signed in, anon otherwise | token | token / anon | working | unchanged |
| `/welcome` ChoiceLink | /api/welcome/choice | sendBeacon | **none — trusts body email** | body email | "working" | **unchanged — see open item 1** |
| server `logEngagement` callers | direct insert | n/a | server | server | working | unchanged |

## Fix

- `sendAppEngagement()` in `src/components/app/track.ts` — THE signed-in transport:
  `fetch(..., { keepalive: true })` with `getMIApiHeaders(email)`. No token → **nothing is sent**
  (it would 401; identity is never invented). Dev-only `console.warn` on a drop or non-2xx.
- `useAppTracker`, `/app` page, `/briefings` page and the Map's signed-in `__trackCard` route
  through it. `sendBeacon` remains only on the Map card's **anonymous** branch.
- No auth was weakened. The server still derives identity from the token; the body email is only
  the claim the token must cover (pinned by a test: a token for A cannot write as B).
- Page exit: `visibilitychange→hidden` + `pagehide` (replaces `beforeunload`, which also disables
  bfcache). The flush resets its clock, so a double fire is dropped by the 3 s floor. Panel-time
  rows now carry `flush_reason` (`hidden|pagehide|panel_change|unmount`). A hard kill can still
  lose the last keepalive request — an accepted, slightly short duration, never a forged identity.

## Guards against a second silent month

| guard | where | what it catches |
|---|---|---|
| transport unit test | `src/components/app/track.unit.test.ts` | keepalive + x-mi-auth-token, never beacon; no token → no send |
| route contract test | `src/app/api/app/engagement/route.unit.test.ts` | beacon shape 401s + is logged; token → 200; token A ≠ body B → 401; anon still 200 |
| static guard | `src/lib/analytics/engagement-transport.unit.test.ts` | any `sendBeacon('…engagement…')` outside the Map card's anonymous branch |
| server rejection log | `api/app/engagement/route.ts` | one `console.warn` per **rejection** only (source, type, `had_token`, reason — no email) |
| production oracle | `npm run verify:engagement` | a guarded producer at 0 while control producers are busy → exit 1; quiet controls → UNKNOWN |

Guards proven: against the pre-fix `track.ts` + map route, all 6 transport/static assertions fail;
against the fix, they pass. `verify:engagement` is **RED on production today** (controls
3,952 / 101; guarded 0/0/0/0) and should turn green after deploy.

## Open items (not done here)

1. **`/api/welcome/choice` accepts the body email with no auth** — the same forgery class #1232
   closed for `/api/app/engagement`. It is the only reason welcome telemetry "works". Fixing it
   means sending the token from `ChoiceLink` (keepalive fetch) and verifying server-side; decide
   whether an unauthenticated choice should be dropped or recorded as anonymous.
2. **Five weeks of signed-in `/app` events are gone** (2026-08-21 → deploy). They cannot be
   backfilled. Any funnel/activation/retention series over that window reads a fabricated zero for
   these sources; annotate it, don't interpret it. Prefer server-written product state
   (`user_pipeline`, profiles, saved searches) for Learn completion.
3. Production acceptance after merge: `npm run verify:engagement` → PASS, plus one real signed-in
   browser session showing a `pipeline` / `panel_time` (flush_reason `hidden`) row.
4. The prompt's section F (privacy / event contract) arrived truncated; nothing in the event
   payload shape was changed.

## Production acceptance (2026-09-27)

- **Merge:** #1719 → `539f6f5b` at 00:38:46Z. Deployed by the normal git path, with no manual deploy. Production served it from **00:42:12Z**, confirmed by the served `maps-account-build:539f6f5b…` stamp and the new `if(!_anonC){` branch in the `/opportunity-map` HTML.
- **Controlled signed-in session:** isolated Puppeteer profile with a server-signed MI token for the staff test account `eric@govcongiants.com`. It never touched a real browser profile. Every request carried `x-mi-auth-token` as a keepalive `fetch`, and every row below persisted as the token's identity:

| producer | stored row (UTC) |
|---|---|
| `/app` page_view panel=pipeline | 00:43:57 |
| `pipeline` page_view (`useAppTracker`) | 00:43:58 |
| panel_time `flush_reason=hidden` (real tab switch, 12,480 ms) | 00:44:10 |
| panel_time `flush_reason=pagehide` (real navigation, 5,567 ms) | 00:44:20 |
| signed-in map card `impression` ×2 (`source_feed`) | 00:44:31 |
| `/briefings` page_view + exit panel_time | 00:46:48 / 00:46:59 |
| `market_intel_dashboard` page_view | 00:48:0x |

- **Anonymous regression:** a fresh profile with no token. The map's `_track` (`map_view`, `cards_shown`) and the card impression sent through the existing **beacon** all persisted under `anon:<uuid>`.
- **Auth negatives on production** (each tagged with a unique probe marker): no token → 401; tampered signature → 401; A's token claiming B's email → 401 on both `/api/mindy/engagement` and `/api/app/engagement`. **Rows written with the marker: 0.**
- **Oracle:** tightened to exclude staff and test accounts, because a verification session must never be what turns it green. With `--include-staff` it is PASS 4/4 guarded (from the controlled session). The **customer-only** verdict is the acceptance gate and is pending real traffic.

## Historical gap — telemetry INCOMPLETE, not zero engagement

**2026-08-21 (#1232) → 2026-09-27T00:42:12Z:** signed-in `/app` panel events, `/app` exit panel-time, `/briefings`, and signed-in map-card events were **not recorded**. The zeros in that window are missing data, not absent usage. Nothing was backfilled or synthesized. Any Learn baseline starts after T0.
