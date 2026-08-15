# Demo runway — Today's Intel → Map (demo 2026-08-23)

**Eric's sequence (2026-08-15):** *"make page, approve it then perfect map then flip once
both are complete."* The apex flip is LAST, after BOTH surfaces are signed off. Do not
touch `next.config.ts` before then.

**The demo flow:** land on Today's Intel → read what changed → click into the map as the app.

---

## Step 1 — THE PAGE (in progress, needs Eric's approval)

`/today` shipped editorial (PR #1107). Awaiting Eric's review before map work starts.

## Step 2 — THE MAP (do NOT start until the page is approved)

### 2a. Deep links from /today are DEAD ENDS — the map ignores them (MEASURED)

Every tile on `/today` links into the map with a filter param. The map reads **NONE** of
them. Measured on `main` @ 264fe9d8 — the ONLY params `opportunity-map/route.ts` reads are
`embed` and `utm_source`:

| Link `/today` emits | Source | Map behavior today |
|---|---|---|
| `?agency=<dept>` | Top Buyers (4 cards) | ignored → unfiltered map |
| `?naics=<code>` | Trending Markets (4 cards) | ignored → unfiltered map |
| `?opp=<notice_id>` | Featured Opportunities (3) | ignored → no listing opens |
| `?posted=1` / `?posted=7` | Today's market stats | ignored |
| `?mode=recompete` / `?events=1` | Today's market stats | ignored |
| `?mode=buyers` | Start anywhere | `mode` has 1 ref — VERIFY separately |

So on demo day every card lands on the same unfiltered national map. This is the single
highest-value map fix for the demo: it's what makes the page→map handoff feel like one
product instead of two.

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
