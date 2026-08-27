---
name: map-contract-verify
description: Verifies Opportunity Map fixes against the browser-first contract (filter state, returned records, displayed count, URL state, visible controls, auth state, mobile layout). Use when closing a Map bug, after filter/count/URL work, or when a user says a Map filter did nothing.
disable-model-invocation: true
---

# Map contract verify

A Map fix is not verified until code correctness, data correctness, displayed correctness, and user-perceived correctness agree. Grep alone never closes a Map P0.

Path authority lives in `scripts/ma-skill-registry.json` under `mapContract`. Do not invent parallel browser harnesses. Reuse Puppeteer scripts already in this repo.

## Contract dimensions

All seven must describe the same universe:

1. Filter state
2. Returned records
3. Displayed count
4. URL state
5. Visible controls
6. Authentication state
7. Mobile layout

The five-way browser script covers 1-5. Auth and mobile are separate journeys and unit tests in the same registry section.

## Procedure

1. Read `docs/DEMO-EVIDENCE-SYSTEM.md` for the correctness hierarchy and the "filter didn't work" diagnostic rule.
2. Reproduce on the Map surface the user saw (same filter, viewport, and auth state when possible).
3. Run unit invariants first (fast, offline):

```bash
npx vitest run \
  src/app/opportunity-map/filter-parity-all-datasets.unit.test.ts \
  src/app/opportunity-map/deeplink-roundtrip.unit.test.ts \
  src/app/opportunity-map/mobile-responsive.unit.test.ts \
  src/app/opportunity-map/login-modal.unit.test.ts \
  src/app/opportunity-map/fetch-failure-not-empty.unit.test.ts
```

4. Run the five-way browser contract against the intended host:

```bash
node scripts/verify-filter-contract.mjs
# optional: --case <name> --base http://localhost:3000
```

Displayed counts are viewport-scoped. Nationwide truth is for drift detection, not exact equality. Read the scope comment at the top of `scripts/verify-filter-contract.mjs` before changing product code to chase a green bar.

5. Cover auth, anonymous, and mobile with the existing journeys when the defect touches those dimensions:

```bash
node scripts/journey-authenticated.mjs
node scripts/journey-anonymous.mjs
node scripts/journey-mobile.mjs
```

Use `node scripts/browser-verify.mjs` for a targeted headless assert or screenshot when a journey is too broad. Prefer stable text/selectors from the Map page over coordinates.

6. Run `node scripts/truth-canary.mjs` when the symptom is a cross-surface contradiction (API count vs header, filter vs cards).
7. Keep `npm run verify:oracles` and `scripts/audit-rank-then-filter.mjs` in the gate set for filter/scope starvation classes. Do not replace them.

## Pass / fail

- Pass only when every exercised dimension agrees and the user-visible symptom is gone on the real surface.
- Report any dimension left unverified. Unverified is not passed.
- Stop at the current authorization boundary. This skill does not authorize commits, deploys, or production writes.

## Anti-patterns

- Declaring fixed from a unit test or code read alone
- Building a second browser framework beside the existing Puppeteer scripts
- Freezing live record counts, demo NAICS codes, or temporary incident notes into this skill
