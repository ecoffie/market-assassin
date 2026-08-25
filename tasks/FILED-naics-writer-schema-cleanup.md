# FILED — NAICS writer/schema cleanup (follow-up to DEFECT-8)

**Filed 2026-08-25. Not urgent. Do NOT bundle this into a bug fix.**

DEFECT-8 fixed the READ side: `src/lib/profile/naics-signal.ts` reads either stored shape
and preserves provenance, so nothing produces wrong output. The WRITE side still diverges.

## What remains

`user_business_profiles.extracted_naics_codes` has two writers storing different types:

| writer | shape | rows (2026-08-25) | meaning |
|---|---|---:|---|
| `api/sample-opportunities/route.ts:50` | `[{code,name,count}]` | 66 | opportunities the user CLICKED |
| `api/app/profile/route.ts:305,315` | `["541512", …]` | 276 | codes the user DECLARED |

The column name `extracted` implies a third thing — extracted from the business
description — which it has never been on either path.

## The eventual model (Eric's direction)

**Separate typed signals, not one overloaded column.** Four distinct signals exist and
reconciling them is arguably a product feature, not just hygiene:

| Signal | Means | Legitimate use |
|---|---|---|
| stated capability | "we can do X" | classification, matching |
| observed pursuit | "they looked at X" | recommendations, ranking |
| verified work history | "they were paid for X" | past performance, credibility |
| registered classification | "they claim X to SAM" | eligibility, set-aside |

> "you say you do X, you're registered for Y, you've been paid for Z, and you keep
> clicking W" — a real BD insight Mindy is positioned to produce and does not.

## Constraints for whoever picks this up

- **Do not destroy the click COUNT.** `{code,name,count}` carries how strongly a user
  showed interest. A naive normalization to `["541512"]` throws that away, and it is the
  part that makes interest useful for recommendations.
- **Observed interest is not bad data.** It is a DIFFERENT KIND of data. The DEFECT-8
  audit disproved the original "click codes are wrong" reading: measured across the
  corpus they are mostly accurate, and 0 of 39 click-path users have a wrong-industry
  alert profile.
- **The read seam already handles both shapes**, so a migration is not required for
  correctness — only for clarity. Ship it when it buys something, not for tidiness.
- Any migration must keep `naics-signal.ts` working for un-migrated rows until the
  backfill is verified complete.
