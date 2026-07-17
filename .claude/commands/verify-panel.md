Prove a panel RENDERS the data its API returns. Panel: $ARGUMENTS

This exists to catch the **facet-bug class**: the API returns 56, the UI shows 3, and nobody notices because the API "works." Rendered rows must equal API rows, or you've found the bug.

## 1. Find the pair

Panels live in `src/components/app/panels/*.tsx` / `src/components/bd-assist/*` / `src/components/briefings/*` and are switched by `UnifiedSidebar` state inside `/briefings` (or `/app`) — **not** separate routes. Locate the panel component and the endpoint it fetches.

```bash
grep -rn "fetch(" src/components/**/<Panel>.tsx | head
```

## 2. Get the API's number

```bash
npm run verify:live -- "/api/<the endpoint>?<the same params the panel sends>" --json
```

Note the row count. **Send the params the panel actually sends** — profile NAICS, states, limit, facets. A different query proves nothing.

## 3. Get the UI's number — and compare

The app is login-gated, so read the component and trace what it does to the payload between `fetch` and render. The bug is nearly always one of these:

- a `.slice(0, n)` capping silently
- a facet/filter applied client-side that the API already applied
- reading the wrong key (`data.results` vs `data.rows`)
- a `key` collision collapsing rows
- a default filter in component state that the user never set

State both numbers explicitly: **API returned N, panel renders M.** If N ≠ M, that's the finding — say which line causes it.

## 4. Fix at the right layer

Follow the CLAUDE.md decision tree before touching the component:

1. **Wrong data?** → fix the query/wiring, not the UI.
2. **Stale cache?** → fix the cache layer.
3. **Render?** → then it's the component.

Masking a data bug in the UI is how a 386-turn loop starts.

## 5. Report

`API: N rows · Panel: M rendered · <verdict>`. If they match, say so plainly and stop — don't invent a fix.
