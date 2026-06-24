# Spec: PSC as a co-anchor for opportunity matching

**Status:** Ready to execute (post-demo)
**Created:** 2026-06-24
**Owner:** Eric / Claude
**Decision basis:** Live cache coverage pulled 2026-06-24 — PSC is *more* complete
than NAICS and far more precise, so it should match with equal weight, not as a
NAICS-derived afterthought.

---

## Why (the finding)

A pest-control profile (NAICS `561710`) was receiving security-camera, office-admin,
and telemarketing alerts. Root cause: the shared matcher widened every code to its
**3-digit subsector** (`561` is a grab-bag that lumps pest control `5617` with
security guards `5616`, office admin `5611`, telemarketing `5614`).

**Demo fix already shipped** (`fix/naics-4digit-tight-matching`, merged
`a90b7117`): widen to the **4-digit industry group** (`5617` = all building
services), keep 6-digit codes exact on persist, stop re-expanding before matching.
That made the dossier clean *today* with zero data dependency. This spec is the
**next** improvement, not a fix for the demo.

**Coverage pull** (`/api/admin/sam-sync-status`, 30,961 active cached opps):

| Axis | Populated | Coverage |
|------|-----------|----------|
| PSC (`psc_code`)   | 30,183 | **97.5%** |
| NAICS (`naics_code`) | 30,010 | 96.9% |

PSC is the more complete AND more precise axis. There is no data reason it has been
second-class — only history (we capture NAICS from users, so PSC got *derived* from
it via a top-3 crosswalk instead of being led with).

