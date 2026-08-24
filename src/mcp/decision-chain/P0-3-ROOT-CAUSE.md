# P0-3 root cause — SAM ships the small-business signal; ingestion throws it away.

**Eric's hypothesis was correct.** Mindy already pulls the SAM records that contain
per-NAICS small-business status and discards the field during transform. This is the real
root cause — better than either a DSBS dependency or building a size-standard engine.

## The evidence, from live SAM (2026-08-23)

`assertions.goodsAndServices.naicsList[]` entries carry **four** keys:

```json
{"naicsCode": "561720", "naicsDescription": "Janitorial Services ",
 "sbaSmallBusiness": "N", "naicsException": null}
```

`sbaSmallBusiness` is **per-NAICS** — the exact granularity a Rule-of-Two determination
needs, since a firm can be small under one code and large under another.

Verified across the known 561720 performers:

| Firm | Lifetime award | `sbaSmallBusiness` (561720) | socioeconomic certs |
|---|---|---|---|
| J & J MAINTENANCE INC | $175.9M | **N** | none |
| FEDCAP REHABILITATION SERVICES | $109.8M | **N** | none |
| DIDLAKE INC | $74.1M | **N** | none |
| **OS-DB-JV-2 LLC** | $60.4M | **Y** | none |

The field discriminates correctly and matches award scale.

## Where it is dropped

`src/lib/sam/entity-api.ts:183-187` — the parser reads three keys and silently drops the
fourth:

```ts
const naicsList = naicsRaw.map(n => ({
  naicsCode: String(n.naicsCode || ''),
  naicsDescription: String(n.naicsDescription || ''),
  isPrimary: Boolean(n.isPrimary === 'Y' || ...)
  // sbaSmallBusiness — NEVER READ
}));
```

`grep -rin "naicsLimitedSB\|sbaSmallBusiness" src/` returns **nothing**. The signal is
fetched over the wire on every sync and thrown away before it reaches the database.

Then `sync-gov-buyer-data/route.ts:111` persists only:

```ts
const certs: string[] = e.certifications?.sbaBusinessTypes || [];
```

So `sam_entities` stores socioeconomic **certifications** and no **size** information at all.

## This answers the open question about "Small Business"

I previously listed "unsupported / reject it" as a candidate reading. **That was wrong, and
the data shows why.**

All four known 561720 performers carry `sbaBusinessTypeList: [None]` — **no socioeconomic
certification whatsoever**. So:

- **(a) "any socioeconomic cert"** would still return ZERO for these firms. It is not a
  workable definition of small business.
- **(c) "unsupported"** would refuse a question SAM can actually answer.
- The correct reading is the one SAM itself uses: **`sbaSmallBusiness == 'Y'` for the NAICS
  in question.**

A Rule-of-Two determination for a general small-business set-aside is exactly this field.
Socioeconomic certifications answer a *different* question (8(a)/HUBZone/SDVOSB set-asides),
and conflating the two is what `certifications[]` currently forces.

## The schema is the wrong abstraction

`certifications: string[]` flattens categories SAM keeps separate:

| SAM concept | Example | Currently stored? |
|---|---|---|
| SBA business types | 8(a), HUBZone, SDVOSB, WOSB | yes — as `certifications[]` |
| **Per-NAICS size status** | **`sbaSmallBusiness: Y/N`** | **NO — dropped** |
| NAICS exception | `naicsException` | no |
| Business types (non-SBA) | various | no |
| repsAndCerts | requires `includeSections=repsAndCerts` | not requested |

Note also: **VOSB (4,819 firms in this NAICS) is stored but never advertised**, while
EDWOSB and "Small Business" are advertised but can never match.

## Proposed fix — schema + ingestion, NOT a new engine

1. **Persist the signal.** Read `sbaSmallBusiness` (and `naicsException`) per NAICS in
   `entity-api.ts`, and store a per-NAICS map on `sam_entities` — e.g.
   `small_business_naics text[]` (codes where the entity self-certifies small) alongside the
   existing `naics_codes`.
2. **Filter on it** in `market-research.ts` when `setAside` is a general small-business
   request, instead of `certifications @> ['SBA']`.
3. **Fix the advertised vocabulary** — drop EDWOSB and the ambiguous "Small Business" label
   or define it explicitly as the size test; add VOSB.
4. **Backfill.** `sam_entities` has no size data today, so existing rows need re-sync.

**Caveats to state plainly, not bury:**
- `sbaSmallBusiness` is a **self-certification** in SAM, not an SBA vetting. The tool's
  existing caveat language already draws this distinction for WOSB/SDVOSB/VOSB and must be
  extended to cover it.
- Step 4 is a **bulk re-sync across the entity corpus** — that needs sizing and an explicit
  go-ahead before it runs.

**No code written yet.** This is a schema + backfill change, which is bigger than the
one-line filter fix P0-3 first appeared to be, and it should be scoped before implementation.
