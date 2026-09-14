# SUBAGENCY FORECAST IDENTITY — POST-FIX EVIDENCE

**Shipped:** 2026-09-14 · **PR [#1512](https://github.com/ecoffie/market-assassin/pull/1512)** · merge `6767d6ec` · **verified on `https://getmindy.ai`**
Implements `tasks/subagency-forecast-anchor-audit-2026-09-14.md`. Extends the #1508 resolver — no second resolver.

**Constraints honored:** no new Forecast sources · no Air Force discovery · `agency_forecasts` unmodified · no title/description inference · the 8,380 parent-generic rows untouched · NAVSUP not shipped.

---

## SUCCESS CONDITION — MET

> for the 15 shipped child identities: **false-positive identity leakage = 0**, and all structurally attributable rows are discoverable under their child identity, subject only to documented HIGH_CONFIDENCE Navy mapping gaps.

**False positives: 0. False negatives: 0. Cross-parent leakage: 0. Sibling overlap: 0.**

## Phase 0 — env recovery

`.env.local` was found **already restored to 132 vars** (mtime 12:48; it was 30 vars at 11:01). Rather than assume, it was validated per protocol: regular file (not a symlink) · gitignored · untracked backup taken at `chmod 600` · project identity confirmed `eric-coffies-projects/market-assassin` · **variable-name set diffed against a fresh production pull — IDENTICAL (132)**, values never printed · `chmod 600` · `npm run verify:env` ✓ in both the main checkout and the worktree via `npm run env:link-worktree`. No secret was printed and `.env.local` was never committed.

## Phase 13 — live proof, all 15 children

### Maps (`/opportunity-map` → `/api/app/forecast-map`)

| Child | Before | After (identity) | Expected | Maps pins | Unmapped | FP | FN |
|---|---:|---:|---:|---:|---:|---:|---:|
| NAVFAC | **8,881** | **2,278** | 2,278 | 670 | 1,608 | 0 | 0 |
| NAVAIR | **8,881** | **1,631** | 1,631 | 1,619 | 12 | 0 | 0 |
| NAVSEA | **8,881** | **773** | 773 | 625 | 148 | 0 | 0 |
| USCG | **0** | **702** | 702 | 361 | 341 | 0 | 0 |
| CBP | **0** | **256** | 256 | 122 | 134 | 0 | 0 |
| FEMA | **0** | **117** | 117 | 47 | 70 | 0 | 0 |
| TSA | **0** | **83** | 83 | 69 | 14 | 0 | 0 |
| USSS | **0** | **59** | 59 | 43 | 16 | 0 | 0 |
| CMS | **0** | **80** | 80 | 0 | 80 | 0 | 0 |
| NIH | **0** | **34** | 34 | 0 | 34 | 0 | 0 |
| Fish & Wildlife | **0** | **710** | 710 | 710 | 0 | 0 | 0 |
| National Park Service | **0** | **14** | 14 | 14 | 0 | 0 | 0 |
| Forest Service | **0** | **639** | 639 | 567 | 72 | 0 | 0 |
| Federal Acquisition Service | **0** | **182** | 182 | 140 | 42 | 0 | 0 |
| Public Buildings Service | **0** | **28** | 28 | 27 | 1 | 0 | 0 |

*"Maps pins" is post-location eligibility; "identity" is the pre-eligibility row set.*

### MCP (live hosted connector)

| Call | Identity rows | MCP `total` | Why different |
|---|---:|---:|---|
| `agency=NAVFAC` | 2,278 | **2,278** | — (office `N62478` returned, a NAVFAC code) |
| `agency=USCG` | 702 | **702** | — (office `USCG/CG-C5I`) |
| `agency=NIH` | 34 | **6** | past-FY rule: 28 of the 34 are FY2024/FY2025 — **policy, not identity** |

### `/api/forecasts`
2FA-gated (`Missing two-factor session`), so it cannot be proven unauthenticated. Verified at code level instead: the parity test asserts **both** of its agency call sites use the shared resolver and that it contains **no** private `bureau.*` or `contracting_office.in.` matching.

### Saved-search / alert dry evaluation (no emails, no writes)
All 15 children exact under **both stored filter shapes** (pipe string and JSON array), **cross-parent leakage 0** on every one. `NAVSUP → 0` (unresolved, never a parent dump).

## Defect closure

| Metric | Before | After |
|---|---:|---:|
| Navy child false-positive row-returns | **21,961** | **0** |
| Child false-negative rows (12 children) | **3,004** | **0** |
| Unique child-addressable rows | 0 | **7,586** |
| Sibling overlap | — | **0** (7,586 assignments = 7,586 distinct) |
| **Parent-generic rows (unchanged, by design)** | 8,380 | **8,380** |
| Owned rows hidden solely by child identity | 3,004 | **0** |

## Department identity unregressed (live)

`DEFENSE` 11,789 · `ARMY` 2,908 · `EPA` 50 · `SEC` 0 · `DOD == NAVY + USACE` exactly · **every owned row reachable by agency 35,751 / 35,751**. Corpus unchanged: 35,751 rows, 20 source agencies.

## Judgment calls, recorded

- **NPS shipped at 14 (`coverage: 'thin'`).** Truthful owned data beats 0 or the 221 a keyword pass inferred from the word "park".
- **NAVFAC ships at 2,278 — `N44225` EXCLUDED.** ⚠️ **This corrects the handoff**, which expected ~2,398 via "independently verified N44225". Verification **failed**: `dodaac_directory` maps NAVFAC Northwest to **`N44255`** (0 forecast rows), while the forecast rows carry **`N44225`** (119 rows) — a transposed digit. Geography corroborates (66 of the 119 are in WA; NAVFAC NW is at Silverdale WA), but matching across a presumed typo is inference, not trusted-authority evidence. **Recorded in-code as a source-side correction to make, not a mapping to encode.** The convergence on the old 2,402 estimate is suggestive, not authoritative.
- **NAVSUP not shipped** — and deliberately **not** widened to the Navy parent either. Resolving it to NAVY would return 8,881 rows for a ~1,231-row command: the exact false positive this pass removed. It stays unresolved until office-name normalisation.
- **TSA** moved from a department-level `coverage:'none'` entry to a real child (83 rows). The stale entry was deleted so exactly one record of TSA exists.

## Verification artifacts

- **126 unit tests** — 56 child (`agency-identity-children.unit.test.ts`), 53 department, 17 four-surface parity. Full suite **5,492 passed**; `tsc` clean; **pre-push gate green (all 13)**.
- **`npm run verify:forecast-agency`** extended: every child equals its audited count **and** is a strict subset of its parent; pairwise sibling overlap counted **in SQL** (never by collecting ids — a 1,000-row page would fake a zero).
- Preview deployment verified before merge; production verified after.

## Note on concurrency (worth knowing)

A **Cursor** session was editing this same branch/worktree mid-implementation — it staged, committed (`621b1883`) and opened PR #1512 while this work was in progress. Its edits were reviewed on their merits and kept where correct (they matched the intended design); `docs/MARKETING-FEATURE-LITERATURE.md` in the commit is a legitimate companion entry for this feature, not unrelated work. Everything shipped was re-verified from scratch here. Per CLAUDE.md, concurrent sessions need **separate worktrees** — a shared branch entangles commits.

## Next

**Air Force remains the first true new-source investigation.** Unchanged by this pass: 45 strong users · 20 pursuits · 794 open opportunities · 21% audience alignment · 12,331 award/recompete rows · **0 forecast rows** · official machine-readable source still **NEEDS DISCOVERY**. If discovery fails, Army proper is next.

**Not started, per instruction.**
