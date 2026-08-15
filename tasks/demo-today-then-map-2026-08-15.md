# Demo runway — Today's Intel → Map (demo 2026-08-23)

**Eric's sequence (2026-08-15):** *"make page, approve it then perfect map then flip once
both are complete."* The apex flip is LAST, after BOTH surfaces are signed off. Do not
touch `next.config.ts` before then.

**The demo flow:** land on Today's Intel → read what changed → click into the map as the app.

---

## Step 1 — THE PAGE (in progress, needs Eric's approval)

`/today` shipped editorial (PR #1107). Awaiting Eric's review before map work starts.

## Step 2 — THE MAP (do NOT start until the page is approved)

### 2a. ⚠️ CORRECTED 2026-08-15 — MOST deep links already work. Re-measure before believing this file.

The claim below (written earlier the same day) said the map reads "NONE" of the params and that
`opp`/`agency`/`naics` were all dead. **That was wrong for `?opp=`, the only one `/today` still
emits.** How the error happened, because it will happen again: the check grepped
`searchParams.get(...)` — the SERVER parser, which really does read only `embed`. The map's
deep-link handlers are **client-side**, parsing `location.search` inside the emitted JS. Grepping
the server side and concluding "the map ignores everything" is a false negative.

**Six params ARE wired** (boot handlers in `route.ts`, each with its own `Deep-link:` comment):
`opp` · `company` · `buyer` · `recompete` · `strategy` · `ss`.

**`?opp=<notice_id>` — VERIFIED WORKING ON PROD** (headless, 2026-08-15). `#oppDrawer`:

| | `?opp=ea4e7b…` | no param |
|---|---|---|
| visibility | **visible** | hidden |
| position | on-screen, `left: 64` | parked off-screen, `left: -951` |
| content | the requested notice | — |

So the Featured-card → map handoff — the demo moment — already works end to end. It was built for
the Share link and the Favorites page and `/today` inherited it for free.

⚠️ **Two traps when testing this**, both hit during verification:
1. `#mDrawer` is the MOBILE NAV drawer, not the listing drawer. It is `display:none` on desktop
   **by design**. Reading it as the listing drawer looks exactly like a failed deep link. The
   listing drawer is **`#oppDrawer`**.
2. `#oppDrawer` is `display:flex` **even when closed** — it's hidden via `visibility` + an
   off-screen `left`. Asserting on `display` alone passes in both states and proves nothing.
   Assert `visibility` / on-screen position, or that it shows the RIGHT notice.

**Still genuinely dead — but nothing points at them any more.** `?agency=` and `?naics=` are
ignored (measured: baseline, `?agency=DEPT%20OF%20DEFENSE` and `?naics=311999` all return an
identical **145,775 results**). The four-section cut (PR #1122) removed Top Buyers and Trending
Markets, which were the only emitters. Wire these **only if** a future section links by agency or
NAICS — building them now would be code with no caller.

### 2b. The fix is WIRING, not new machinery — reuse `applyIntent`

`window.__applySearchFilters(intent)` (route.ts ~line 1665, inside VIEWPORT_JS) ALREADY:
- sets `FILT.agency` / `FILT.state` / `FILT.setAsideMulti`
- syncs the visible chip + label + `mfBadge` "Filters N" count
- pans to the state centroid when a state is set (otherwise a state filter renders "none in view")
- calls `fetchView()`

A deep link is just an intent sourced from the URL instead of from the AI. Read the params
once at boot → build the intent → call the SAME function. No second filtering path (the
shared `applyMapFilters` + `verify:oracles` filters check stay authoritative).

**⚠️ GAP:** `applyIntent` handles `agency` / `state` / `setAside` / `horizon` / `dataset` /
`keyword` — but **NOT `naics` / `psc`**. It only READS `FILT.naics` for the badge count.
The Trending Markets row links by NAICS, so that branch must be added, and it must set the
NAICS **chips** (`window.__naicsChips.set()`), not just `FILT.naics` — the chip input is the
control that the Filters panel reads back (see the NAICS chip contract, PR #1102).

`?opp=` needs a different path — it should OPEN THE LISTING DRAWER for that notice, not
filter. Check how the drawer is opened programmatically before wiring it.

**Vocabulary is already established** — `openMarketView` (route.ts ~1543) emits
`q`/`naics`/`psc`/`agency`/`setAside`/`state`. Deep links should use the SAME names.

### 2c. Verify like the oracles do — a filtered map that renders 0 pins is a FAIL

Do not accept "the param is in the URL." Prove: link → map → pins genuinely narrowed AND
every rendered pin satisfies the predicate. `npm run verify:oracles -- --only filters`
covers the shared lib; the deep link needs its own browser proof.

## Step 3 — THE FLIP (last, after Eric approves BOTH)

ONE line: `next.config.ts` ~line 117, the apex host rewrite
`destination: '/mindy-landing'` → `'/today'`. The file's own comment says: *"Changing this
one line IS the flip; do not touch it without Eric's explicit go."*

⚠️ This is the cutover the **map-migration gate** blocks ("no migration — everything on the
map must pass first"). Eric is sequencing the gate deliberately: page ✅ → map ✅ → flip.
`/signin` → `/app` is a separate rewrite and is unaffected.

---

*Created 2026-08-15. Live state at creation: `/opportunity-map` 200 (578ms), `/today` 200,
apex → `/mindy-landing`.*
