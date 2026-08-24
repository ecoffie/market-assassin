# `naicsException` — measured decision impact

**Measured 2026-08-24 against the Aug-2026 public extract + the live mirror.**

## The rule this measurement follows

> Don't ask "how common is this field?" Ask **"how often would having this field change a
> Mindy decision?"** (Eric)

That rule is why this is P0 and why `purposeOfRegistration` — despite covering 28% of the
registry — turned out **not** to be. A field on 1% of entities can be P0 if those entities
systematically change a set-aside conclusion; a field on 30% can be noise if nothing reads it.

## What the source actually contains

Field 34 is the tilde-joined NAICS list. Token shapes, measured over 60K lines:

| shape | count | meaning |
|---|---:|---|
| `######Y` | 147,344 | small business for this NAICS |
| `######N` | 44,367 | not small |
| **`######E`** | **16,203** | **SBA size-standard EXCEPTION** |
| `######` | 946 | no flag |

The importer's own comment calls this a **tri-state** (`Y` / `N` / absent). The source has
**four** states. `import-sam-entity-extract.mjs:158` accepts only `Y` or `N`, so every `E`
silently collapses into "SAM did not say" — when SAM said something specific.

## Where it changes a conclusion

741 NAICS with ≥100 registrants, bucketed by exception share:

| bucket | NAICS | registrations |
|---|---:|---:|
| 0–5% | 728 | 619,356 |
| 5–20% | 0 | 0 |
| 20–50% | 0 | 0 |
| **>50%** | **13** | **53,478** |

The distribution is **bimodal, not gradual**: a market either has essentially no exceptions or
is *entirely* exception-coded. The 13 are 100% `E` with **zero** `Y` and **zero** `N`:

`541330` Engineering Services (11,323) · `541519` IT Services (10,237) · `541715` R&D (6,482) ·
`238990` (6,412) · `237990` (4,249) · `531120` (2,936) · `115310` (2,040) · `531110` (1,459) ·
`531190` (1,414) · `611519` (1,404) …

## Confirmed on the live mirror, with a control

| NAICS | in mirror | flagged small-business | |
|---|---:|---:|---|
| 541330 | 50,369 | **0** | 0.0% |
| 541519 | 47,332 | **0** | 0.0% |
| 541715 | 29,665 | **0** | 0.0% |
| **541512** (control) | 53,322 | 45,190 | **84.7%** |

**0.0% across 127,366 firms in three real markets**, against a control that behaves normally.
That is not a subtle skew — the small-business signal is entirely absent for those markets, and
nothing in the data says so.

## Why this is worse than a missing field

A missing value that reads as *unknown* is honest. This one reads as **"SAM did not say"** when
SAM did — the same shape as `count ?? 0`: an evidence failure presented as a fact about the
world. Any Rule-of-Two or set-aside reasoning over 541330 / 541519 / 541715 is working from a
signal that is uniformly blank for reasons that have nothing to do with those firms.

## What has NOT been done

- ❌ No parser change yet — the fix is a schema + reingest decision, measured first.
- ❌ Not wired into eligibility or market depth.
- ❌ `E` semantics not yet resolved: an SBA exception changes **which size standard applies**
  (often employee-count instead of revenue). Whether an `E` firm should be treated as small,
  not-small, or genuinely-unknown-pending-standard is a **product** question, not a parser one.
  Storing `E` faithfully comes first; interpreting it is a separate, measured step.
