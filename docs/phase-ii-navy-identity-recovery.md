# Navy LRAE — Stage 2A identity recovery (READ-ONLY)

**Date:** 2026-09-13 · **No rows were written.** This answers the 14-point read-only
contract before any Navy mutation.

> **The rule this exists to enforce:** *arithmetic reconciliation is not identity
> proof.* The Stage 2 planner balanced perfectly and was still catastrophically
> wrong — it would have inserted 7,055 duplicates and marked all 8,821 held rows
> absent. A plan can be internally consistent and completely incorrect.

---

## 1. Was the legacy generator found in history? **No — and this was verified, not assumed.**

Searched the full history (`git log --all -S`), not the current tree:

| Probe | Result |
|---|---|
| `-S "NAVY-T"` / `-S "NAVY-C"` | **zero commits, ever** |
| `-S "Combined LRAE"` | only my own Stage 1/2 commits + two squashed test-fixture roots |
| `-S "NAVSUP"` | same |
| deleted files matching `lrae`/`navy` | only files I created this session |
| commit `07ed9178` (the forecast expansion that grew the corpus) | ships USACE/DOE/DHS importers — **no Navy importer** |

`scripts/import-forecasts.js` handles only the **67-row ONR/NRL** workbook
(`onr-nrl-lrae.xlsx`), never the 8,754-row Combined LRAE.

**The 8,821 Navy rows were produced by an out-of-repo process. The generator does
not exist in this repository and cannot be recovered from it.**

One corroborating trace survives — `07ed9178` line 364 states that DOE's
`external_id` *"needs no content hash (unlike USACE/**NAVSUP**, whose titles
repeat)"*. So the hash suffix existed **because Navy titles repeat**, which the
measurements below confirm independently.

## 2. What do T and C mean? **Derived from the data, not the letters.**

| Prefix | Rows | Base segment shape |
|---|---:|---|
| `NAVY-T` | 6,613 | **6,417 are 6-char DoDAACs** (`^N[0-9A-Z]{5}$`), e.g. `N62478` |
| `NAVY-C` | 2,208 | **2,004 are longer contract numbers**, e.g. `N0001422D4002` |

So **T = keyed on the contracting-office UIC/DoDAAC**, **C = keyed on an existing
contract number**. The letters were never assumed; the split is measured.

## 3. Workbook fields that feed identity

`Full LRAE`, 51 columns (26 real + 25 `__EMPTY_*`). The two that map onto the
legacy scheme:

- **col 7 `Contracting Office UIC`** → the `NAVY-T` base
- **col 14 `Existing Contract Number`** → the `NAVY-C` base

## 4–5. Can the legacy `external_id` be reproduced exactly? **No. 0 / 8,821.**

The suffix is base-36, **length 3–7, 5,661 distinct across 6,613 `NAVY-T` rows** —
the signature of a numeric hash rendered with `toString(36)`. Reproducing it needs
both the exact input field set and the exact algorithm; **neither survives in the
repo**. Brute-forcing algorithms until examples match is explicitly out of bounds,
and a handful of matches would prove nothing anyway.

## 6–9. Source-native identity candidates — measured on the live 9,922-row workbook

| Candidate | Coverage | Distinct | Colliding values |
|---|---|---:|---:|
| `Contracting Office UIC` | 8,041 / 9,922 (81%) | **107** | 80 |
| `Existing Contract Number` | 6,148 / 9,922 (62%) | 1,981 | 104 |
| `UIC \| ContractNo \| Title` | — | **7,094** | — |
| `Requirement Title` alone | 6,981 distinct | — | **2,941 duplicates** |

**No source-native field or combination is unique.** The best composite leaves
**2,828 of 9,922 rows sharing an identity**. This is precisely why the original
import needed a hash suffix — and precisely why a naive title-based key produced the
2,867 duplicates the planner reported.

## 10–13. Mapping counts

| Class | Count |
|---|---:|
| EXACT_LEGACY_MATCH | **0** (generator unavailable) |
| EXACT_SOURCE_KEY_MATCH | **0** (no unique source-native key exists) |
| AMBIGUOUS | **2,828** rows share a composite identity |
| NEW_PROVEN | **0** — cannot prove any row is new without a working identity |
| UNMATCHED | **9,922** (the whole workbook, under current evidence) |

⚠️ The earlier planner output — `NEW = 7,055`, `absentUpstream = 8,821` — is
**INVALID** and retained only as evidence that the attempted identity scheme failed.
Neither number may be used for mutation.

## 14. Recommended strategy: **MANUAL — identity contract unresolved**

Legacy recovery (path A) is impossible: the generator is not in the repo.
Source-native migration (path B) is **also not available** — it requires a "truly
stable source-native identifier", and the workbook demonstrably has none.

That leaves the third outcome, and it is the honest one.

### What stays automated — the whole point

Navy does **not** go blind. Everything built in Stages 1 and 2 keeps working:

- automatic `MM.YYYY` revision discovery (bounded, newest-first)
- XLSX signature validation (the HTML soft-404 can never be mistaken for a workbook)
- source fingerprint — ETag `,4` version counter · Last-Modified · Content-Length —
  read from a **2 KB ranged GET**, so the daily watch never downloads 4.1 MB
- `latestAvailableRevision` vs `latestHeldRevision`
- content-currentness (Navy is **revision-current, content-behind**: 9,922 upstream
  vs 8,821 held)
- `BEHIND_UPSTREAM` detection

**Only the WRITE step is manual**, giving the operating model of
*automated discovery + manual ingest*:

```
daily watch → new revision or changed fingerprint → BEHIND_UPSTREAM
           → Slack alert → controlled human import → verification → CURRENT
```

### Outstanding for the MANUAL source contract

Per the manual-source rule, Navy is not operationally complete until it also has a
documented runbook and owner, a derived `nextDueAt`, Slack alerting with duplicate
suppression, and upload verification that refuses to clear the alert unless the
artifact actually changed. **None of that is built yet** — it is the next Navy
Potato, and it is shared infrastructure, not Navy-specific.

## What would unblock full automation

A future Navy import could adopt a **new documented identity convention** (e.g.
`NAVY2:<uic>|<contract>|<sha256(title+description+program)>`), backfilled only where
a mapping is *proven*. That is a schema/identity migration and, per the contract,
must be presented for approval — with the exact backfillable and ambiguous
populations — before any mutation. It is **not** attempted here.
