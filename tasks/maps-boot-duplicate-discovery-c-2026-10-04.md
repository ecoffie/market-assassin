# C — duplicate boot-round reproduction (2026-10-04)

**Method.** Production getmindy.ai, signed in (staff). Each scenario was a fresh navigation.
- Requests: `performance.getEntriesByType('resource')` for the map APIs.
- Rounds: `window.__mapBootTrace` (`round` / `request` / `abort` / `moveend` / `boot-release`).
- Trigger callers: identified with a capture-only patched copy of the served page that recorded a stack on every `fetchView` call.
- Caveat: the tab was backgrounded (`document.hidden=true`), so `fetchView` dispatches by setTimeout rather than rAF, and timer throttling stretched the ~300 ms trigger to ~600–900 ms. Classification does not depend on timing.

**Rule applied.** A second request is a bug only if an automatic transition repeats discovery already completed for the same effective query.

| Scenario | Map API requests (bbox, counts) | Rounds with no request | Classification |
|---|---|---|---|
| Default load (restored Open-only) | B1 withCounts · B2 pinsOnly | 2 (joined/cache) | BOOT DISCOVERY · AUTO-FIT PINS-ONLY |
| `?mode=open` | B1 withCounts | 3 | BOOT DISCOVERY |
| `?mode=recompete` | B1 withCounts | 3 | BOOT DISCOVERY |
| `?mode=forecast` | B1 withCounts | 3 | BOOT DISCOVERY |
| `?opp=3256c468…` deep link | B1 withCounts | 3 | BOOT DISCOVERY |
| `?state=VA&naics=541512` | B1 withCounts · B2 pinsOnly | 2 | BOOT DISCOVERY · AUTO-FIT PINS-ONLY |
| `?mode=companies` (Players) | companies+buyers at B1 × **3** (all full) | — | BOOT DISCOVERY · **DUPLICATE DISCOVERY ×2** |

## Triggers (stack-captured)

1. **Release round:** `finishBoot` (system).
2. **Second round, about +300 ms:** two causes.
   - `setTimeout(fetchView,300)`, a legacy initial fetch from #410 that predates the boot-view release. It passes no opts, so it is treated as a USER ACTION and bumps the generation.
   - The boot's own `navigate` moveend, fired ~1 ms before release while `__suppressFetchView` was still true. It armed the 450 ms pan timer (`{pan:true}`).
3. **Third round, at about 4 s:** the failsafe ran `releaseFit` and `__mapRefetch({system:true})` even though boot had already released.

All three ask the same bbox and the same filters. The opportunity horizons join the in-flight request or hit the 5-minute horizon cache, so the triggers cost no extra requests there (they still cost a generation bump and a repaint). The Players branch fetches contacts-map directly with no cache, so each trigger is a full repeat.

## Repair — PR #1829 (first triggering layer = boot sequencing)

- `moveStartsRound(released, kind, layoutExposed)` in `layout-move.ts`: no move before release schedules a round.
- The legacy 300 ms timer is removed.
- The failsafe is a no-op once released.

## Proof

- **Unit tests:** red on main and green on the branch.
- **In-browser patched production page (same 4 edits):** Players went from 3 pairs to 1. This harness renders a zero-size map, so it proves counts only.
- **Preview (`bc2f742e`, anonymous):** Open +300 ms round and failsafe round gone; filter keeps boot + auto-fit pinsOnly; deep link = 1 round.

## Production acceptance — merge `6e981699` (PR #1829), signed in, 2026-10-04 — ✅ PRODUCTION PROVEN

Served page: `if(_bootReleased)return;` ×1 · `moveStartsRound=moveStartsRound` ×1 · `setTimeout(fetchView,300)` ×0.

| Scenario | Before | After |
|---|---|---|
| Players `?mode=companies` | 3 × (companies+buyers) | **1 × (companies+buyers)**, 588 pins drawn, list renders |
| Default load | B1 withCounts (+ extra rounds, no requests) | B1 withCounts, 1 round |
| `?mode=recompete` | B1 + 3 no-request rounds | B1, 1 round |
| `?mode=forecast` | B1 + 3 no-request rounds | B1, 1 round |
| `?opp=` deep link | B1 + 3 no-request rounds | B1, 1 round, record opens |
| `?state=VA&naics=541512` (from a wide view) | B1 withCounts · B2 pinsOnly (auto-fit) | B1 withCounts · B2 pinsOnly (auto-fit) — unchanged |

The boot's pre-release navigate moveend now traces `skip:true`. Auto-fit is still the one place a settled round moves the map.

Not in scope: the cross-state Coming Back location residual. `PLAYERS_REBUILD_AFTER_INGEST` stays off.
