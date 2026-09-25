# STALE-RESUME-PILL — "Picked up where you left off · <query>" survives a new search (2026-09-25)

**Status:** recorded, not fixed. Found during #1693 browser acceptance. Pre-existing return-continuity behavior (not introduced by P1).

## Reproduce
1. Search "software license" on `/opportunity-map`; leave.
2. Return: the map restores it and shows the pill **"Picked up where you left off · 'software license' · Start fresh"**.
3. Run a different search ("ai governance", then "cybersecurity").
4. The pill still reads **"software license"** while the map, URL (`?q=cybersecurity`) and list show cybersecurity.

## Why it matters
The pill names a market the user is no longer looking at, and its "Start fresh" now clears a search the user just typed. Same principle as "never let an old answer masquerade as the new one".

## Expected
The pill is a statement about the RESTORED session. Once the user acts on their own (search, filter, agency, state, horizon change), it should leave. Start fresh already removes it.

## Where to look
Return-continuity boot restorer in `BOOT_VIEW_JS` (`src/app/opportunity-map/route.ts`, `window.__applySavedSearch` / the "Picked up" pill), and `return-continuity.unit.test.ts` for the contract. Add a behavioral test: restore → user search → pill absent.