This realizes the documented 3-axis model (CLAUDE.md "Keyword-first market
research"): **keyword = discovery, PSC = what was BOUGHT, NAICS = who the seller is
+ size/set-aside eligibility.** PSC is the precise "what." Today we anchor on the
wrong axis.

---

## Current architecture (as-is)

- **Profile capture** is NAICS-first. `psc_codes` exists on the profile but is
  rarely populated by users.
- **Match path** (`src/lib/briefings/pipelines/sam-gov.ts` → `applySamCacheFilters`,
  ~line 1028): builds `naics_code LIKE <4digit>% OR psc_code LIKE <psc>% OR
  title/description ILIKE <keyword>`. PSC **is** in the OR — but the `pscCodes`
  passed in are **derived from NAICS** via `getPSCsForNAICS(naics, 3)` (top-3
  crosswalk) in the callers, when the user has no manual PSC:
  - `src/app/api/app/market-dossier/route.ts` (~line 84)
  - `src/app/api/cron/daily-alerts/route.ts` (~line 611, `effectivePsc`)
- **Consequence:** PSC inherits NAICS's imprecision instead of correcting it. The
  top-3 crosswalk for `561xxx` is slightly broad — it injected `562991` (septic) and
  `812332` (industrial mat service) into the pest-control dossier. Minor, but it's
  the crosswalk leaking, not PSC itself.

---

## Target architecture (to-be)

**Lead with the authoritative PSC, fall back to 4-digit NAICS for the ~2.5% of opps
with no PSC.**

1. **Authoritative PSC source = the keyword, not the NAICS crosswalk.**
   `keywordCoverage(keyword)` (`src/lib/market/keyword-coverage.ts`) already returns:
   - `topPsc: { code, name } | null` — the single best "what was bought"
   - `topPscList: { code, name, amount, pct }[]` — ranked PSCs with dollars
   - existing `pscIsSpecific` gate (lines 74–84) already decides when the topPsc is
     trustworthy (≥40% share, not generic, literal-product match).
   Use `topPscList` (the gated, specific ones) as the user's PSC anchor set. The
   NAICS→PSC crosswalk stays only as a fallback when there's no keyword.

2. **Persist `psc_codes` on the profile** so it's captured once, not re-derived every
   run (and so it can be shown/edited). Write it from:
   - **Onboarding** (`src/app/app/onboarding/page.tsx` — already grounds day-1 NAICS
     via `/api/suggest-codes`): also persist `keywordCoverage.topPscList` codes.
   - **save paths**: `src/app/api/alerts/save-profile/route.ts` and
     `src/app/api/app/profile/route.ts` accept + store `psc_codes`.

3. **Match path stays the same OR structure** but `pscCodes` now comes from the
   **stored authoritative set**, not the NAICS top-3 crosswalk. No change to
   `applySamCacheFilters` itself is required — it already ORs `psc_code.like.X%`.
   The change is *what we feed it*. Optionally tighten the PSC clause from prefix
   (`psc_code.like.S208%`) — note 4-char PSCs like `S208` are already full codes, so
   prefix == exact for service PSCs; product PSCs (4-digit numeric) may want exact.

---

## Concrete changes

| # | File | Change |
|---|------|--------|
| 1 | `src/app/api/app/profile/route.ts` | Accept + persist `psc_codes` (validate format `^[A-Z0-9]{2,4}$`). |
| 2 | `src/app/api/alerts/save-profile/route.ts` | Same — accept `pscCodes`, store on `user_notification_settings.psc_codes`. (Keep the `expandFullCodes=false` NAICS fix already shipped.) |
| 3 | `src/app/app/onboarding/page.tsx` | After grounding NAICS, also capture `keywordCoverage.topPscList` (gated/specific only) → save as `psc_codes`. |
| 4 | `src/app/api/app/market-dossier/route.ts` | Source `pscCodes` from the stored profile `psc_codes`; only fall back to `getPSCsForNAICS` when the profile has none. |
| 5 | `src/app/api/cron/daily-alerts/route.ts` | `effectivePsc = profile.psc_codes ?? uniquePSCs` — prefer stored authoritative PSC over the NAICS crosswalk. |
| 6 | `src/app/api/cron/send-notifications/route.ts` | Same precedence as #5. |
| 7 | (data) | One-off backfill: for existing profiles with a keyword/business_description, derive `topPscList` and populate `psc_codes`. Admin endpoint, dry-run first. |

**No schema change needed** — `user_notification_settings.psc_codes text[]` already
exists (migration `20260612_add_psc_codes.sql`, GIN-indexed). The column is already
read in daily-alerts (`user.psc_codes`); this spec just starts *populating* it from
the authoritative keyword PSC and consuming it ahead of the NAICS crosswalk.

---

## Risks & mitigations

- **Over-tightening (recall drop).** Anchoring on PSC could drop opps that are
  mis-coded on PSC. Mitigation: keep the **OR** (PSC OR 4-digit NAICS OR keyword) —
  PSC *adds* precision without removing the NAICS safety net. We are NOT replacing
  NAICS, we are promoting PSC to equal weight.
- **Bad/empty topPsc for vague keywords.** The existing `pscIsSpecific` gate already
  handles this — only persist PSC when it's specific. Vague keywords fall back to
  NAICS-anchored matching (status quo).
- **Existing users with no keyword.** Backfill is best-effort; users with only NAICS
  keep the crosswalk fallback. No regression.
- **Shared matcher blast radius.** Every tool (alerts, briefings, dossier, dashboard)
  uses this path. Stage behind a flag or roll out to a cohort; compare alert volume
  before/after on a sample of profiles.

## Rollback

All changes are additive (PSC fed alongside NAICS). Revert the caller precedence
(#4–#6) to fall back to `getPSCsForNAICS` and the system returns to today's behavior.
No destructive data changes (backfill only populates an empty column).

---

## Acceptance criteria / QA

1. **Pest-control profile** (`pestdemo@govcongiants.com`, NAICS `561710`+, keyword
   "pest control"): dossier `psc_codes` includes `S208`; the `562991`/`812332`
   crosswalk-leak items disappear; mosquito/lawn/arborist/herbicide/bird-netting
   remain.
2. **IT profile** (NAICS `541512`, keyword "cybersecurity"): PSC anchor (`DA01`/`D3`
   family) catches managed-security opps mis-filed under non-541 NAICS that 4-digit
   NAICS alone misses.
3. **No keyword profile**: behavior identical to today (crosswalk fallback).
4. **Alert volume**: on a 50-profile sample, total matched opps within ±15% of
   pre-change (precision up, recall roughly held by the OR).
5. Coverage re-pull confirms PSC still ≥95% so the anchor stays reliable.

---

## Out of scope (separate follow-ups)

- Recompete matching is exact-6-digit NAICS today (tight by design) — leave unless a
  niche proves too sparse.
- PSC-level set-aside / size-standard logic (NAICS still owns size eligibility).
- Teaching UI for PSC (the Market Coverage banner already surfaces topPsc).

---

## Sequencing

Demo first on the shipped 4-digit NAICS fix. Then: #1–#3 (capture) → #4–#6 (consume,
behind cohort) → #7 (backfill) → measure → full rollout.
