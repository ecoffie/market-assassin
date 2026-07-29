# Lib-duplicate drift — briefing routing-key follow-ups (2026-07-28)

Found while grepping for the FM-07 bug class (a route re-implements a lib fn → the two
drift). The safe dedups shipped in **PR #594** (`hasCustomNaics`, `normalizeAgencyKey`) and
the FM-07 app fix in **PR #593**. These TWO were deliberately NOT bundled — they change what
briefings/alerts a user actually receives, so they need their own PR + live verification.

Both are briefing/alert **routing keys** with NO single lib canonical — that's the root cause.

> **STATUS 2026-07-28: BOTH FIXED** (PR pending merge). #1 → `src/lib/briefings/naics-profile-hash.ts`;
> #2 → `src/lib/briefings/naics-briefing-expansion.ts`. Ledger rows added. Notes below kept as the
> record of what was found. NOTE on #1: the sweep's stated failure ("triage misses a precomputed
> briefing") was WRONG on investigation — triage uses the hash only to scope its OWN
> `user_dismissed_targets` table, never reads `briefing_templates`. The real drift was still worth
> fixing (whitespace/empty profiles hashed two ways across the 7 surfaces), and the canonical was
> chosen to be a no-op on all clean prod data (verified: 1722/1724 templates unchanged).

## 1. 🔴 `hashNaicsProfile` — template-key drift (highest blast radius)
Seven surfaces compute the briefing-template hash, and they DON'T agree on normalization:
- **6 identical copies** (the precompute + send crons + `alerts/preferences`): `[...naicsCodes].sort()` → md5.
  - `precompute-briefings/route.ts:54`, `precompute-weekly-briefings/route.ts:92`,
    `precompute-pursuit-briefs/route.ts:110`, `send-briefings-fast`, `send-weekly-fast/route.ts:84`,
    `send-pursuit-fast/route.ts:69`, `alerts/preferences/route.ts:11`
- **1 DRIFTED copy** — `src/app/api/app/triage/route.ts:44`: `[...naicsCodes].map(c => c.trim()).filter(Boolean).sort()` → md5.

**Divergent case:** a profile with a stray space or empty entry (`['541512', ' 541611']` or a `''`).
The triage copy trims/filters first → a DIFFERENT hex hash than the precompute cron wrote →
triage looks up a template hash that was never precomputed → user silently misses their briefing.

**Fix:** extract ONE `hashNaicsProfile(codes)` into a lib (decide trim/filter ONCE — trimming is
arguably correct, but it must be the SAME everywhere), import it in all 7 files, delete the copies.
**Verify:** the precompute cron and triage must produce the same hash for the same profile — assert
in a unit test with a whitespace/empty-entry input; then confirm live that a triage lookup hits a
precomputed template.

## 2. 🔴 `expandNaicsCodes` — briefing route copies bypass the lib expander
Lib canonical: `src/lib/utils/naics-expansion.ts:282` `expandNAICSCodes` (backed by `NAICS_DATABASE`,
has the `expandFullCodes` flag whose whole point is to STOP a 6-digit code blowing out to its
70-code family — see the PERSIST-vs-QUERY rule in CLAUDE.md).

Route-local copies use a private `NAICS_EXPANSION` object (NOT the lib) + hard `.slice(0,10)`:
- `precompute-weekly-briefings/route.ts:39`
- `weekly-deep-dive/route.ts:43`
- `send-all-briefings/route.ts:73`

**Two drifts:**
1. **Route vs lib:** for a 3-digit prefix the lib returns the full family; the route returns a small
   curated subset then slices. For a 6-digit code the lib (default) expands to the parent subsector
   while the route keeps it exact — opposite behaviors → different opportunity sets fetched depending
   on which path runs.
2. **Route vs route:** `weekly-deep-dive:58-61` and `precompute-weekly:54-57` have a no-match fallback
   (`if (expanded.length === 0 && code.length >= 3) expanded.push(code)`). **`send-all-briefings:80-88`
   is MISSING it** → a non-standard code (e.g. `['999']`) drops to `[]` → that user's briefing fetches
   on an empty NAICS set (no opportunities).

**Fix:** route copies should import the lib `expandNAICSCodes`; at minimum add the no-match fallback
to `send-all-briefings`. **Careful:** don't silently widen matching for every user — check the
`expandFullCodes` semantics the briefing path actually wants (query-time broadening is fine, but keep
it consistent). Verify against a real profile that briefing opportunity counts don't crater or explode.

## Also noted (lower priority, from the same sweep)
- `normalizeAgencyKey` #3 at `src/lib/gov-contacts/dodaac-directory.ts:109` is a genuinely DRIFTED
  private copy (lowercases + strips parentheticals, keeps ADMINISTRATION/AGENCY/NATIONAL the canonical
  drops). Private to DoDAAC sub-agency matching → merging could shift office resolution, so it needs a
  deliberate decision, not a mechanical merge.
- `normalizeAgency` byte-identical route↔route copies at `sba-goaling/route.ts:72` +
  `sba-goaling/bulk/route.ts:67` (no lib canonical). Low risk; extract if either changes.
- `generatePursuitBrief` — 3 route copies each hand-roll a different LLM prompt/signature (the cron
  copy drops keywords the API copy includes). DIFFERENT-PURPOSE, but a real consistency hazard: a
  user's pursuit brief differs by which surface produced it. Consolidate the prompt if pursuit briefs
  are revived (currently retired — memory `pursuit_briefs_cut`).
- TRIVIAL (leave): `escapeHtml`, `getDaysUntil`, `formatCurrency`, `normalizeEmail` — byte-identical or
  presentational copies, low drift risk.
