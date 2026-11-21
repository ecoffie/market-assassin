# Map cards print "City, null" for foreign places of performance — OPEN

Recorded 2026-10-04 while verifying #1825 + #1826. **Not fixed; separate from those PRs.**

## Observed (live API, read-only)
`GET /api/app/opportunity-map?bbox=-180,-85,180,85&status=active&sources=sam,sbir&country=oconus&naics=336611,336612`
returns `loc` values:

| `loc` | `locSrc` |
|---|---|
| `"Yokosuka, null"` | pop |
| `"FPO, null"` | pop |
| `"YOKOSUKA BASE, null"` | pop |
| `"Sasebo, null"` | pop |
| `"BREMERTON, WA"` | pop (correct, for contrast) |

The literal text `null` renders on the result card (seen in the desktop and phone screenshots of
the overseas scenario: "YOKOSUKA BASE, null", "Sasebo, null").

## Cause (read, not yet tested)
`src/lib/opportunities/map-data.ts:349`:

```ts
loc: city ? `${city}, ${state}` : state,
```

A foreign place of performance has a city but no US state, so a null `state` is interpolated as the
string `"null"`. Other `loc` builders in the same file (`${office.city}, ${office.state}`, lines
~418 and ~447) can produce the same string if either part is null.

## Questions before fixing
- What should a foreign place read as — `"Yokosuka, Japan"` (needs the PoP country, if stored) or
  just `"Yokosuka"`? Is `pop_country` available on these rows?
- `"FPO, null"` is a military post office, not a place; should it read "Overseas (FPO)"?
- The same `loc` likely feeds shares / OG metadata (`share-metadata.ts`) — check those surfaces too
  (one fix = every surface).
