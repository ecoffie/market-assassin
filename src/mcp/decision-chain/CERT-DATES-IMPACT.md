# Certification entry/exit dates — measured decision impact

**Measured 2026-08-24** against the Aug-2026 public extract (250K lines) and the live mirror.

> Don't ask "how common is this field?" Ask **"how often would having this field change a
> Mindy decision?"**

**This is the strongest finding since `naicsException`, and unlike the prior two fields it is a
direct eligibility defect: we assert certifications that have already lapsed.**

## The source carries expiry dates; the importer throws them away

Field 117 tokens come in two shapes:

| shape | count | meaning |
|---|---:|---|
| `A#` / `XX` | 4,022 | program code, **no date** |
| `A#########` / `XX########` / `JT########` | 1,124 | program code **+ 8-digit expiry** |

`import-sam-entity-extract.mjs` already *knows* this — its comment says *"A6 carries a
concatenated cert-expiry date (e.g. `A620291223` = A6 + 20291223), so exact-match misses most
8(a)s"* — and it prefix-matches to get the **label** right. But it keeps only the label and
discards the date, so `A620210726` (expired 2021) and `A620291223` (valid to 2029) both become
the string `8(a)`.

## What that costs

Measured over 250K lines, against 2026-08-24:

| | |
|---|---:|
| firms with an SBA-certified token | 2,970 |
| **firms carrying an EXPIRED cert** | **507 (17.1% of certified)** |
| **…whose SAM registration is still ACTIVE** | **467** |

Of the dated tokens specifically: **513 of 1,896 (27.1%) are expired.** By program:

| program | dated | undated | **expired** | current |
|---|---:|---:|---:|---:|
| 8(a) | 1,740 | 12 | **469** | 1,271 |
| HUBZone | 156 | 1,234 | **44** | 112 |

Lapses are not ancient history — **170 expired in 2026, 81 in 2025, 80 in 2024, 75 in 2023,
81 in 2022**.

## Confirmed on the live mirror

The sharp cases are the ones whose *registration* is Active, so nothing else flags them:

| firm | stored | registration | cert actually expired |
|---|---|---|---|
| **KILIUDA CONSULTING, LLC** | `["8(a)"]` | **Active** | **2023-01-11** |
| **ALASKA PROFESSIONAL CONSTRUCTION** | `["HUBZone"]` | **Active** | **2024-03-19** |
| VENTURA ELECTRIC INC. | `["8(a)"]` | Expired | 2021-07-26 |
| E & G CONSULTING LLC | `["8(a)","WOSB"]` | Expired | 2022-07-23 |

Mirror-wide we store **5,957** firms as 8(a) and **4,843** as HUBZone, with no expiry on any of
them.

## Why this is worse than the earlier fields

`purposeOfRegistration` distorted nothing measurable. JV structure flipped 0.11% of scoped
pools. This one **asserts a regulated status that has expired** — a user asking for 8(a) firms
receives companies whose 8(a) lapsed years ago, with no way to tell. Recommending a lapsed
firm for a set-aside is a compliance error, not a ranking nuisance.

It also has an **undated** problem that is separate and larger: **1,234 of 1,390 HUBZone tokens
(89%) carry no date at all**, so their currency is genuinely unknown — which must be reported
as unknown, never as current.

## Ranking against the other measured fields

| field | measured decision impact |
|---|---|
| `naicsException` | 13 markets, **100% of firms blanked** |
| **certification dates** | **467 actively-registered firms asserted as certified while lapsed** |
| JV / entity structure | 0.11% of scoped pools flip |
| `purposeOfRegistration` | 0 markets materially distorted |

## The fix, and what has NOT been done

The date is already in the token the importer parses — capturing it is a **parse-and-store**
change, not a re-derivation. Three states must stay distinct:

- **current** — dated, not yet expired
- **expired** — dated, past
- **unknown** — undated (the 89% of HUBZone tokens); must never render as "current"

- ❌ Not yet parsed or stored — measured first, as with every field in this track.
- ❌ Nothing wired into eligibility, matching or set-aside logic.
- ⚠️ SAM's date is the **program expiry**, not an SBA re-verification; `cert_provenance`
  already distinguishes SBA-certified from self-identified and must keep doing so.
