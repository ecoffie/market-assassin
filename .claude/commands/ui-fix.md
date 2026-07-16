Fix how something LOOKS — only after proving the data is right. Target: $ARGUMENTS

## Stop. Is this actually a UI bug?

Run the CLAUDE.md decision tree first. Most "the UI is wrong" reports are not UI bugs:

1. **Wrong DATA?** Query the source, compare to the screen. A "No X found" when rows exist, or a stale figure, is a **query/wiring bug** → fix the backend. Masking it in the component is how a 386-turn loop starts.
2. **Stale CACHE?** DB right, screen old → fix the cache layer (KV / last-good / SWR / the TMR `SPEND_SCHEMA_VERSION`), not the component.
3. **Only now**, if the data is right and the presentation is wrong, is it this skill's job.

If it turns out to be 1 or 2, say so and go fix that instead. Don't proceed out of momentum.

## Standing UI standards

Apply these to whatever you touch:

- **counts at the top** — the user should never have to count rows
- **names, not codes** — "Roofing Contractors", not `238160` alone
- **chips are clickable** if they look clickable
- **a spinner on load** — never an empty state that reads as "no data"
- **legible contrast**, both themes
- **vertical bars** for magnitude comparisons
- **no dead empty-state** — say what to do next
- **define the jargon** — a client reading a report doesn't know what a PSC is
- **numbers use tabular figures** so columns line up
- **state the basis** next to any figure whose meaning depends on it (window, filter, NAICS set) — an unlabelled number invites "your data is wrong"

## Then prove it

A UI fix isn't done because it compiles:

```bash
/verify-panel <panel>     # rendered rows == API rows
npm run verify:live -- /<route> --expect-text "<the thing you fixed>" --no-rows
```

Report what changed and the evidence you saw it — the real screen or the real HTML, not the diff.
