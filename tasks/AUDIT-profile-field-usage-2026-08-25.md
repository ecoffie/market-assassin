# Audit — which profile information actually makes Mindy better (read-only)

**Run 2026-08-25. NOTHING CHANGED.** Evidence for designing Maps-native company setup
instead of porting 1,793 lines of `/app/onboarding`.

The question deliberately is **not** "which fields are in the legacy form?" It is
**"which information actually makes Mindy better?"**

## The number that reframes the design

| | |
|---|---|
| users with notification settings | **10,700** |
| users with a business profile at all | **508 (4.7%)** |
| users with **genuinely self-selected NAICS** | **1,850 (17.3%)** |

**Of 9,778 users who "have NAICS", 7,928 (81.1%) carry the exact 5-code placeholder
default** (`541512, 541611, 541330, 541990, 561210`). The legacy onboarding's headline
output is, for four users in five, a value nobody chose.

That is the strongest argument against porting the form: **it already runs, and 95% of
users never complete it.**

## The table

| Field | % populated | matching | alerts | MCP | Proposal/Vault | required today | **Mindy can infer?** | Bucket |
|---|---:|:--:|:--:|:--:|:--:|:--:|---|---|
| `naics_codes` | **91.4%** (17.3% real) | ✓ 6 | ✓ 4 | ✓ 11 | ✓ 3 | de-facto | **YES** — `/api/suggest-codes` derives from a description | **Core** |
| `keywords` | 40.5% | ✓ 11 | ✓ 5 | ✓ 12 | ✓ 7 | no | **YES** — `semantic-keywords.ts` derives from UEI/past-perf | **Core** |
| `agencies` | 11.2% | ✓ 9 | ✓ 1 | ✓ **37** | ✓ 8 | no | **YES** — from award history | **Progressive** (highest MCP consumption) |
| `location_states` | 5.2% | — | ✓ 1 | — | ✓ 1 | no | partly — from registration address | **Progressive** |
| `capability_embedding` | 15.5% | — | ✓ 1 | ✓ 1 | — | no | **YES — already derived, never asked** | **Derived** |
| `psc_codes` | 1.8% | ✓ 2 | ✓ 1 | ✓ 1 | — | no | **YES** — NAICS↔PSC crosswalk exists | **Derive, don't ask** |
| `set_aside_preferences` | 1.2% | — | — | — | — | no | **YES** — SAM certifications are authoritative | **Derive, don't ask** |
| `primary_industry` | **0.8%** | ✗ 0 | ✗ 0 | ✗ 0 | ✗ 0 | no | — | **DEAD — stop asking** |
| `set_aside_certifications` | **0.0%** | ✗ 0 | ✗ 0 | ✗ 0 | ✗ 0 | no | **YES** — SAM already holds them | **DEAD** |
| `clicked_naics` / `clicked_agencies` | **0.0%** | ✗ 0 | ✗ 0 | ✗ 0 | ✗ 0 | no | — | **DEAD** |
| `inferred_company_size` / `_business_type` / `_certifications` | **0.0%** | ✗ | ✗ | ✗ | ✗ | no | that was the intent | **DEAD — built to be derived, never wired** |
| `business_description` (notif table) | **0.0%** | — | — | — | — | no | — | **DEAD duplicate** — the real one is on `user_business_profiles` at 83.7% |

## The three buckets

**CORE IDENTITY — ask, but only once and in plain language**
`company_name` · what you do (free text) · certifications · where you want to work.
NAICS and keywords are **derived from the description**, then confirmed — never typed.

**PROGRESSIVE ENRICHMENT — ask later, when it improves a visible feature**
`agencies` (11.2% populated but **37 MCP consumers** — the biggest gap between value and
capture) · `location_states` · past performance (inside Vault, tied to proposals).

**DEAD — stop asking entirely**
`primary_industry`, `set_aside_certifications`, `clicked_naics`, `clicked_agencies`, all
three `inferred_*` columns, and the duplicate `business_description`. **Zero consumers,
≤0.8% populated.** Several exist specifically to be derived and never were.

## What this says about the setup flow

The evidence supports something close to:

> **Help Mindy understand your company**
> Company name · What do you sell or do? · Certifications · Where do you want to work?
> **Build my market →**

Four questions, one of them free text, from which NAICS + keywords + PSC are **derived and
confirmed**. Everything else moves to progressive enrichment inside Vault.

⚠️ **Do not create another profile system.** DEFECT-8 already showed one column carrying
two meanings across two writers; a third writer compounds it. Reuse
`user_notification_settings` (the table all 10,700 users have) and
`user_business_profiles`, plus `/api/suggest-codes` and `semantic-keywords.ts`, which
already do the inference.

## Honest limits

* **Populated ≠ useful.** This measures presence and consumer count, not whether a field
  improved an outcome. Proving that needs the Phase-2 usage log, not a schema query.
* **Consumer counts are grep-based** — a file referencing a field is not proof it depends
  on it. Directionally sound (0 vs 37 is not a rounding error), not exact.
* `agencies` at 11.2% with 37 MCP consumers is the clearest **capture gap**, but whether
  asking earlier would help — or whether it should simply be derived from award history —
  is a product question this audit cannot settle.
