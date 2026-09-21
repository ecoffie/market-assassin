# Gov Buyers data-quality fix — "Seoul, DC" + mangled "State" agency (2026-07-26)

Branch `fix/gov-buyers-data-quality`. A DATA-QUALITY fix for the Opportunity Map **Gov
Buyers** dataset (`/opportunity-map` → Gov Buyers), in the class of the phone-as-name
cleanup (#462). NOT drawer features (another agent owns `feat/close-drawer-parity-gaps`).

## Symptoms (Eric's screenshot)
- `Jenina Dosch · State · Seoul, DC` and `Abegail B. Lamban-Tubo · State · Manila, DC` —
  a foreign embassy city (Seoul, Manila) paired with a US state code it isn't in ("DC"),
  and the agency rendered as the bare word **"State"** (reads like a field label).
- Companies (purple) cards were clean by contrast (Louisville KY, Oak Ridge TN) — the
  defect was specific to BUYERS.

## Root cause (two independent bugs, both in the buyer LOCATION/AGENCY derivation)

`federal_contacts` has no location column, so `buyersPins()` (`contacts-map/route.ts`) and
`getBuyerDetail()` (`buyer-detail.ts`) recover a location by joining the POC's
`solicitation_number` → `sam_opportunities`.

1. **Foreign place-of-performance paired with the US buying-office state → "Seoul, DC".**
   State-Dept notices carry an OVERSEAS place of performance:
   `pop_city="Seoul"`, `pop_state="KR-11"` (a **foreign ISO subdivision**, not a US state),
   bought by an office in Washington (`office_address.state="DC"`, `office_address.country="USA"`).
   The old code did `state = normalizeStateCode(pop_state || office.state)`. Because
   `"KR-11"` isn't a US state, `normalizeStateCode` returned null → the STATE fell back to
   the office's `"DC"` — but the CITY was still the pop city `"Seoul"`. Result:
   `"Seoul, DC"` — a foreign city stapled to a US state it isn't in. (`office_address.country`
   is unreliable here — it's `"USA"` even for a Seoul post, so country can't be the signal;
   the real signal is that the city doesn't geocode inside the resolved state.)

2. **Agency mangled to a bare field-label "State".** The map's client-side `clean()`
   strips `", DEPARTMENT OF"` from `department_ind_agency` and title-cases. SAM stores
   departments inverted + ALL-CAPS: `"STATE, DEPARTMENT OF"`. `clean()` → `"State"`.

## Measured defect rate (real DB, read-only — `federal_contacts` = 181,097 rows)
Across **18,724** distinct buyers (name+agency) that resolve to any location via the join:

| Defect | Count | Rate |
|---|---|---|
| Agency in inverted `"…, DEPARTMENT OF"` form (mangled by `clean()` to a truncated label) | **6,364** | **34%** |
| …of which State Dept specifically (`"STATE, DEPARTMENT OF"` → "State") | 679 | 3.6% |
| Foreign `pop_state` (non-US code) → the "Seoul/Manila, DC" mismatch class | **848** | **4.5%** |

`federal_contacts` where `department_ind_agency ILIKE 'STATE%'` = **2,988** rows (all
`"STATE, DEPARTMENT OF"`; the "embassy" office flag is essentially absent — 1 row — so the
foreign-city problem is entirely the LOCATION JOIN, confirming it's a render/derivation
bug, not an embassy field).

## The fix (all at the DATA source — render just displays clean values)

Two new **pure, unit-tested** helpers, reused by the pin payload AND the drawer:

- **`formatAgencyDisplay(raw)`** (`src/lib/mindy/agency-display.ts`) — un-inverts the SAM
  form and Title-Cases: `"STATE, DEPARTMENT OF"` → **"Department of State"**,
  `"INTERIOR, DEPARTMENT OF THE"` → "Department of the Interior",
  `"GENERAL SERVICES ADMINISTRATION"` → "General Services Administration" (acronyms US/GSA/NASA
  preserved; joining words `of/the/and` lowercased). Only ever rearranges + re-cases the real
  string — never invents an agency; empty → `''`.
- **`resolveBuyerLocation({popCity,popState,officeCity,officeState})`** + `isCityInState()`
  (`src/lib/geo/city-geocode.ts`) — resolves ONE **coherent** US location. Rules:
  1. pop_state is a real US state AND pop_city is a real GeoNames city IN it → use pop city+state.
  2. pop_state is a real US state but the city doesn't validate → state-only (no bogus city).
  3. pop is foreign/unusable → fall back to the buying OFFICE (city kept only if it's a real
     city in the office state, else state-only), flagged `approxNote:'buying office'`.
  4. no real US state anywhere → `null` (no pin; never fabricate).
  **A city is shown ONLY when confirmed to sit in the resolved state** (validated against the
  bundled ~29.5K-city GeoNames table). So "Seoul, DC" cannot render: Seoul isn't in DC → it's
  dropped, and the coherent buying-office `Washington, DC` (a real city↔state pair) is used
  instead; a base-name office city that isn't in GeoNames drops cleanly to state-only.

### Wired into all three buyer surfaces
- **Pin payload / list card** — `contacts-map/route.ts` `buyersPins()`: `solLoc` now stores
  the resolved coherent `{city,state,approxNote}`; the pin emits
  `agency: formatAgencyDisplay(...) || 'Government'`, a validated `city`, and `locApprox`.
- **Map pin popup + list card render** — `opportunity-map/route.ts` buyers branch: **stopped
  re-running `clean()` on the buyer agency** (it would have stripped "Department of State"
  back to "State") — the server value is already clean. State-only buying-office locations
  render `"ST (buying office)"`.
- **Buyer drawer** — `buyer-detail.ts`: header `agency` = `formatAgencyDisplay(...)`; a new
  `agencyRaw` field carries the stored value so the "See their opportunities / Find similar
  buyers" links still match `department_ind_agency` in the DB (display value would never
  match). Location via `resolveBuyerLocation`; buying-office fallback flagged approximate.

### Cleanliness / identity guard (#462)
`isUsableContactName`/`isUsableContactCard` (the phone-as-name guard) is already applied to
buyers in BOTH `buyersPins` (query ILIKE excludes + `.filter(isUsableContactCard)`) and
`getBuyerDetail`. Confirmed — no card renders without a usable name; agency falls back to a
neutral "Government" rather than an empty label.

## Render fix vs data backfill
**100% render/derivation fix — no backfill needed.** The underlying `federal_contacts` and
`sam_opportunities` rows are correct (the agency really is "STATE, DEPARTMENT OF"; the pop
really is Seoul/KR-11). The bug was in how the two were combined + displayed. Nothing to
re-source; nothing written.

**Follow-up (optional, not this PR):** overseas State-Dept posts genuinely have no US place
of performance — today they anchor to the DC buying office (honest, flagged approximate). If
we later want to show the real post ("Seoul, South Korea"), that needs a foreign-city
geocode table + a country column surfaced through the join — a feature, not a data fix.

## Tests / gates
- New: `agency-display.unit.test.ts` (formatAgencyDisplay), `buyer-location.unit.test.ts`
  (resolveBuyerLocation + isCityInState — incl. the canonical invariant "a resolved city is
  always in the resolved state" + the explicit Seoul/Manila cases).
- Updated: `buyer-detail.unit.test.ts` — agency display vs raw, + a State-Dept Seoul
  regression asserting the drawer never contains "Seoul".
- `npx tsc --noEmit` clean. `npm run test:unit` → **67 files / 644 tests pass**.
- Silent-failure gate + rank-then-filter gate: no new findings.
